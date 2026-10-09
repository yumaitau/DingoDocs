import { and, asc, eq, isNull } from "drizzle-orm";
import { BriefcaseBusiness, Plus } from "lucide-react";
import { db } from "@/db";
import { clients, opportunities } from "@/db/schema";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { requireInternalOrganisationContext } from "@/lib/permissions/require";
import { createOpportunityAction } from "@/server/actions/planning";

const field =
  "h-10 w-full rounded-md border bg-paper px-3 text-sm outline-none focus:border-[var(--harbour-500)]";
const area = `${field} min-h-24 py-2`;

const stages = ["lead", "scoped", "proposal", "won", "lost"] as const;

export default async function OpportunitiesPage() {
  const context = await requireInternalOrganisationContext();
  const organisationId = context.organisationId;

  const [rows, clientRows] = await Promise.all([
    db
      .select({
        id: opportunities.id,
        name: opportunities.name,
        stage: opportunities.stage,
        value: opportunities.value,
        sowTemplate: opportunities.sowTemplate,
        clientId: opportunities.clientId,
        clientName: clients.name,
        createdAt: opportunities.createdAt,
      })
      .from(opportunities)
      .leftJoin(
        clients,
        and(
          eq(clients.id, opportunities.clientId),
          eq(clients.organisationId, organisationId),
        ),
      )
      .where(
        and(
          eq(opportunities.organisationId, organisationId),
          isNull(opportunities.deletedAt),
        ),
      )
      .orderBy(asc(opportunities.name)),
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
  ]);

  return (
    <>
      <PageHeader
        title="Opportunities"
        description="Pre-sales pipeline and statement-of-work drafts."
      />
      <div className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <details className="rounded-xl border bg-paper" open={!rows.length}>
          <summary className="flex cursor-pointer list-none items-center gap-2 p-5 font-semibold">
            <Plus className="size-4" /> Create opportunity
          </summary>
          <form
            action={createOpportunityAction}
            className="grid gap-4 border-t p-5 md:grid-cols-2"
          >
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-600">
                Name
              </span>
              <input className={field} name="name" required maxLength={160} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-600">
                Client
              </span>
              <select className={field} name="clientId">
                <option value="">No client yet</option>
                {clientRows.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-600">
                Stage
              </span>
              <select className={field} name="stage" defaultValue="lead">
                {stages.map((stage) => (
                  <option key={stage} value={stage}>
                    {stage}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-600">
                Value
              </span>
              <input
                className={field}
                name="value"
                placeholder="e.g. 45000"
                maxLength={80}
              />
            </label>
            <label className="block md:col-span-2">
              <span className="mb-1.5 block text-xs font-medium text-slate-600">
                SoW template
              </span>
              <textarea
                className={area}
                name="sowTemplate"
                rows={6}
                placeholder="Paste or draft the statement of work"
              />
            </label>
            <div className="md:col-span-2">
              <Button type="submit">Create opportunity</Button>
            </div>
          </form>
        </details>

        <div className="overflow-hidden rounded-xl border bg-paper">
          {rows.length ? (
            <ul className="divide-y">
              {rows.map((row) => (
                <li
                  key={row.id}
                  className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_120px_120px] sm:items-start"
                >
                  <div className="flex gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-slate-500">
                      <BriefcaseBusiness className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{row.name}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {row.clientName ?? "No client"}
                      </p>
                      {row.sowTemplate ? (
                        <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs text-slate-600">
                          {row.sowTemplate}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <StatusPill tone={stageTone(row.stage)}>
                    {row.stage}
                  </StatusPill>
                  <span className="text-sm tabular-nums text-slate-600">
                    {row.value ?? "—"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-5 py-16 text-center">
              <BriefcaseBusiness className="mx-auto size-7 text-slate-400" />
              <h2 className="mt-3 text-sm font-semibold">No opportunities</h2>
              <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
                Capture leads and draft SoW language before scoping work.
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function stageTone(stage: string) {
  if (stage === "won") return "success" as const;
  if (stage === "lost") return "danger" as const;
  if (stage === "proposal" || stage === "scoped") return "info" as const;
  return "neutral" as const;
}
