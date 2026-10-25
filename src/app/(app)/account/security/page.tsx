import { eq } from "drizzle-orm";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireOrganisationContext } from "@/lib/permissions/require";
import { formatDateTime } from "@/lib/time-zone";
import { revokeOwnSessionAction } from "@/server/actions/security";
import { listUserDevices } from "@/server/services/account-security";
import { SecurityControls } from "./security-controls";

export default async function AccountSecurityPage() {
  const context = await requireOrganisationContext();
  const [devices, [account]] = await Promise.all([
    listUserDevices(context.userId),
    db
      .select({ twoFactorEnabled: users.twoFactorEnabled })
      .from(users)
      .where(eq(users.id, context.userId))
      .limit(1),
  ]);
  return (
    <>
      <PageHeader
        title="Account security"
        description="Manage passkeys, multi-factor recovery, and signed-in devices."
      />
      <div className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <SecurityControls
          twoFactorEnabled={Boolean(account?.twoFactorEnabled)}
        />
        <section className="rounded-xl border bg-paper">
          <div className="border-b p-5">
            <h2 className="font-semibold">Signed-in devices</h2>
            <p className="mt-1 text-sm text-slate-500">
              Sessions expire after eight hours and can be revoked immediately.
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
    </>
  );
}
