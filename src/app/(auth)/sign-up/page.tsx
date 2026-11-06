import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { signUpMode } from "@/lib/auth/sign-up-policy";
import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = { title: "Create account" };
export default async function SignUpPage() {
  // SIGN_UP_MODE is runtime configuration, so render per request.
  await connection();
  const mode = signUpMode();
  if (mode === "closed")
    return (
      <div className="w-full max-w-sm">
        <h2 className="text-2xl font-semibold tracking-[-0.02em]">
          Sign-up is disabled
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          Accounts on this DingoDocs instance are created by an administrator.
          Ask yours for access.
        </p>
        <p className="mt-6 text-center text-sm text-slate-500">
          <Link
            href="/sign-in"
            className="font-medium text-[var(--harbour-700)] hover:underline"
          >
            Back to sign in
          </Link>
        </p>
      </div>
    );
  return (
    <div className="w-full max-w-sm">
      <h2 className="text-2xl font-semibold tracking-[-0.02em]">
        Create your account
      </h2>
      <p className="mt-2 text-sm text-slate-600">
        {mode === "invite"
          ? "Use the email address your invitation was sent to."
          : "Start a new DingoDocs organisation."}
      </p>
      <SignUpForm />
      <p className="mt-6 text-center text-sm text-slate-500">
        Already have an account?{" "}
        <Link
          href="/sign-in"
          className="font-medium text-[var(--harbour-700)] hover:underline"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
