import { and, asc, eq, isNull } from "drizzle-orm";
import { CalendarDays } from "lucide-react";
import Link from "next/link";
import { db } from "@/db";
import { clients, engagements } from "@/db/schema";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { engagementVisibility } from "@/lib/permissions/access";
import { requireInternalOrganisationContext } from "@/lib/permissions/require";
import {
  createNextOccurrenceAction,
  setEngagementRecurrenceAction,
} from "@/server/actions/planning";

const field =
  "h-9 w-full rounded-md border bg-paper px-2.5 text-sm outline-none focus:border-[var(--harbour-500)]";

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireInternalOrganisationContext();
  const raw = await searchParams;
  const monthParam = Array.isArray(raw.month) ? raw.month[0] : raw.month;
  const anchor = parseMonth(monthParam) ?? startOfMonth(new Date());
  const monthStart = startOfMonth(anchor);
  const monthEnd = endOfMonth(anchor);
  const gridStart = startOfWeek(monthStart);
  const gridEnd = endOfWeek(monthEnd);

  const rows = await db
    .select({
      id: engagements.id,
      name: engagements.name,
      status: engagements.status,
      startDate: engagements.startDate,
      endDate: engagements.endDate,
      recurrence: engagements.recurrence,
      clientName: clients.name,
    })
    .from(engagements)
    .innerJoin(
      clients,
      and(
        eq(clients.id, engagements.clientId),
        eq(clients.organisationId, context.organisationId),
      ),
    )
    .where(
      and(
        eq(engagements.organisationId, context.organisationId),
        isNull(engagements.deletedAt),
        engagementVisibility(context, engagements.id),
      ),
    )
    .orderBy(asc(engagements.startDate));

  const days = eachDay(gridStart, gridEnd);
  const weeks = chunk(days, 7);
  const capacity = weeks.map((week) => ({
    label: `${formatDay(week[0]!)} – ${formatDay(week[6]!)}`,
    count: rows.filter((row) =>
      overlapsWeek(row.startDate, row.endDate, week[0]!, week[6]!),
    ).length,
  }));
  const prev = shiftMonth(monthStart, -1);
  const next = shiftMonth(monthStart, 1);

  return (
    <>
      <PageHeader
        title="Schedule"
        description="Month view of engagements, weekly capacity, and recurrence."
      />
      <div className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CalendarDays className="size-4 text-slate-500" />
            <h2 className="text-base font-semibold">
              {monthStart.toLocaleString("en-AU", {
                month: "long",
                year: "numeric",
                timeZone: "UTC",
              })}
            </h2>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="secondary">
              <Link href={`/schedule?month=${isoMonth(prev)}`}>Previous</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/schedule">Today</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href={`/schedule?month=${isoMonth(next)}`}>Next</Link>
            </Button>
          </div>
        </div>

        <section className="rounded-xl border bg-paper p-4">
          <h3 className="text-sm font-semibold">Weekly capacity</h3>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {capacity.map((week) => (
              <li
                key={week.label}
                className="rounded-lg border bg-[var(--mist)] px-3 py-2 text-sm"
              >
                <span className="block text-xs text-slate-500">
                  {week.label}
                </span>
                <span className="mt-1 block font-semibold tabular-nums">
                  {week.count} overlapping
                </span>
              </li>
            ))}
          </ul>
        </section>

        <div className="overflow-x-auto rounded-xl border bg-paper">
          <div className="grid min-w-[720px] grid-cols-7 border-b bg-[var(--mist)] text-center text-xs font-medium text-slate-500">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
              <div key={day} className="px-2 py-2">
                {day}
              </div>
            ))}
          </div>
          <div className="grid min-w-[720px] grid-cols-7">
            {days.map((day) => {
              const inMonth = day.getUTCMonth() === monthStart.getUTCMonth();
              const dayKey = isoDate(day);
              const dayRows = rows.filter((row) =>
                coversDay(row.startDate, row.endDate, dayKey),
              );
              return (
                <div
                  key={dayKey}
                  className={`min-h-28 border-b border-r p-2 ${
                    inMonth ? "bg-paper" : "bg-[var(--mist)]/60"
                  }`}
                >
                  <div
                    className={`text-xs tabular-nums ${
                      inMonth ? "text-slate-700" : "text-slate-400"
                    }`}
                  >
                    {day.getUTCDate()}
                  </div>
                  <ul className="mt-1 space-y-1">
                    {dayRows.slice(0, 3).map((row) => (
                      <li key={row.id}>
                        <Link
                          href={`/engagements/${row.id}`}
                          className="block truncate rounded border bg-[var(--harbour-50)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--harbour-700)] hover:underline"
                        >
                          {row.name}
                        </Link>
                      </li>
                    ))}
                    {dayRows.length > 3 ? (
                      <li className="text-[10px] text-slate-500">
                        +{dayRows.length - 3} more
                      </li>
                    ) : null}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>

        <section className="rounded-xl border bg-paper">
          <div className="border-b px-4 py-3">
            <h3 className="text-sm font-semibold">Recurrence</h3>
            <p className="mt-1 text-xs text-slate-500">
              Set weekly, monthly, or quarterly cadence. Create the next
              occurrence as a proposed engagement with shifted dates.
            </p>
          </div>
          <ul className="divide-y">
            {rows.map((row) => (
              <li
                key={row.id}
                className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1.4fr)_1fr_auto] lg:items-end"
              >
                <div>
                  <Link
                    href={`/engagements/${row.id}`}
                    className="text-sm font-medium hover:underline"
                  >
                    {row.name}
                  </Link>
                  <p className="mt-1 text-xs text-slate-500">
                    {row.clientName} · {row.startDate ?? "—"} →{" "}
                    {row.endDate ?? "—"} · {row.status}
                  </p>
                </div>
                <form
                  action={setEngagementRecurrenceAction}
                  className="flex flex-wrap items-end gap-2"
                >
                  <input type="hidden" name="engagementId" value={row.id} />
                  <label className="min-w-[160px] flex-1">
                    <span className="mb-1 block text-xs text-slate-600">
                      Recurrence
                    </span>
                    <select
                      className={field}
                      name="recurrence"
                      defaultValue={row.recurrence ?? ""}
                    >
                      <option value="">None</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                      <option value="quarterly">Quarterly</option>
                    </select>
                  </label>
                  <Button type="submit" variant="secondary">
                    Save
                  </Button>
                </form>
                <form action={createNextOccurrenceAction}>
                  <input type="hidden" name="engagementId" value={row.id} />
                  <Button
                    type="submit"
                    variant="secondary"
                    disabled={!row.recurrence}
                  >
                    Create next
                  </Button>
                </form>
              </li>
            ))}
          </ul>
          {!rows.length ? (
            <p className="px-4 py-10 text-center text-sm text-slate-500">
              No engagements to schedule.
            </p>
          ) : null}
        </section>
      </div>
    </>
  );
}

function parseMonth(value?: string) {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return null;
  const [year, month] = value.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, 1));
}

function startOfMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function endOfMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

function startOfWeek(date: Date) {
  const day = date.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  const next = new Date(date);
  next.setUTCDate(date.getUTCDate() + offset);
  return next;
}

function endOfWeek(date: Date) {
  const start = startOfWeek(date);
  const next = new Date(start);
  next.setUTCDate(start.getUTCDate() + 6);
  return next;
}

function eachDay(start: Date, end: Date) {
  const days: Date[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    days.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function chunk<T>(items: T[], size: number) {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    groups.push(items.slice(index, index + size));
  return groups;
}

function shiftMonth(date: Date, delta: number) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + delta, 1),
  );
}

function isoMonth(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatDay(date: Date) {
  return date.toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function coversDay(
  startDate: string | null,
  endDate: string | null,
  day: string,
) {
  if (!startDate && !endDate) return false;
  const start = startDate ?? endDate!;
  const end = endDate ?? startDate!;
  return start <= day && day <= end;
}

function overlapsWeek(
  startDate: string | null,
  endDate: string | null,
  weekStart: Date,
  weekEnd: Date,
) {
  if (!startDate && !endDate) return false;
  const start = startDate ?? endDate!;
  const end = endDate ?? startDate!;
  return start <= isoDate(weekEnd) && end >= isoDate(weekStart);
}
