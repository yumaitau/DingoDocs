"use client";

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { StatusPill } from "@/components/ui/status-pill";
import { updateTaskStatusAction } from "@/server/actions/planning";
import { cn } from "@/lib/utils";

const columns = [
  "backlog",
  "todo",
  "in_progress",
  "blocked",
  "done",
] as const;

type BoardStatus = (typeof columns)[number];

export type BoardTask = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueLabel: string;
};

function isBoardStatus(value: string): value is BoardStatus {
  return (columns as readonly string[]).includes(value);
}

export function TaskBoard({ tasks }: { tasks: BoardTask[] }) {
  const router = useRouter();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const grouped = useMemo(() => {
    const map = Object.fromEntries(
      columns.map((status) => [status, [] as BoardTask[]]),
    ) as Record<BoardStatus, BoardTask[]>;
    for (const task of tasks) {
      if (isBoardStatus(task.status)) map[task.status].push(task);
    }
    return map;
  }, [tasks]);
  const activeTask = tasks.find((task) => task.id === activeId) ?? null;

  function onDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function onDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const taskId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    if (!overId) return;
    const nextStatus = overId.startsWith("column:")
      ? overId.slice("column:".length)
      : tasks.find((task) => task.id === overId)?.status;
    if (!nextStatus || !isBoardStatus(nextStatus)) return;
    const current = tasks.find((task) => task.id === taskId);
    if (!current || current.status === nextStatus) return;
    const formData = new FormData();
    formData.set("taskId", taskId);
    formData.set("status", nextStatus);
    startTransition(async () => {
      await updateTaskStatusAction(formData);
      router.refresh();
    });
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div
        className={cn(
          "grid gap-4 overflow-x-auto pb-2 md:grid-cols-2 xl:grid-cols-5",
          pending && "opacity-70",
        )}
      >
        {columns.map((status) => (
          <BoardColumn
            key={status}
            status={status}
            tasks={grouped[status]}
          />
        ))}
      </div>
      <DragOverlay>
        {activeTask ? <TaskCard task={activeTask} dragging /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function BoardColumn({
  status,
  tasks,
}: {
  status: BoardStatus;
  tasks: BoardTask[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `column:${status}` });
  return (
    <section
      ref={setNodeRef}
      className={cn(
        "min-h-64 rounded-xl border bg-paper p-3",
        isOver && "border-[var(--harbour-500)] bg-[var(--harbour-50)]",
      )}
    >
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{titleCase(status)}</h2>
        <span className="text-xs tabular-nums text-slate-500">
          {tasks.length}
        </span>
      </header>
      <SortableContext
        items={tasks.map((task) => task.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul className="space-y-2">
          {tasks.map((task) => (
            <li key={task.id}>
              <SortableTask task={task} />
            </li>
          ))}
        </ul>
      </SortableContext>
    </section>
  );
}

function SortableTask({ task }: { task: BoardTask }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id });
  const style = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    transition,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(isDragging && "opacity-40")}
      {...listeners}
      {...attributes}
    >
      <TaskCard task={task} />
    </div>
  );
}

function TaskCard({
  task,
  dragging = false,
}: {
  task: BoardTask;
  dragging?: boolean;
}) {
  return (
    <article
      className={cn(
        "rounded-lg border bg-[var(--mist)] p-3 text-left shadow-sm",
        dragging && "shadow-lg",
      )}
    >
      <p className="text-sm font-medium">{task.title}</p>
      <p className="mt-1 line-clamp-2 text-xs text-slate-500">
        {task.description ?? "No description"}
      </p>
      <div className="mt-3 flex items-center justify-between gap-2">
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
        <span className="text-[11px] text-slate-500">{task.dueLabel}</span>
      </div>
    </article>
  );
}

export function TaskStatusSelect({
  taskId,
  status,
  statuses,
}: {
  taskId: string;
  status: string;
  statuses: readonly string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <label className="block min-w-0">
      <span className="sr-only">Status</span>
      <select
        className="h-9 w-full rounded-md border bg-paper px-2.5 text-sm outline-none focus:border-[var(--harbour-500)]"
        defaultValue={status}
        disabled={pending}
        onChange={(event) => {
          const formData = new FormData();
          formData.set("taskId", taskId);
          formData.set("status", event.target.value);
          startTransition(async () => {
            await updateTaskStatusAction(formData);
            router.refresh();
          });
        }}
      >
        {statuses.map((value) => (
          <option key={value} value={value}>
            {value.replaceAll("_", " ")}
          </option>
        ))}
      </select>
    </label>
  );
}

function titleCase(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
