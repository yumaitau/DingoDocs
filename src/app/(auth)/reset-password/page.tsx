"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";

function ResetPasswordForm() {
  const search = useSearchParams();
  const [message, setMessage] = useState("");
  async function submit(formData: FormData) {
    const token = search.get("token");
    if (!token) return setMessage("This reset link is invalid or incomplete.");
    const result = await authClient.resetPassword({
      token,
      newPassword: String(formData.get("password")),
    });
    setMessage(
      result.error?.message ?? "Password changed. You can now sign in.",
    );
  }
  return (
    <form action={submit} className="mt-7 space-y-4">
      <input
        name="password"
        type="password"
        minLength={14}
        maxLength={256}
        autoComplete="new-password"
        required
        placeholder="New password (14+ characters)"
        className="h-11 w-full rounded-md border bg-paper px-3 text-sm"
      />
      <Button className="w-full" size="lg">
        Change password
      </Button>
      {message ? (
        <p role="status" className="text-sm text-slate-600">
          {message}
        </p>
      ) : null}
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="w-full max-w-sm">
      <h1 className="text-2xl font-semibold">Choose a new password</h1>
      <p className="mt-2 text-sm text-slate-600">
        Compromised passwords are rejected and all other devices are signed out.
      </p>
      <Suspense
        fallback={<div className="mt-7 h-24 animate-pulse rounded bg-muted" />}
      >
        <ResetPasswordForm />
      </Suspense>
      <Link
        href="/sign-in"
        className="mt-6 block text-center text-sm text-[var(--harbour-700)] hover:underline"
      >
        Return to sign in
      </Link>
    </div>
  );
}
