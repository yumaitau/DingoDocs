"use client";

import { createAuthClient } from "better-auth/react";
import {
  adminClient,
  magicLinkClient,
  twoFactorClient,
} from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";
import { twoFactorChallengePath } from "@/lib/auth/two-factor";

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_BETTER_AUTH_URL ?? "",
  plugins: [
    magicLinkClient(),
    twoFactorClient({
      // Password sign-in for an account with verified TOTP returns
      // { twoFactorRedirect: true } instead of a session. Send the user to the
      // challenge page, carrying the validated `next` path through.
      onTwoFactorRedirect() {
        if (typeof window === "undefined") return;
        const next = new URLSearchParams(window.location.search).get("next");
        window.location.assign(twoFactorChallengePath(next));
      },
    }),
    passkeyClient(),
    adminClient(),
  ],
});

export const { signIn, signOut, signUp, useSession } = authClient;
