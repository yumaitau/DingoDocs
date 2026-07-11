import { and, eq, isNull } from "drizzle-orm";
import { Plus, Users } from "lucide-react";
import { db } from "@/db";
import { organisationMembers, users } from "@/db/schema";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { requireOrganisationContext } from "@/lib/permissions/require";

export default async function TeamPage() {
  const context = await requireOrganisationContext();
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: organisationMembers.role,
      joinedAt: organisationMembers.joinedAt,
    })
    .from(organisationMembers)
    .innerJoin(users, eq(users.id, organisationMembers.userId))
    .where(
      and(
        eq(organisationMembers.organisationId, context.organisationId),
        isNull(organisationMembers.deletedAt),
      ),
    );
  return (
    <>
      <PageHeader
        title="Team"
        description="Organisation membership, delivery roles, and secure invitations."
        actions={
          <Button>
            <Plus className="size-4" />
            Invite member
          </Button>
        }
      />
      <div className="px-4 py-6 sm:px-6 lg:px-8">
        <div className="overflow-hidden rounded-xl border bg-paper">
          {rows.map((member) => (
            <div
              key={member.id}
              className="grid gap-3 border-b p-4 last:border-0 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-center"
            >
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-full bg-[var(--harbour-100)] text-xs font-semibold text-[var(--harbour-700)]">
                  {member.name.slice(0, 2).toUpperCase()}
                </span>
                <div>
                  <p className="text-sm font-medium">{member.name}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {member.email}
                  </p>
                </div>
              </div>
              <StatusPill tone="info">
                {member.role.replaceAll("_", " ")}
              </StatusPill>
            </div>
          ))}
          {!rows.length ? (
            <div className="p-14 text-center text-sm text-slate-500">
              <Users className="mx-auto mb-3 size-6" />
              No team members.
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
