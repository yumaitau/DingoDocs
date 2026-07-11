"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";

export function SecurityControls() {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);

  async function addPasskey() {
    setPending(true);
    setMessage("");
    const result = await authClient.passkey.addPasskey({ name: "DingoDocs" });
    setPending(false);
    setMessage(
      result.error
        ? (result.error.message ?? "Passkey registration failed")
        : "Passkey registered successfully.",
    );
  }

  async function enableMfa(formData: FormData) {
    setPending(true);
    setMessage("");
    const result = await authClient.twoFactor.enable({
      password: String(formData.get("password")),
    });
    setPending(false);
    if (result.data?.backupCodes) setRecoveryCodes(result.data.backupCodes);
    setMessage(
      result.error
        ? (result.error.message ?? "MFA enrolment failed")
        : "MFA enrolment started. Save the recovery codes before confirming your authenticator.",
    );
  }

  async function rotateRecoveryCodes(formData: FormData) {
    setPending(true);
    setMessage("");
    const result = await authClient.twoFactor.generateBackupCodes({
      password: String(formData.get("password")),
    });
    setPending(false);
    if (result.data?.backupCodes) {
      setRecoveryCodes(result.data.backupCodes);
      setMessage(
        "New recovery codes generated. Previous codes no longer work.",
      );
    } else {
      setMessage(result.error?.message ?? "Could not generate recovery codes");
    }
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section className="rounded-xl border bg-paper p-5">
        <h2 className="font-semibold">Passkeys</h2>
        <p className="mt-1 text-sm text-slate-500">
          Register a platform authenticator or hardware security key.
        </p>
        <Button className="mt-4" onClick={addPasskey} disabled={pending}>
          Add passkey
        </Button>
      </section>
      <section className="rounded-xl border bg-paper p-5">
        <h2 className="font-semibold">Multi-factor authentication</h2>
        <p className="mt-1 text-sm text-slate-500">
          Enrol an authenticator and receive one-time recovery codes.
        </p>
        <form action={enableMfa} className="mt-4 flex gap-2">
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            placeholder="Current password"
            className="h-10 min-w-0 flex-1 rounded-md border px-3 text-sm"
          />
          <Button disabled={pending}>Enrol MFA</Button>
        </form>
        <form action={rotateRecoveryCodes} className="mt-3 flex gap-2">
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            placeholder="Current password"
            className="h-10 min-w-0 flex-1 rounded-md border px-3 text-sm"
          />
          <Button variant="secondary" disabled={pending}>
            Replace recovery codes
          </Button>
        </form>
      </section>
      {recoveryCodes.length ? (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-5 md:col-span-2">
          <h2 className="font-semibold">Save these recovery codes now</h2>
          <p className="mt-1 text-sm text-slate-600">
            Each code works once. They will not be shown again.
          </p>
          <ul className="mt-3 grid gap-1 font-mono text-sm sm:grid-cols-2">
            {recoveryCodes.map((code) => (
              <li key={code}>{code}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {message ? (
        <p role="status" className="md:col-span-2 text-sm text-slate-700">
          {message}
        </p>
      ) : null}
    </div>
  );
}
