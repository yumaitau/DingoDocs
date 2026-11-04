import { betterAuth } from "better-auth";
import { passkey } from "@better-auth/passkey";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
  admin,
  haveIBeenPwned,
  genericOAuth,
  magicLink,
  oAuthProxy,
  twoFactor,
} from "better-auth/plugins";
import { db } from "@/db";
import {
  accounts,
  organisationMembers,
  passkeys,
  sessions,
  twoFactor as twoFactorRecords,
  users,
  verificationTokens,
} from "@/db/schema";
import { sendAuthenticationEmail } from "@/lib/email/send";
import { authProviderConfiguration } from "@/lib/auth/providers";
import { DEFAULT_TIME_ZONE } from "@/lib/time-zone";
import { DEVELOPMENT_AUTH_SECRET } from "@/lib/auth/secret";
import { createSecondFactorSessionGuard } from "@/lib/auth/second-factor-session-guard";
import { insertAuthenticationAudit } from "@/lib/auth/authentication-audit";
import { createRevokedSessionGuard } from "@/lib/auth/revoked-session-guard";
import { samlSso } from "@/lib/auth/saml-plugin";
import { samlPolicy } from "@/lib/auth/saml-config";
import { findSamlOrganisationBySlug } from "@/server/services/saml-sso";
import { and, eq, gte } from "drizzle-orm";

const secret = process.env.BETTER_AUTH_SECRET;
const providerConfiguration = authProviderConfiguration();
const baseURL = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
if (
  !secret &&
  process.env.NODE_ENV === "production" &&
  process.env.NEXT_PHASE !== "phase-production-build"
) {
  throw new Error("BETTER_AUTH_SECRET is required in production");
}

export const auth = betterAuth({
  appName: "DingoDocs",
  secret: secret ?? DEVELOPMENT_AUTH_SECRET,
  baseURL,
  trustedOrigins: (process.env.TRUSTED_ORIGINS ?? "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: users,
      session: sessions,
      account: accounts,
      verificationTokens,
      passkeys,
      twoFactor: twoFactorRecords,
    },
  }),
  user: {
    additionalFields: {
      timeZone: {
        type: "string",
        defaultValue: DEFAULT_TIME_ZONE,
        input: false,
      },
    },
  },
  hooks: {
    // Tenant revocation keeps the session row, so stop a revoked session
    // minting a replacement (newer createdAt) or registering a passkey.
    before: createRevokedSessionGuard(async (token) => {
      const [revoked] = await db
        .select({ id: organisationMembers.id })
        .from(sessions)
        .innerJoin(
          organisationMembers,
          eq(organisationMembers.userId, sessions.userId),
        )
        .where(
          and(
            eq(sessions.token, token),
            gte(organisationMembers.sessionsRevokedAt, sessions.createdAt),
          ),
        )
        .limit(1);
      return Boolean(revoked);
    }),
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => ({
          data: { ...user, role: "user" },
        }),
      },
    },
    session: {
      create: {
        // Magic links, verify-email auto sign-in and OAuth callbacks (which
        // implicitly link a matching verified email) prove only email or IdP
        // possession, so TOTP-enrolled accounts must use password + code or a
        // passkey instead. Allow-listed in the guard.
        before: createSecondFactorSessionGuard(
          async (userId) => {
            const [row] = await db
              .select({ twoFactorEnabled: users.twoFactorEnabled })
              .from(users)
              .where(eq(users.id, userId))
              .limit(1);
            return row?.twoFactorEnabled === true;
          },
          {
            // The SAML ACS is allow-listed only for organisations whose SSO
            // policy says the IdP enforces MFA. The org is the path slug.
            trustsIdpMfa: async (context) => {
              const slug = context.params?.orgSlug;
              if (!slug) return false;
              const organisation = await findSamlOrganisationBySlug(slug);
              return (
                samlPolicy(organisation?.securityPolicy)?.idpEnforcesMfa ===
                true
              );
            },
          },
        ),
        after: async (session, context) => {
          await insertAuthenticationAudit(
            {
              actorId: session.userId,
              action: "authentication.session.created",
              targetType: "session",
              targetId: session.id,
              ipAddress: session.ipAddress,
              userAgent: session.userAgent,
              requestId: context?.request?.headers.get("x-request-id"),
            },
            session.userId,
          );
        },
      },
      delete: {
        after: async (session, context) => {
          await insertAuthenticationAudit(
            {
              actorId: session.userId,
              action: "authentication.session.ended",
              targetType: "session",
              targetId: session.id,
              ipAddress: session.ipAddress,
              userAgent: session.userAgent,
              requestId: context?.request?.headers.get("x-request-id"),
            },
            session.userId,
          );
        },
      },
    },
  },
  socialProviders: providerConfiguration.socialProviders,
  account: {
    encryptOAuthTokens: true,
    accountLinking: {
      enabled: true,
      allowDifferentEmails: false,
      allowUnlinkingAll: false,
    },
  },
  verification: {
    modelName: "verificationTokens",
    storeIdentifier: "hashed",
  },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60,
    sendVerificationEmail: async ({ user, url }) =>
      sendAuthenticationEmail({
        to: user.email,
        url,
        purpose: "verify-email",
      }),
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 14,
    maxPasswordLength: 256,
    requireEmailVerification:
      process.env.REQUIRE_EMAIL_VERIFICATION !== "false",
    resetPasswordTokenExpiresIn: 60 * 30,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) =>
      sendAuthenticationEmail({
        to: user.email,
        url,
        purpose: "reset-password",
      }),
  },
  session: {
    expiresIn: 60 * 60 * 8,
    updateAge: 60 * 60,
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 30,
    customRules: {
      "/sign-in/*": { window: 60, max: 30 },
      "/request-password-reset": { window: 300, max: 5 },
      "/send-verification-email": { window: 300, max: 5 },
    },
  },
  advanced: {
    database: { generateId: "uuid" },
    cookies: {
      session_token: {
        attributes: {
          httpOnly: true,
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
        },
      },
    },
  },
  plugins: [
    passkey({
      rpName: "DingoDocs",
      rpID: new URL(baseURL).hostname,
      origin: new URL(baseURL).origin,
      schema: { passkey: { modelName: "passkeys" } },
    }),
    twoFactor({
      issuer: "DingoDocs",
      otpOptions: { period: 30, digits: 6 },
      schema: { twoFactor: { modelName: "twoFactor" } },
    }),
    magicLink({
      expiresIn: 60 * 30,
      disableSignUp: false,
      sendMagicLink: async ({ email, url }) =>
        sendAuthenticationEmail({ to: email, url }),
    }),
    haveIBeenPwned({
      customPasswordCompromisedMessage:
        "This password appears in a known breach. Choose another.",
    }),
    ...(providerConfiguration.oauthProviders.length
      ? [genericOAuth({ config: providerConfiguration.oauthProviders })]
      : []),
    oAuthProxy(),
    samlSso(),
    admin({
      defaultRole: "user",
      adminRoles: ["admin"],
      adminUserIds: (process.env.BETTER_AUTH_ADMIN_USER_IDS ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    }),
  ],
});

export type Auth = typeof auth;
