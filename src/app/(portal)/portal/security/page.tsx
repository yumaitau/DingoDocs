import { Button } from "@/components/ui/button";
import { requireOrganisationContext } from "@/lib/permissions/require";
import { formatDateTime } from "@/lib/time-zone";
import { revokeOwnSessionAction } from "@/server/actions/security";
import { listUserDevices } from "@/server/services/account-security";
import { SecurityControls } from "@/app/(app)/account/security/security-controls";

export default async function PortalSecurityPage() {
  const context = await requireOrganisationContext();
  const devices = await listUserDevices(context.userId);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">
          Account security
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Manage passkeys, multi-factor recovery, and signed-in devices.
        </p>
      </div>
      <SecurityControls />
      <section className="rounded-xl border bg-paper">
        <div className="border-b p-5">
          <h2 className="font-semibold">Signed-in devices</h2>
          <p className="mt-1 text-sm text-slate-500">
            Sessions can be revoked immediately.
          </p>
        </div>
        <ul className="divide-y">
          {devices.map((device) => (
            <li key={device.id} className="flex items-center gap-4 p-5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {device.userAgent || "Unknown browser"}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {device.ipAddress || "Unknown network"} · expires{" "}
                  {formatDateTime(device.expiresAt, context.timeZone)}
                </p>
              </div>
              <form action={revokeOwnSessionAction}>
                <input type="hidden" name="sessionId" value={device.id} />
                <Button variant="secondary" size="sm">
                  Revoke
                </Button>
              </form>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
