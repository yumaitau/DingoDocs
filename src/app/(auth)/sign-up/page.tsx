import type { Metadata } from "next";
import Link from "next/link";
import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = { title: "Create account" };
export default function SignUpPage() {
  return (
    <div className="w-full max-w-sm">
      <h2 className="text-2xl font-semibold tracking-[-0.02em]">
        Create your account
      </h2>
      <p className="mt-2 text-sm text-slate-600">
        Start a new DingoDocs organisation.
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
