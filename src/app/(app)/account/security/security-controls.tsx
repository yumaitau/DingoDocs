"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";
import {
  formatTotpSecret,
  normaliseOtpCode,
  totpSecretFromUri,
} from "@/lib/auth/two-factor";

type Enrolment = { totpURI: string; secret: string | null };

const textField = "h-10 min-w-0 flex-1 rounded-md border px-3 text-sm";

export function SecurityControls({
  twoFactorEnabled: twoFactorEnabledProp,
}: {
  /** Server-read flag; when omitted (portal page) the client session is used. */
  twoFactorEnabled?: boolean;
}) {
  const router = useRouter();
  const session = authClient.useSession();
  const twoFactorEnabled =
    twoFactorEnabledProp ??
    Boolean(
      (session.data?.user as { twoFactorEnabled?: boolean | null } | undefined)
        ?.twoFactorEnabled,
    );
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [verificationCode, setVerificationCode] = useState("");

  function report(text: string, isError = false) {
    setMessage(text);
    setError(isError);
  }

  async function addPasskey() {
    setPending(true);
    report("");
    const result = await authClient.passkey.addPasskey({ name: "DingoDocs" });
    setPending(false);
    if (result?.error)
      report(result.error.message ?? "Passkey registration failed", true);
    else report("Passkey registered successfully.");
  }

  async function enableMfa(formData: FormData) {
    setPending(true);
    report("");
    const result = await authClient.twoFactor.enable({
      password: String(formData.get("password")),
    });
    setPending(false);
    if (result.error) {
      report(result.error.message ?? "MFA enrolment failed", true);
      return;
    }
    if (result.data?.method !== "totp") {
      report("MFA enrolment failed: no authenticator secret returned", true);
      return;
    }
    setRecoveryCodes(result.data.backupCodes);
    setEnrolment({
      totpURI: result.data.totpURI,
      secret: totpSecretFromUri(result.data.totpURI),
    });
    setVerificationCode("");
    report(
      "Add the key to your authenticator app, save the recovery codes, then enter a code to finish enrolment.",
    );
  }

  async function verifyEnrolment(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    report("");
    try {
      const result = await authClient.twoFactor.verifyTotp({
        code: normaliseOtpCode(verificationCode),
      });
      if (result.error) {
        report(
          result.error.message ?? "That code was not accepted. Try again.",
          true,
        );
        return;
      }
      setEnrolment(null);
      setVerificationCode("");
      report("Multi-factor authentication is now enabled.");
      router.refresh();
    } catch {
      report(
        "Could not verify the code. Check your connection and retry.",
        true,
      );
    } finally {
      setPending(false);
    }
  }

  async function rotateRecoveryCodes(formData: FormData) {
    setPending(true);
    report("");
    const result = await authClient.twoFactor.generateBackupCodes({
      password: String(formData.get("password")),
    });
    setPending(false);
    if (result.data?.backupCodes) {
      setRecoveryCodes(result.data.backupCodes);
      report("New recovery codes generated. Previous codes no longer work.");
    } else {
      report(
        result.error?.message ?? "Could not generate recovery codes",
        true,
      );
    }
  }

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      report(`${label} copied.`);
    } catch {
      report(
        `Could not copy. Select the ${label.toLowerCase()} manually.`,
        true,
      );
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
          {twoFactorEnabled
            ? "An authenticator app is enrolled. You can replace your recovery codes below."
            : "Enrol an authenticator and receive one-time recovery codes."}
        </p>
        {twoFactorEnabled ? (
          <p className="mt-3 inline-flex rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800">
            MFA enabled
          </p>
        ) : (
          <form action={enableMfa} className="mt-4 flex gap-2">
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              aria-label="Current password to enrol MFA"
              placeholder="Current password"
              className={textField}
            />
            <Button disabled={pending}>
              {enrolment ? "Restart enrolment" : "Enrol MFA"}
            </Button>
          </form>
        )}
        {twoFactorEnabled ? (
          <form action={rotateRecoveryCodes} className="mt-3 flex gap-2">
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              aria-label="Current password to replace recovery codes"
              placeholder="Current password"
              className={textField}
            />
            <Button variant="secondary" disabled={pending}>
              Replace recovery codes
            </Button>
          </form>
        ) : null}
      </section>
      {enrolment ? (
        <section
          aria-labelledby="mfa-setup-heading"
          className="rounded-xl border bg-paper p-5 md:col-span-2"
        >
          <h2 id="mfa-setup-heading" className="font-semibold">
            Finish authenticator setup
          </h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-600">
            <li>
              In your authenticator app, add an account using the setup key (or
              paste the full otpauth link if your app accepts it).
            </li>
            <li>Save the recovery codes below somewhere safe.</li>
            <li>Enter the 6-digit code your app shows to confirm.</li>
          </ol>
          {enrolment.secret ? (
            <div className="mt-4">
              <label
                htmlFor="mfa-setup-key"
                className="block text-sm font-medium"
              >
                Setup key
              </label>
              <div className="mt-1 flex gap-2">
                <input
                  id="mfa-setup-key"
                  readOnly
                  value={formatTotpSecret(enrolment.secret)}
                  data-secret={enrolment.secret}
                  onFocus={(event) => event.currentTarget.select()}
                  className={`${textField} font-mono`}
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void copy(enrolment.secret ?? "", "Setup key")}
                >
                  Copy
                </Button>
              </div>
            </div>
          ) : null}
          <div className="mt-3">
            <label htmlFor="mfa-otpauth" className="block text-sm font-medium">
              otpauth link
            </label>
            <div className="mt-1 flex gap-2">
              <input
                id="mfa-otpauth"
                readOnly
                value={enrolment.totpURI}
                onFocus={(event) => event.currentTarget.select()}
                className={`${textField} font-mono text-xs`}
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => void copy(enrolment.totpURI, "otpauth link")}
              >
                Copy
              </Button>
            </div>
          </div>
          <form onSubmit={verifyEnrolment} className="mt-4 flex gap-2">
            <label htmlFor="mfa-verify-code" className="sr-only">
              Authenticator code
            </label>
            <input
              id="mfa-verify-code"
              required
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9 ]{6,7}"
              maxLength={7}
              placeholder="6-digit code"
              value={verificationCode}
              onChange={(event) => setVerificationCode(event.target.value)}
              className={`${textField} max-w-48 font-mono tracking-[0.3em]`}
            />
            <Button disabled={pending}>
              {pending ? "Verifying…" : "Verify and enable"}
            </Button>
          </form>
        </section>
      ) : null}
      {recoveryCodes.length ? (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-5 md:col-span-2">
          <h2 className="font-semibold">Save these recovery codes now</h2>
          <p className="mt-1 text-sm text-slate-600">
            Each code works once. They will not be shown again.
          </p>
          <ul
            aria-label="Recovery codes"
            className="mt-3 grid gap-1 font-mono text-sm sm:grid-cols-2"
          >
            {recoveryCodes.map((code) => (
              <li key={code}>{code}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {message ? (
        <p
          role={error ? "alert" : "status"}
          className={`md:col-span-2 text-sm ${error ? "text-red-700" : "text-slate-700"}`}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
