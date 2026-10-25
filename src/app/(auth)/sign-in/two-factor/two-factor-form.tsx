"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";
import { normaliseOtpCode } from "@/lib/auth/two-factor";
import { safeInternalPath } from "@/lib/security/internal-path";

type Mode = "totp" | "backup";

const input =
  "h-11 w-full rounded-md border bg-paper px-3 text-sm shadow-sm outline-none focus:border-[var(--harbour-500)]";

export function TwoFactorForm() {
  const search = useSearchParams();
  const router = useRouter();
  const next = safeInternalPath(search.get("next"));
  const [mode, setMode] = useState<Mode>("totp");
  const [code, setCode] = useState("");
  const [trustDevice, setTrustDevice] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const body = { code: normaliseOtpCode(code), trustDevice };
    try {
      const result =
        mode === "totp"
          ? await authClient.twoFactor.verifyTotp(body)
          : await authClient.twoFactor.verifyBackupCode(body);
      if (result.error) {
        setPending(false);
        setError(
          result.error.code === "INVALID_TWO_FACTOR_COOKIE"
            ? "Your sign-in attempt expired. Go back and sign in again."
            : (result.error.message ?? "That code was not accepted"),
        );
        return;
      }
      router.replace(next);
      router.refresh();
    } catch {
      setPending(false);
      setError("Could not verify the code. Check your connection and retry.");
    }
  }

  function switchMode(nextMode: Mode) {
    setMode(nextMode);
    setCode("");
    setError("");
  }

  return (
    <form onSubmit={submit} className="mt-7 space-y-4">
      {mode === "totp" ? (
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">
            Authenticator code
          </span>
          <input
            required
            autoFocus
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9 ]{6,7}"
            maxLength={7}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            className={`${input} font-mono tracking-[0.3em]`}
          />
        </label>
      ) : (
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">
            Recovery code
          </span>
          <input
            required
            autoFocus
            autoComplete="off"
            spellCheck={false}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            className={`${input} font-mono`}
          />
        </label>
      )}
      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={trustDevice}
          onChange={(event) => setTrustDevice(event.target.checked)}
        />
        Trust this device for 30 days
      </label>
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {error}
        </p>
      ) : null}
      <Button className="w-full" size="lg" disabled={pending}>
        {pending ? "Verifying…" : "Verify"}
      </Button>
      <button
        type="button"
        className="w-full text-center text-sm font-medium text-[var(--harbour-700)] hover:underline"
        onClick={() => switchMode(mode === "totp" ? "backup" : "totp")}
      >
        {mode === "totp"
          ? "Use a recovery code instead"
          : "Use an authenticator code instead"}
      </button>
    </form>
  );
}
