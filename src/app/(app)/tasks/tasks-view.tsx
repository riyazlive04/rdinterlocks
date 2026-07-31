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
  statusReason: string | null;
  dueDate: string | null; // ISO date or null
  assignedToName: string;
  createdByName: string | null;
};
type UserOption = { id: string; name: string; role: string };

const STATUSES: Array<{ key: string; label: string; short: string; tone: "warning" | "success" | "danger" }> = [
  { key: "wip", label: "Work in progress", short: "In progress", tone: "warning" },
  { key: "done", label: "Completed", short: "Completed", tone: "success" },
  { key: "not_done", label: "Not completed", short: "Not completed", tone: "danger" },
];

export function TasksView({
  admin,
  users,
  myTasks,
  allTasks,
  onCreate,
  onSetStatus,
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
  onSetStatus: (id: string, status: string, reason?: string) => Promise<void>;
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

  // "Not completed" must carry a reason, so ask for it before saving.
  const setStatus = (t: TaskDTO, status: string) => {
    if (status === t.status) return;
    let reason: string | undefined;
    if (status === "not_done") {
      const answer = prompt(`Why wasn't "${t.title}" completed?`, t.statusReason ?? "");
      if (answer === null) return;
      if (!answer.trim()) return alert("A reason is needed to mark it not completed.");
      reason = answer.trim();
    }
    startTransition(async () => {
      try {
        await onSetStatus(t.id, status, reason);
        router.refresh();
      } catch (e) {
        alert(e instanceof Error ? e.message : "Could not update the task");
      }
    });
  };

  const remove = (t: TaskDTO) => {
    if (!confirm(`Delete task "${t.title}"?`)) return;
    startTransition(async () => {
      await onDelete(t.id);
      router.refresh();
    });
  };

  const today = formatISODate(new Date());
  const taskRow = (t: TaskDTO, opts: { showAssignee?: boolean; canDelete?: boolean }) => {
    const closed = t.status !== "wip";
    const overdue = !closed && t.dueDate && t.dueDate < today;
    return (
      <div key={t.id} className="py-2.5">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div
              className={`text-[13px] font-semibold ${
                t.status === "done" ? "line-through text-slate-400" : "text-ink"
              }`}
            >
              {t.title}
            </div>
            {t.details && (
              <div className={`text-[12px] mt-0.5 ${closed ? "text-slate-400" : "text-slate-600"}`}>
                {t.details}
              </div>
            )}
            {t.status === "not_done" && t.statusReason && (
              <div className="text-[12px] mt-0.5 text-red-700">Reason: {t.statusReason}</div>
            )}
            <div className="flex flex-wrap items-center gap-1.5 mt-1">
              {opts.showAssignee && <Pill tone="slate">{t.assignedToName}</Pill>}
              {t.dueDate && (
                <span
                  className={`text-[11px] font-semibold ${
                    overdue ? "text-brand-red" : "text-slate-500"
                  }`}
                >
                  {overdue ? "Overdue · " : "Due "}
                  {formatShortDate(new Date(t.dueDate))}
                </span>
              )}
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
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {STATUSES.map((s) => {
            const active = t.status === s.key;
            return (
              <button
                key={s.key}
                onClick={() => setStatus(t, s.key)}
                disabled={isPending}
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition ${
                  active
                    ? s.tone === "success"
                      ? "bg-emerald-600 text-white"
                      : s.tone === "danger"
                        ? "bg-red-600 text-white"
                        : "bg-amber-500 text-white"
                    : "bg-white text-slate-600 border border-slate-200 hover:border-slate-400"
                }`}
              >
                {active && <Icon.Check size={11} stroke={3} />} {s.short}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const openAll = allTasks.filter((t) => t.status === "wip");
  const doneAll = allTasks.filter((t) => t.status !== "wip");

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
            <span className="text-slate-400 font-normal">({openAll.length} in progress)</span>
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
                    Closed - completed &amp; not completed
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
