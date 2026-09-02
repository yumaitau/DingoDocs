FROM node:26-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN npm install --global corepack@0.35.0 && corepack enable

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
ENV NEXT_TELEMETRY_DISABLED=1
RUN DINGODOCS_DISTRIBUTION="$DINGODOCS_DISTRIBUTION" \
    AWS_MARKETPLACE_PRODUCT_CODE="$AWS_MARKETPLACE_PRODUCT_CODE" \
    AWS_MARKETPLACE_PRODUCT_SKU="$AWS_MARKETPLACE_PRODUCT_SKU" \
    AWS_MARKETPLACE_CONTRACT_DIMENSION="$AWS_MARKETPLACE_CONTRACT_DIMENSION" \
    AWS_MARKETPLACE_LICENSE_FINGERPRINT="$AWS_MARKETPLACE_LICENSE_FINGERPRINT" \
    node scripts/embed-marketplace-identity.mjs
RUN pnpm build

FROM base AS migrator
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-workspace.yaml drizzle.config.ts tsconfig.json ./
COPY src/db ./src/db
COPY src/lib/marketplace ./src/lib/marketplace
COPY scripts/embed-marketplace-identity.mjs scripts/run-migrations.ts ./scripts/
ARG DINGODOCS_DISTRIBUTION=development
ARG AWS_MARKETPLACE_PRODUCT_CODE
ARG AWS_MARKETPLACE_PRODUCT_SKU
ARG AWS_MARKETPLACE_CONTRACT_DIMENSION
ARG AWS_MARKETPLACE_LICENSE_FINGERPRINT
RUN DINGODOCS_DISTRIBUTION="$DINGODOCS_DISTRIBUTION" \
    AWS_MARKETPLACE_PRODUCT_CODE="$AWS_MARKETPLACE_PRODUCT_CODE" \
    AWS_MARKETPLACE_PRODUCT_SKU="$AWS_MARKETPLACE_PRODUCT_SKU" \
    AWS_MARKETPLACE_CONTRACT_DIMENSION="$AWS_MARKETPLACE_CONTRACT_DIMENSION" \
    AWS_MARKETPLACE_LICENSE_FINGERPRINT="$AWS_MARKETPLACE_LICENSE_FINGERPRINT" \
    node scripts/embed-marketplace-identity.mjs
USER nextjs
CMD ["./node_modules/.bin/tsx", "scripts/run-migrations.ts"]

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/node_modules ./.next/node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next/server ./.next/server
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
RUN mkdir -p /app/storage/data && chown -R nextjs:nodejs /app/storage
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
