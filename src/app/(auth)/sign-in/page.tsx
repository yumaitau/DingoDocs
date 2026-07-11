import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 lg:hidden">
        <span className="grid size-9 place-items-center rounded-lg bg-primary font-semibold text-white">
          D
        </span>
      </div>
      <h2 className="text-2xl font-semibold tracking-[-0.02em]">
        Welcome back
      </h2>
      <p className="mt-2 text-sm text-slate-600">
        Sign in to continue to your organisation.
      </p>
      <Suspense
        fallback={
          <div className="mt-7 h-72 animate-pulse rounded-lg bg-muted" />
        }
      >
        <SignInForm />
      </Suspense>
      <p className="mt-6 text-center text-sm text-slate-500">
        New to DingoDocs?{" "}
        <Link
          href="/sign-up"
          className="font-medium text-[var(--harbour-700)] underline-offset-4 hover:underline"
        >
          Create an account
        </Link>
      </p>
    </div>
  );
}
