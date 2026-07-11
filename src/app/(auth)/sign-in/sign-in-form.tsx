"use client";

import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";
import type { PublicAuthProvider } from "@/lib/auth/providers";

export function SignInForm({ providers }: { providers: PublicAuthProvider[] }) {
  const search = useSearchParams();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [magicSent, setMagicSent] = useState(false);
  const requestedNext = search.get("next");
  const callbackURL =
    requestedNext?.startsWith("/") && !requestedNext.startsWith("//")
      ? requestedNext
      : "/dashboard";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const result = await authClient.signIn.email({
      email,
      password,
      callbackURL,
    });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "Unable to sign in");
      return;
    }
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
    const result =
      provider.protocol === "social"
        ? await authClient.signIn.social({
            provider: provider.id as "google" | "github",
            callbackURL,
          })
        : await authClient.signIn.oauth2({
            providerId: provider.id,
            callbackURL,
          });
    setPending(false);
    if (result.error)
      setError(
        result.error.message ?? `Unable to sign in with ${provider.label}`,
      );
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
    </form>
  );
}
