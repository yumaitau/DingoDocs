"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";

export default function ForgotPasswordPage() {
  const [message, setMessage] = useState("");
  async function submit(formData: FormData) {
    await authClient.requestPasswordReset({
      email: String(formData.get("email")),
      redirectTo: "/reset-password",
    });
    setMessage(
      "If that account exists, a short-lived reset link has been sent.",
    );
  }
  return (
    <div className="w-full max-w-sm">
      <h1 className="text-2xl font-semibold">Reset your password</h1>
      <p className="mt-2 text-sm text-slate-600">
        Reset links expire after 30 minutes and revoke other sessions when used.
      </p>
      <form action={submit} className="mt-7 space-y-4">
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="Email address"
          className="h-11 w-full rounded-md border bg-paper px-3 text-sm"
        />
        <Button className="w-full" size="lg">
          Send reset link
        </Button>
      </form>
      {message ? (
        <p role="status" className="mt-4 text-sm text-slate-600">
          {message}
        </p>
      ) : null}
      <Link
        href="/sign-in"
        className="mt-6 block text-center text-sm text-[var(--harbour-700)] hover:underline"
      >
        Return to sign in
      </Link>
    </div>
  );
}
