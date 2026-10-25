import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { TwoFactorForm } from "./two-factor-form";

export const metadata: Metadata = { title: "Two-factor verification" };

export default function TwoFactorPage() {
  return (
    <div className="w-full max-w-sm">
      <h2 className="text-2xl font-semibold tracking-[-0.02em]">
        Two-factor verification
      </h2>
      <p className="mt-2 text-sm text-slate-600">
        Enter the 6-digit code from your authenticator app, or one of your
        recovery codes.
      </p>
      <Suspense
        fallback={
          <div className="mt-7 h-56 animate-pulse rounded-lg bg-muted" />
        }
      >
        <TwoFactorForm />
      </Suspense>
      <p className="mt-6 text-center text-sm text-slate-500">
        <Link
          href="/sign-in"
          className="font-medium text-[var(--harbour-700)] underline-offset-4 hover:underline"
        >
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
