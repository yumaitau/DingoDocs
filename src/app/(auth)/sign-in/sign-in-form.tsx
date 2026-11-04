"use client";

import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";
import type { PublicAuthProvider } from "@/lib/auth/providers";
import { safeInternalPath } from "@/lib/security/internal-path";
import {
  SECOND_FACTOR_REQUIRED_ERROR,
  SECOND_FACTOR_REQUIRED_MESSAGE,
} from "@/lib/auth/second-factor-session-guard";
import {
  ORGANISATION_SLUG_PATTERN,
  SAML_PATH_PREFIX,
  SSO_DISCOVER_PATH,
  SSO_ERROR_METHOD,
  SSO_FAILED_ERROR,
  SSO_FAILED_MESSAGE,
  SSO_TWO_FACTOR_MESSAGE,
} from "@/lib/auth/saml-paths";

function initialError(search: URLSearchParams) {
  const code = search.get("error");
  if (code === SECOND_FACTOR_REQUIRED_ERROR)
    return search.get("method") === SSO_ERROR_METHOD
      ? SSO_TWO_FACTOR_MESSAGE
      : SECOND_FACTOR_REQUIRED_MESSAGE;
  if (code === SSO_FAILED_ERROR) return SSO_FAILED_MESSAGE;
  if (code === "session_revoked")
    return "An administrator signed you out of this organisation. Sign in again to continue.";
  return "";
}

const authBase = `${process.env.NEXT_PUBLIC_BETTER_AUTH_URL ?? ""}/api/auth`;

export function SignInForm({ providers }: { providers: PublicAuthProvider[] }) {
  const search = useSearchParams();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(() => initialError(search));
  const [ssoOpen, setSsoOpen] = useState(false);
  const [ssoIdentifier, setSsoIdentifier] = useState("");
  const [pending, setPending] = useState(false);
  const [magicSent, setMagicSent] = useState(false);
  const callbackURL = safeInternalPath(search.get("next"));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const result = await authClient.signIn.email({
      email,
      password,
      callbackURL,
    });
    if (result.error) {
      setPending(false);
      setError(result.error.message ?? "Unable to sign in");
      return;
    }
    // A second factor is required: the twoFactorClient onTwoFactorRedirect
    // hook is already navigating to /sign-in/two-factor, so stay pending.
    if (result.data && "twoFactorRedirect" in result.data) return;
    setPending(false);
  }

  async function sendMagicLink() {
    setPending(true);
    setError("");
    const result = await authClient.signIn.magicLink({
      email,
      callbackURL,
    });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "Unable to send sign-in link");
      return;
    }
    setMagicSent(true);
  }

  async function signInWithProvider(provider: PublicAuthProvider) {
    setPending(true);
    setError("");
    const result = await authClient.signIn.social({
      provider: provider.id,
      callbackURL,
    });
    setPending(false);
    if (result.error)
      setError(
        result.error.message ?? `Unable to sign in with ${provider.label}`,
      );
  }

  // Organisation slug goes straight to its login endpoint. An email is
  // resolved by the server, whose answer is the same opaque continue URL
  // whether or not the domain uses SSO.
  async function signInWithSso(event: React.FormEvent) {
    event.preventDefault();
    const value = ssoIdentifier.trim().toLowerCase();
    setError("");
    if (value.includes("@")) {
      setPending(true);
      const result = await authClient.$fetch<{ url: string }>(
        SSO_DISCOVER_PATH,
        { method: "POST", body: { email: value, callbackURL } },
      );
      if (result.error || !result.data?.url) {
        setPending(false);
        setError(SSO_FAILED_MESSAGE);
        return;
      }
      window.location.assign(result.data.url);
      return;
    }
    if (!ORGANISATION_SLUG_PATTERN.test(value)) {
      setError("Enter your work email or your organisation's SSO name.");
      return;
    }
    setPending(true);
    const url = new URL(
      `${authBase}${SAML_PATH_PREFIX}/${encodeURIComponent(value)}/login`,
      window.location.origin,
    );
    url.searchParams.set("callbackURL", callbackURL);
    window.location.assign(url.toString());
  }

  async function signInWithPasskey() {
    setPending(true);
    setError("");
    const result = await authClient.signIn.passkey();
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "Unable to sign in with a passkey");
      return;
    }
    router.push(callbackURL);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="mt-7 space-y-4">
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium">Email</span>
        <input
          required
          autoComplete="email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="h-11 w-full rounded-md border bg-paper px-3 text-sm shadow-sm outline-none focus:border-[var(--harbour-500)]"
        />
      </label>
      <label className="block">
        <span className="mb-1.5 flex items-center justify-between text-sm font-medium">
          Password
          <Link
            href="/forgot-password"
            className="text-[var(--harbour-700)] hover:underline"
          >
            Forgot password?
          </Link>
        </span>
        <input
          required
          autoComplete="current-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="h-11 w-full rounded-md border bg-paper px-3 text-sm shadow-sm outline-none focus:border-[var(--harbour-500)]"
        />
      </label>
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {error}
        </p>
      ) : null}
      {magicSent ? (
        <p
          role="status"
          className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800"
        >
          Check your email for a short-lived sign-in link.
        </p>
      ) : null}
      <Button className="w-full" size="lg" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <div className="flex items-center gap-3 text-xs text-slate-400">
        <span className="h-px flex-1 bg-[var(--border)]" />
        or
        <span className="h-px flex-1 bg-[var(--border)]" />
      </div>
      <Button
        type="button"
        variant="secondary"
        className="w-full"
        size="lg"
        onClick={sendMagicLink}
        disabled={pending || !email}
      >
        Email me a sign-in link
      </Button>
      <Button
        type="button"
        variant="secondary"
        className="w-full"
        size="lg"
        onClick={signInWithPasskey}
        disabled={pending}
      >
        Sign in with a passkey
      </Button>
      {providers.map((provider) => (
        <Button
          key={provider.id}
          type="button"
          variant="secondary"
          className="w-full"
          size="lg"
          onClick={() => signInWithProvider(provider)}
          disabled={pending}
        >
          Continue with {provider.label}
        </Button>
      ))}
      <Button
        type="button"
        variant="secondary"
        className="w-full"
        size="lg"
        onClick={() => setSsoOpen((open) => !open)}
        disabled={pending}
        aria-expanded={ssoOpen}
        aria-controls="sso-sign-in"
      >
        Sign in with SSO
      </Button>
      {ssoOpen ? (
        <div id="sso-sign-in" className="space-y-2 rounded-md border p-3">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">
              Work email or organisation SSO name
            </span>
            <input
              autoComplete="email"
              value={ssoIdentifier}
              onChange={(event) => setSsoIdentifier(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void signInWithSso(event);
              }}
              placeholder="you@company.com or acme-1a2b3c"
              className="h-11 w-full rounded-md border bg-paper px-3 text-sm shadow-sm outline-none focus:border-[var(--harbour-500)]"
            />
          </label>
          <Button
            type="button"
            className="w-full"
            onClick={signInWithSso}
            disabled={pending || !ssoIdentifier.trim()}
          >
            Continue with SSO
          </Button>
        </div>
      ) : null}
    </form>
  );
}
