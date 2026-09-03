# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=26-alpine
ARG ALPINE_VERSION=3.23
ARG APP_VERSION=1.0.0
ARG COMMIT_SHA=unknown

FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN apk upgrade --no-cache \
    && npm install --global corepack@0.35.0 \
    && corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG DINGODOCS_DISTRIBUTION=development
ARG AWS_MARKETPLACE_PRODUCT_CODE
ARG AWS_MARKETPLACE_PRODUCT_SKU
ARG AWS_MARKETPLACE_CONTRACT_DIMENSION
ARG AWS_MARKETPLACE_LICENSE_FINGERPRINT
ARG APP_VERSION
ARG COMMIT_SHA
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_APP_VERSION=${APP_VERSION}
ENV NEXT_PUBLIC_COMMIT_SHA=${COMMIT_SHA}
RUN DINGODOCS_DISTRIBUTION="$DINGODOCS_DISTRIBUTION" \
    AWS_MARKETPLACE_PRODUCT_CODE="$AWS_MARKETPLACE_PRODUCT_CODE" \
    AWS_MARKETPLACE_PRODUCT_SKU="$AWS_MARKETPLACE_PRODUCT_SKU" \
    AWS_MARKETPLACE_CONTRACT_DIMENSION="$AWS_MARKETPLACE_CONTRACT_DIMENSION" \
    AWS_MARKETPLACE_LICENSE_FINGERPRINT="$AWS_MARKETPLACE_LICENSE_FINGERPRINT" \
    node scripts/embed-marketplace-identity.mjs
RUN pnpm build && pnpm build:runtime

FROM node:${NODE_VERSION} AS nodebin

FROM alpine:${ALPINE_VERSION} AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ARG APP_VERSION
ARG COMMIT_SHA
ARG DINGODOCS_DISTRIBUTION=development
ENV APP_VERSION=${APP_VERSION}
ENV NEXT_PUBLIC_APP_VERSION=${APP_VERSION}
ENV GIT_COMMIT=${COMMIT_SHA}
LABEL org.opencontainers.image.title="DingoDocs"
LABEL org.opencontainers.image.description="Security assessment delivery workspace"
LABEL org.opencontainers.image.version="${APP_VERSION}"
LABEL org.opencontainers.image.revision="${COMMIT_SHA}"
LABEL com.dingodocs.distribution="${DINGODOCS_DISTRIBUTION}"
RUN apk upgrade --no-cache \
    && apk add --no-cache libc6-compat libstdc++ ca-certificates \
    && addgroup -S -g 1001 nodejs \
    && adduser -S -u 1001 -G nodejs nextjs
COPY --from=nodebin /usr/local/bin/node /usr/local/bin/node
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nextjs:nodejs /app/src/db/migrations ./src/db/migrations
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/dingodocs-entrypoint
RUN mkdir -p /app/storage/data && chown -R nextjs:nodejs /app/storage
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENTRYPOINT ["dingodocs-entrypoint"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=3 CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server.js"]
