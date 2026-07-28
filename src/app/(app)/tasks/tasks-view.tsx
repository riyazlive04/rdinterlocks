"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Input, Select, Pill, EmptyState } from "@/components/ui";
import { Icon } from "@/components/icons";
import { formatShortDate, formatISODate } from "@/lib/format";

export type TaskDTO = {
  id: string;
  title: string;
  details: string | null;
  status: string;
  dueDate: string | null; // ISO date or null
  assignedToName: string;
  createdByName: string | null;
};
type UserOption = { id: string; name: string; role: string };

export function TasksView({
  admin,
  users,
  myTasks,
  allTasks,
  onCreate,
  onToggle,
  onDelete,
}: {
  admin: boolean;
  users: UserOption[];
  myTasks: TaskDTO[];
  allTasks: TaskDTO[];
  onCreate: (d: {
    title: string;
    details?: string;
    assignedToId: string;
    dueDate?: string;
  }) => Promise<void>;
  onToggle: (id: string, done: boolean) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [assignedToId, setAssignedToId] = useState(users[0]?.id ?? "");
  const [dueDate, setDueDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const create = () => {
    setError(null);
    if (!title.trim()) return setError("Give the task a title");
    if (!assignedToId) return setError("Pick who to assign it to");
    startTransition(async () => {
      try {
        await onCreate({
          title: title.trim(),
          details: details.trim() || undefined,
          assignedToId,
          dueDate: dueDate || undefined,
        });
        setTitle("");
        setDetails("");
        setDueDate("");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not add task");
      }
    });
  };

  const toggle = (t: TaskDTO) =>
    startTransition(async () => {
      await onToggle(t.id, t.status !== "done");
      router.refresh();
    });

  const remove = (t: TaskDTO) => {
    if (!confirm(`Delete task "${t.title}"?`)) return;
    startTransition(async () => {
      await onDelete(t.id);
      router.refresh();
    });
  };

  const today = formatISODate(new Date());
  const taskRow = (t: TaskDTO, opts: { showAssignee?: boolean; canDelete?: boolean }) => {
    const done = t.status === "done";
    const overdue = !done && t.dueDate && t.dueDate < today;
    return (
      <div key={t.id} className="flex items-start gap-3 py-2.5">
        <button
          onClick={() => toggle(t)}
          disabled={isPending}
          className={`mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${
            done
              ? "bg-emerald-600 border-emerald-600 text-white"
              : "bg-white border-slate-300 hover:border-slate-500"
          }`}
          aria-label={done ? "Mark as open" : "Mark as done"}
        >
          {done && <Icon.Check size={13} stroke={3} />}
        </button>
        <div className="flex-1 min-w-0">
          <div className={`text-[13px] font-semibold ${done ? "line-through text-slate-400" : "text-ink"}`}>
            {t.title}
          </div>
          {t.details && (
            <div className={`text-[12px] mt-0.5 ${done ? "text-slate-400" : "text-slate-600"}`}>
              {t.details}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1.5 mt-1">
            {opts.showAssignee && <Pill tone="slate">{t.assignedToName}</Pill>}
            {t.dueDate && (
              <span className={`text-[11px] font-semibold ${overdue ? "text-brand-red" : "text-slate-500"}`}>
                {overdue ? "Overdue · " : "Due "}
                {formatShortDate(new Date(t.dueDate))}
              </span>
            )}
            {done && <Pill tone="success">done</Pill>}
          </div>
        </div>
        {opts.canDelete && (
          <button
            onClick={() => remove(t)}
            disabled={isPending}
            className="w-8 h-8 rounded-md hover:bg-red-50 flex items-center justify-center text-red-600 shrink-0"
            aria-label="Delete task"
          >
            <Icon.Trash size={14} />
          </button>
        )}
      </div>
    );
  };

  const openAll = allTasks.filter((t) => t.status !== "done");
  const doneAll = allTasks.filter((t) => t.status === "done");

  return (
    <div className="space-y-4">
      {admin && (
        <Card>
          <h3 className="text-[14px] font-bold mb-3">Assign a task</h3>
          {users.length === 0 ? (
            <div className="text-[13px] text-slate-500">
              No managers or telecallers yet.{" "}
              <a href="/settings/users" className="text-brand-blue underline">
                Add a user
              </a>{" "}
              to assign tasks.
            </div>
          ) : (
            <>
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Task">
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Call back pending leads"
                  />
                </Field>
                <Field label="Assign to">
                  <Select value={assignedToId} onChange={(e) => setAssignedToId(e.target.value)}>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} · {u.role}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Due date (optional)">
                  <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </Field>
                <Field label="Details (optional)">
                  <Input
                    value={details}
                    onChange={(e) => setDetails(e.target.value)}
                    placeholder="Any extra instructions"
                  />
                </Field>
              </div>
              {error && <div className="text-xs text-red-600 mt-2">{error}</div>}
              <div className="mt-3">
                <Button onClick={create} disabled={isPending} variant="primary">
                  <Icon.Plus size={15} stroke={2.4} /> {isPending ? "Adding…" : "Assign task"}
                </Button>
              </div>
            </>
          )}
        </Card>
      )}

      {/* Everyone sees the tasks assigned to them. */}
      {(!admin || myTasks.length > 0) && (
        <Card>
          <h3 className="text-[14px] font-bold mb-1">My tasks</h3>
          {myTasks.length === 0 ? (
            <div className="text-[13px] text-slate-500 py-2">Nothing assigned to you right now. 🎉</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {myTasks.map((t) => taskRow(t, { canDelete: admin }))}
            </div>
          )}
        </Card>
      )}

      {admin && (
        <Card>
          <h3 className="text-[14px] font-bold mb-1">
            All assigned tasks{" "}
            <span className="text-slate-400 font-normal">({openAll.length} open)</span>
          </h3>
          {allTasks.length === 0 ? (
            <EmptyState title="No tasks yet" sub="Assign the first task above." />
          ) : (
            <>
              <div className="divide-y divide-slate-100">
                {openAll.map((t) => taskRow(t, { showAssignee: true, canDelete: true }))}
              </div>
              {doneAll.length > 0 && (
                <div className="mt-3 pt-2 border-t border-slate-100">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                    Completed
                  </div>
                  <div className="divide-y divide-slate-100">
                    {doneAll.map((t) => taskRow(t, { showAssignee: true, canDelete: true }))}
                  </div>
                </div>
              )}
            </>
          )}
        </Card>
      )}
    </div>
  );
}
