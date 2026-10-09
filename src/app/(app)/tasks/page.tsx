import { and, asc, eq, inArray } from "drizzle-orm";
import { CheckSquare, LayoutGrid, List, Plus } from "lucide-react";
import Link from "next/link";
import { db } from "@/db";
import { taskStatusEnum, tasks } from "@/db/schema";
import { PageHeader } from "@/components/page-header";
import { TaskBoard, TaskStatusSelect } from "@/components/task-board";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { engagementVisibility } from "@/lib/permissions/access";
import { requireOrganisationContext } from "@/lib/permissions/require";
import { formatDateTime } from "@/lib/time-zone";
import { listViews, saveViewAction } from "@/server/actions/planning";

const field =
  "h-9 rounded-md border bg-paper px-2.5 text-sm outline-none focus:border-[var(--harbour-500)]";

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireOrganisationContext();
  const raw = await searchParams;
  const view = Array.isArray(raw.view) ? raw.view[0] : raw.view;
  const board = view === "board";
  const [rows, views] = await Promise.all([
    db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.organisationId, context.organisationId),
          board
            ? inArray(tasks.status, [
                "backlog",
                "todo",
                "in_progress",
                "blocked",
                "done",
              ])
            : inArray(tasks.status, [
                "backlog",
                "todo",
                "in_progress",
                "blocked",
              ]),
          engagementVisibility(context, tasks.engagementId),
        ),
      )
      .orderBy(asc(tasks.dueAt))
      .limit(100),
    listViews("tasks"),
  ]);
  const filterSnapshot = board ? { view: "board" } : {};

  return (
    <>
      <PageHeader
        title="Tasks"
        description="Personal, delivery, QA, retesting, and client action items."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant={board ? "secondary" : "primary"}>
              <Link href="/tasks">
                <List className="size-4" />
                List
              </Link>
            </Button>
            <Button asChild variant={board ? "primary" : "secondary"}>
              <Link href="/tasks?view=board">
                <LayoutGrid className="size-4" />
                Board
              </Link>
            </Button>
            <Button>
              <Plus className="size-4" />
              New task
            </Button>
          </div>
        }
      />
      <div className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="rounded-xl border bg-paper p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Saved views</h2>
              <p className="mt-1 text-xs text-slate-500">
                Persist the current list or board query.
              </p>
            </div>
            <form action={saveViewAction} className="flex flex-wrap gap-2">
              <input type="hidden" name="resource" value="tasks" />
              <input
                type="hidden"
                name="filtersJson"
                value={JSON.stringify(filterSnapshot)}
              />
              <input
                className={field}
                name="name"
                placeholder="View name"
                required
                maxLength={120}
              />
              <Button type="submit" variant="secondary">
                Save view
              </Button>
            </form>
          </div>
          {views.length ? (
            <ul className="mt-3 flex flex-wrap gap-2">
              {views.map((saved) => (
                <li key={saved.id}>
                  <Link
                    className="inline-flex rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--harbour-50)]"
                    href={`/tasks?${toQuery(saved.filters)}`}
                  >
                    {saved.name}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-xs text-slate-500">No saved views yet.</p>
          )}
        </section>

        {board ? (
          <TaskBoard
            tasks={rows.map((task) => ({
              id: task.id,
              title: task.title,
              description: task.description,
              status: task.status,
              priority: task.priority,
              dueLabel: task.dueAt
                ? formatDateTime(task.dueAt, context.timeZone)
                : "No due date",
            }))}
          />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-paper">
            {rows.length ? (
              <ul className="divide-y">
                {rows.map((task) => (
                  <li
                    key={task.id}
                    className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_130px_160px_150px] sm:items-center"
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
                    <TaskStatusSelect
                      taskId={task.id}
                      status={task.status}
                      statuses={taskStatusEnum.enumValues}
                    />
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
        )}
      </div>
    </>
  );
}

function toQuery(filters: Record<string, unknown>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  return params.toString();
}
