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
import { auditEvents } from "@/db/schema";
import { sendAuthenticationEmail } from "@/lib/email/send";
import { authProviderConfiguration } from "@/lib/auth/providers";

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
  secret: secret ?? "development-secret-change-before-production",
  baseURL,
  trustedOrigins: (
    process.env.TRUSTED_ORIGINS ?? "http://localhost:3000"
  ).split(","),
  database: drizzleAdapter(db, { provider: "pg", usePlural: true }),
  databaseHooks: {
    session: {
      create: {
        after: async (session, context) => {
          await db.insert(auditEvents).values({
            actorId: session.userId,
            action: "authentication.session.created",
            targetType: "session",
            targetId: session.id,
            ipAddress: session.ipAddress,
            userAgent: session.userAgent,
            requestId: context?.request?.headers.get("x-request-id"),
          });
        },
      },
      delete: {
        after: async (session, context) => {
          await db.insert(auditEvents).values({
            actorId: session.userId,
            action: "authentication.session.ended",
            targetType: "session",
            targetId: session.id,
            ipAddress: session.ipAddress,
            userAgent: session.userAgent,
            requestId: context?.request?.headers.get("x-request-id"),
          });
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
    admin(),
  ],
});

export type Auth = typeof auth;
