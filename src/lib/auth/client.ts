"use client";

import { createAuthClient } from "better-auth/react";
import {
  adminClient,
  magicLinkClient,
  twoFactorClient,
} from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_BETTER_AUTH_URL ?? "",
  plugins: [
    magicLinkClient(),
    twoFactorClient(),
    passkeyClient(),
    adminClient(),
  ],
});

export const { signIn, signOut, signUp, useSession } = authClient;
