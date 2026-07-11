import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
  admin,
  haveIBeenPwned,
  magicLink,
  oAuthProxy,
  twoFactor,
} from "better-auth/plugins";
import { db } from "@/db";
import { sendAuthenticationEmail } from "@/lib/email/send";

const secret = process.env.BETTER_AUTH_SECRET;
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
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  trustedOrigins: (
    process.env.TRUSTED_ORIGINS ?? "http://localhost:3000"
  ).split(","),
  database: drizzleAdapter(db, { provider: "pg", usePlural: true }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 14,
    maxPasswordLength: 256,
    requireEmailVerification: false,
  },
  session: {
    expiresIn: 60 * 60 * 8,
    updateAge: 60 * 60,
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 30,
    customRules: {
      "/sign-in/*": { window: 60, max: 30 },
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
    twoFactor({ issuer: "DingoDocs", otpOptions: { period: 30, digits: 6 } }),
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
    oAuthProxy(),
    admin(),
  ],
});

export type Auth = typeof auth;
