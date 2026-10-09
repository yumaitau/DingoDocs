import { and, asc, count, eq, isNull } from "drizzle-orm";
import { FolderKanban, Plus } from "lucide-react";
import Link from "next/link";
import { db } from "@/db";
import { clients, engagements, findings, programs } from "@/db/schema";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { engagementVisibility } from "@/lib/permissions/access";
import { requireInternalOrganisationContext } from "@/lib/permissions/require";
import {
  assignEngagementProgramAction,
  createProgramAction,
} from "@/server/actions/planning";

const field =
  "h-10 w-full rounded-md border bg-paper px-3 text-sm outline-none focus:border-[var(--harbour-500)]";

export default async function ProgramsPage() {
  const context = await requireInternalOrganisationContext();
  const organisationId = context.organisationId;

  const [programRows, clientRows, engagementRows, findingCountRows] =
    await Promise.all([
      db
        .select({
          id: programs.id,
          name: programs.name,
          year: programs.year,
          clientId: programs.clientId,
          clientName: clients.name,
        })
        .from(programs)
        .innerJoin(
          clients,
          and(
            eq(clients.id, programs.clientId),
            eq(clients.organisationId, organisationId),
          ),
        )
        .where(
          and(
            eq(programs.organisationId, organisationId),
            isNull(programs.deletedAt),
          ),
        )
        .orderBy(asc(programs.name)),
      db
        .select({ id: clients.id, name: clients.name })
        .from(clients)
        .where(
          and(
            eq(clients.organisationId, organisationId),
            isNull(clients.deletedAt),
          ),
        )
        .orderBy(asc(clients.name)),
      db
        .select({
          id: engagements.id,
          name: engagements.name,
          programId: engagements.programId,
          clientName: clients.name,
        })
        .from(engagements)
        .innerJoin(
          clients,
          and(
            eq(clients.id, engagements.clientId),
            eq(clients.organisationId, organisationId),
          ),
        )
        .where(
          and(
            eq(engagements.organisationId, organisationId),
            isNull(engagements.deletedAt),
            engagementVisibility(context, engagements.id),
          ),
        )
        .orderBy(asc(engagements.name)),
      db
        .select({
          programId: engagements.programId,
          findingCount: count(findings.id),
        })
        .from(engagements)
        .leftJoin(
          findings,
          and(
            eq(findings.engagementId, engagements.id),
            eq(findings.organisationId, organisationId),
            isNull(findings.deletedAt),
          ),
        )
        .where(
          and(
            eq(engagements.organisationId, organisationId),
            isNull(engagements.deletedAt),
          ),
        )
        .groupBy(engagements.programId),
    ]);

  const counts = new Map(
    findingCountRows
      .filter((row) => row.programId)
      .map((row) => [row.programId!, Number(row.findingCount)] as const),
  );
  const engagementCountByProgram = new Map<string, number>();
  for (const row of engagementRows) {
    if (!row.programId) continue;
    engagementCountByProgram.set(
      row.programId,
      (engagementCountByProgram.get(row.programId) ?? 0) + 1,
    );
  }

  return (
    <>
      <PageHeader
        title="Programs"
        description="Group engagements by client and year, then roll up finding volume."
      />
      <div className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <details
          className="rounded-xl border bg-paper"
          open={!programRows.length}
        >
          <summary className="flex cursor-pointer list-none items-center gap-2 p-5 font-semibold">
            <Plus className="size-4" /> Create program
          </summary>
          <form
            action={createProgramAction}
            className="grid gap-4 border-t p-5 md:grid-cols-3"
          >
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-600">
                Client
              </span>
              <select className={field} name="clientId" required>
                <option value="">Select client</option>
                {clientRows.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-600">
                Name
              </span>
              <input className={field} name="name" required maxLength={160} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-600">
                Year
              </span>
              <input
                className={field}
                name="year"
                type="number"
                min={2000}
                max={2100}
                placeholder={String(new Date().getFullYear())}
              />
            </label>
            <div className="md:col-span-3">
              <Button type="submit">Create program</Button>
            </div>
          </form>
        </details>

        <div className="overflow-hidden rounded-xl border bg-paper">
          {programRows.length ? (
            <ul className="divide-y">
              {programRows.map((program) => (
                <li
                  key={program.id}
                  className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_120px_120px] sm:items-center"
                >
                  <div className="flex gap-3">
                    <span className="grid size-9 place-items-center rounded-md bg-muted text-slate-500">
                      <FolderKanban className="size-4" />
                    </span>
                    <div>
                      <p className="text-sm font-medium">{program.name}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {program.clientName}
                        {program.year ? ` · ${program.year}` : ""}
                      </p>
                    </div>
                  </div>
                  <span className="text-sm tabular-nums text-slate-600">
                    {engagementCountByProgram.get(program.id) ?? 0} engagements
                  </span>
                  <span className="text-sm tabular-nums text-slate-600">
                    {counts.get(program.id) ?? 0} findings
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-5 py-16 text-center">
              <FolderKanban className="mx-auto size-7 text-slate-400" />
              <h2 className="mt-3 text-sm font-semibold">No programs yet</h2>
              <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
                Create a program to group recurring or related engagements.
              </p>
            </div>
          )}
        </div>

        <section className="rounded-xl border bg-paper">
          <div className="border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Assign engagement</h2>
            <p className="mt-1 text-xs text-slate-500">
              Link an engagement to a program for roll-up analytics.
            </p>
          </div>
          <ul className="divide-y">
            {engagementRows.map((engagement) => (
              <li
                key={engagement.id}
                className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_220px_auto] md:items-end"
              >
                <div>
                  <Link
                    href={`/engagements/${engagement.id}`}
                    className="text-sm font-medium hover:underline"
                  >
                    {engagement.name}
                  </Link>
                  <p className="mt-1 text-xs text-slate-500">
                    {engagement.clientName}
                  </p>
                </div>
                <form
                  action={assignEngagementProgramAction}
                  className="contents"
                >
                  <input
                    type="hidden"
                    name="engagementId"
                    value={engagement.id}
                  />
                  <label className="block">
                    <span className="mb-1 block text-xs text-slate-600">
                      Program
                    </span>
                    <select
                      className={field}
                      name="programId"
                      defaultValue={engagement.programId ?? ""}
                    >
                      <option value="">Unassigned</option>
                      {programRows.map((program) => (
                        <option key={program.id} value={program.id}>
                          {program.name}
                          {program.year ? ` (${program.year})` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button type="submit" variant="secondary">
                    Save
                  </Button>
                </form>
              </li>
            ))}
          </ul>
          {!engagementRows.length ? (
            <p className="px-4 py-10 text-center text-sm text-slate-500">
              No engagements available.
            </p>
          ) : null}
        </section>
      </div>
    </>
  );
}
