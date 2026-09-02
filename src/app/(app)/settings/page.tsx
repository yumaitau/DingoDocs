import { and, eq, isNull } from "drizzle-orm";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { db } from "@/db";
import { evidence, evidenceLegalHolds } from "@/db/schema";
import { roles } from "@/lib/permissions/matrix";
import { requirePermission } from "@/lib/permissions/require";
import { formatDateTime } from "@/lib/time-zone";
import {
  createInvitationAction,
  placeLegalHoldAction,
  purgeRetentionAction,
  releaseLegalHoldAction,
  revokeInvitationAction,
  revokeUserSessionsAction,
} from "@/server/actions/security";
import {
  listOrganisationUsers,
  listPendingInvitations,
} from "@/server/services/account-security";
import { previewRetention } from "@/server/services/retention";

const field = "h-10 rounded-md border bg-paper px-3 text-sm";

export default async function SettingsPage() {
  const context = await requirePermission("user:manage");
  const [members, pendingInvitations, retentionPreview, activeHolds] =
    await Promise.all([
      listOrganisationUsers(context.organisationId),
      listPendingInvitations(context.organisationId),
      previewRetention(context.organisationId),
      db
        .select({
          id: evidenceLegalHolds.id,
          evidenceId: evidenceLegalHolds.evidenceId,
          reason: evidenceLegalHolds.reason,
          filename: evidence.originalFilename,
        })
        .from(evidenceLegalHolds)
        .innerJoin(evidence, eq(evidence.id, evidenceLegalHolds.evidenceId))
        .where(
          and(
            eq(evidenceLegalHolds.organisationId, context.organisationId),
            isNull(evidenceLegalHolds.releasedAt),
          ),
        ),
    ]);
  const bytes = retentionPreview.reduce((sum, item) => sum + item.sizeBytes, 0);

  return (
    <>
      <PageHeader
        title="Security and operations"
        description={`Authentication, sessions, invitations, and retention for ${context.name}.`}
      />
      <div className="grid gap-6 px-4 py-6 sm:px-6 xl:grid-cols-2 lg:px-8">
        <section className="rounded-xl border bg-paper p-5">
          <h2 className="font-semibold">Invite a team member</h2>
          <p className="mt-1 text-sm text-slate-500">
            Email links are random, hashed at rest, single-use, and expire in 72
            hours.
          </p>
          <form
            action={createInvitationAction}
            className="mt-4 grid gap-3 sm:grid-cols-[1fr_220px_auto]"
          >
            <input
              className={field}
              name="email"
              type="email"
              required
              placeholder="person@example.com"
            />
            <select className={field} name="role" defaultValue="consultant">
              {roles.map((role) => (
                <option key={role} value={role}>
                  {role.replaceAll("_", " ")}
                </option>
              ))}
            </select>
            <Button>Send invite</Button>
          </form>
          <ul className="mt-5 divide-y border-t">
            {pendingInvitations.map((invitation) => (
              <li
                key={invitation.id}
                className="flex items-center gap-3 py-3 text-sm"
              >
                <span className="min-w-0 flex-1 truncate">
                  {invitation.email} · {invitation.role.replaceAll("_", " ")} ·
                  expires{" "}
                  {formatDateTime(invitation.expiresAt, context.timeZone)}
                </span>
                <form action={revokeInvitationAction}>
                  <input
                    type="hidden"
                    name="invitationId"
                    value={invitation.id}
                  />
                  <Button variant="secondary" size="sm">
                    Revoke
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl border bg-paper p-5">
          <h2 className="font-semibold">Personal account security</h2>
          <p className="mt-1 text-sm text-slate-500">
            Register passkeys, rotate MFA recovery codes, and revoke your
            devices.
          </p>
          <Button asChild variant="secondary" className="mt-4">
            <Link href="/account/security">Manage account security</Link>
          </Button>
        </section>

        <section className="rounded-xl border bg-paper xl:col-span-2">
          <div className="border-b p-5">
            <h2 className="font-semibold">Administrator session revocation</h2>
            <p className="mt-1 text-sm text-slate-500">
              Force logout across every active browser for an organisation
              member.
            </p>
          </div>
          <ul className="divide-y">
            {members.map((member) => (
              <li key={member.userId} className="flex items-center gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {member.name} · {member.email}
                  </p>
                  <p className="text-xs text-slate-500">
                    {member.role.replaceAll("_", " ")} · {member.activeSessions}{" "}
                    active session(s)
                  </p>
                </div>
                <form action={revokeUserSessionsAction}>
                  <input type="hidden" name="userId" value={member.userId} />
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!member.activeSessions}
                  >
                    Force logout
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl border bg-paper p-5">
          <h2 className="font-semibold">Legal holds</h2>
          <p className="mt-1 text-sm text-slate-500">
            Held evidence is excluded from previews and scheduled destruction.
          </p>
          <form action={placeLegalHoldAction} className="mt-4 space-y-3">
            <input
              className={`${field} w-full`}
              name="evidenceId"
              required
              placeholder="Evidence UUID"
            />
            <input
              className={`${field} w-full`}
              name="reason"
              required
              placeholder="Legal or regulatory reason"
            />
            <Button>Place hold</Button>
          </form>
          <ul className="mt-5 divide-y border-t">
            {activeHolds.map((hold) => (
              <li
                key={hold.id}
                className="flex items-center gap-3 py-3 text-sm"
              >
                <span className="min-w-0 flex-1 truncate">
                  {hold.filename} · {hold.reason}
                </span>
                <form action={releaseLegalHoldAction}>
                  <input type="hidden" name="holdId" value={hold.id} />
                  <Button variant="secondary" size="sm">
                    Release
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl border bg-paper p-5">
          <h2 className="font-semibold">Retention preview and purge</h2>
          <p className="mt-1 text-sm text-slate-500">
            {retentionPreview.length} object(s), {bytes.toLocaleString()} bytes
            are eligible now. Metadata and destruction audits remain after blobs
            are removed.
          </p>
          <ul className="mt-3 max-h-36 space-y-1 overflow-auto text-xs text-slate-600">
            {retentionPreview.map((item) => (
              <li key={item.id}>
                {item.filename} ·{" "}
                {formatDateTime(item.retentionUntil, context.timeZone)}
              </li>
            ))}
          </ul>
          <form action={purgeRetentionAction} className="mt-4 flex gap-2">
            <input
              className={`${field} min-w-0 flex-1`}
              name="confirmation"
              required
              placeholder={`Type PURGE ${retentionPreview.length}`}
            />
            <Button disabled={!retentionPreview.length}>
              Purge permanently
            </Button>
          </form>
          <p className="mt-3 text-xs text-slate-500">
            Scheduled processing runs daily at 02:15 in the configured cron
            timezone.
          </p>
        </section>
      </div>
    </>
  );
}
