import { inArray, eq, and, asc } from "drizzle-orm";
import { CheckSquare, Plus } from "lucide-react";
import { db } from "@/db";
import { tasks } from "@/db/schema";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { requireOrganisationContext } from "@/lib/permissions/require";
import { formatDateTime } from "@/lib/time-zone";

export default async function TasksPage() {
  const context = await requireOrganisationContext();
  const rows = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.organisationId, context.organisationId),
        inArray(tasks.status, ["backlog", "todo", "in_progress", "blocked"]),
      ),
    )
    .orderBy(asc(tasks.dueAt))
    .limit(100);
  return (
    <>
      <PageHeader
        title="Tasks"
        description="Personal, delivery, QA, retesting, and client action items."
        actions={
          <Button>
            <Plus className="size-4" />
            New task
          </Button>
        }
      />
      <div className="px-4 py-6 sm:px-6 lg:px-8">
        <div className="overflow-hidden rounded-xl border bg-paper">
          {rows.length ? (
            <ul className="divide-y">
              {rows.map((task) => (
                <li
                  key={task.id}
                  className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_130px_130px] sm:items-center"
                >
                  <div className="flex gap-3">
                    <CheckSquare className="mt-0.5 size-4 text-slate-400" />
                    <div>
                      <p className="text-sm font-medium">{task.title}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {task.description ?? "No description"}
                      </p>
                    </div>
                  </div>
                  <StatusPill
                    tone={
                      task.priority === "urgent"
                        ? "danger"
                        : task.priority === "high"
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {task.priority}
                  </StatusPill>
                  <span className="text-xs text-slate-500">
                    {task.dueAt
                      ? formatDateTime(task.dueAt, context.timeZone)
                      : "No due date"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-14 text-center text-sm text-slate-500">
              No open tasks.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
