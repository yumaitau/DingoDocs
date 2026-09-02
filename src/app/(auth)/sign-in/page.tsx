import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { SignInForm } from "./sign-in-form";
import { publicAuthProviders } from "@/lib/auth/providers";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  const providers = publicAuthProviders();
  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 lg:hidden">
        <Image
          src="/brand/dingodocs-logo-mark.png"
          alt=""
          width={36}
          height={36}
          className="size-9 object-contain"
          priority
        />
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
        <SignInForm providers={providers} />
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
