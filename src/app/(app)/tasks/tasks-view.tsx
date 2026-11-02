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
  statusReason: string | null; // why it is parked, if anyone said
  dueDate: string | null; // ISO date or null
  assignedToName: string;
  assigneeRoleLabel: string;
  createdByName: string | null;
  // Decided on the server from the assignee's stored role (see page.tsx).
  // These only hide controls; every action re-checks the hierarchy itself.
  isMine: boolean;
  canManage: boolean;
  canReassign: boolean;
  canRemove: boolean;
};
type UserOption = { id: string; name: string; roleLabel: string };

export function TasksView({
  canDelegate,
  users,
  myTasks,
  byMeTasks,
  teamTasks,
  onCreate,
  onToggle,
  onReassign,
  onSetReason,
  onDelete,
}: {
  canDelegate: boolean;
  users: UserOption[];
  myTasks: TaskDTO[];
  byMeTasks: TaskDTO[];
  teamTasks: TaskDTO[];
  onCreate: (d: {
    title: string;
    details?: string;
    assignedToId: string;
    dueDate?: string;
  }) => Promise<void>;
  onToggle: (id: string, done: boolean) => Promise<void>;
  onReassign: (id: string, newAssigneeId: string) => Promise<void>;
  onSetReason: (id: string, reason: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [assignedToId, setAssignedToId] = useState(users[0]?.id ?? "");
  const [dueDate, setDueDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Per-row editors. Only one task is being reassigned or parked at a time,
  // so the open row's id plus its draft text is all the state needed.
  const [reassigning, setReassigning] = useState<string | null>(null);
  const [parking, setParking] = useState<string | null>(null);
  const [reasonDraft, setReasonDraft] = useState("");
  const [rowError, setRowError] = useState<string | null>(null);

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

  // The row actions share one error line, because only one row is ever open.
  const runOnRow = (fn: () => Promise<void>, fallback: string, after?: () => void) => {
    setRowError(null);
    startTransition(async () => {
      try {
        await fn();
        after?.();
        router.refresh();
      } catch (e) {
        setRowError(e instanceof Error ? e.message : fallback);
      }
    });
  };

  const toggle = (t: TaskDTO) =>
    runOnRow(() => onToggle(t.id, t.status !== "done"), "Could not update the task");

  const reassign = (t: TaskDTO, userId: string) =>
    runOnRow(() => onReassign(t.id, userId), "Could not reassign the task", () =>
      setReassigning(null)
    );

  const saveReason = (t: TaskDTO) =>
    runOnRow(() => onSetReason(t.id, reasonDraft), "Could not save the reason", () => {
      setParking(null);
      setReasonDraft("");
    });

  const remove = (t: TaskDTO) => {
    if (!confirm(`Delete task "${t.title}"?`)) return;
    runOnRow(() => onDelete(t.id), "Could not delete the task");
  };

  const openPark = (t: TaskDTO) => {
    setRowError(null);
    setReassigning(null);
    setParking(t.id);
    setReasonDraft(t.statusReason ?? "");
  };

  const openReassign = (t: TaskDTO) => {
    setRowError(null);
    setParking(null);
    setReassigning(t.id);
  };

  const today = formatISODate(new Date());

  const taskRow = (t: TaskDTO, opts: { showAssignee?: boolean }) => {
    const done = t.status === "done";
    const overdue = !done && t.dueDate && t.dueDate < today;
    return (
      <div key={t.id} className="py-2.5">
        <div className="flex items-start gap-3">
          <button
            onClick={() => toggle(t)}
            disabled={isPending || !t.canManage}
            className={`mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${
              done
                ? "bg-emerald-600 border-emerald-600 text-white"
                : t.canManage
                  ? "bg-white border-slate-300 hover:border-slate-500"
                  : "bg-slate-50 border-slate-200 cursor-not-allowed"
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
              {opts.showAssignee && (
                <>
                  <Pill tone="slate">{t.assignedToName}</Pill>
                  {/* The rank, so a delegator can see at a glance which rung
                      of the chain a task is sitting on. */}
                  <Pill tone="dark">{t.assigneeRoleLabel}</Pill>
                </>
              )}
              {t.dueDate && (
                <span className={`text-[11px] font-semibold ${overdue ? "text-brand-red" : "text-slate-500"}`}>
                  {overdue ? "Overdue · " : "Due "}
                  {formatShortDate(new Date(t.dueDate))}
                </span>
              )}
              {done && <Pill tone="success">done</Pill>}
              {!done && t.statusReason && <Pill tone="warning">parked</Pill>}
              {t.createdByName && !t.isMine && (
                <span className="text-[11px] text-slate-400">by {t.createdByName}</span>
              )}
            </div>
            {!done && t.statusReason && (
              <div className="text-[12px] text-amber-800 mt-1">On hold: {t.statusReason}</div>
            )}
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            {t.canManage && !done && (
              <button
                onClick={() => (parking === t.id ? setParking(null) : openPark(t))}
                disabled={isPending}
                className="w-8 h-8 rounded-md hover:bg-amber-50 flex items-center justify-center text-amber-700"
                aria-label="Park with a reason"
                title="Say why this is on hold"
              >
                <Icon.Flag size={14} />
              </button>
            )}
            {t.canReassign && users.length > 0 && (
              <button
                onClick={() => (reassigning === t.id ? setReassigning(null) : openReassign(t))}
                disabled={isPending}
                className="w-8 h-8 rounded-md hover:bg-slate-100 flex items-center justify-center text-slate-600"
                aria-label="Reassign"
                title="Hand this to someone else"
              >
                <Icon.Users size={15} />
              </button>
            )}
            {t.canRemove && (
              <button
                onClick={() => remove(t)}
                disabled={isPending}
                className="w-8 h-8 rounded-md hover:bg-red-50 flex items-center justify-center text-red-600"
                aria-label="Delete task"
              >
                <Icon.Trash size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Reason for parking. Blank clears it, which is how a task comes off
            hold without being completed. */}
        {parking === t.id && (
          <div className="mt-2 ml-8 flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[180px]">
              <Field label="Why is this on hold?">
                <Input
                  value={reasonDraft}
                  onChange={(e) => setReasonDraft(e.target.value)}
                  placeholder="e.g. waiting for cement delivery"
                  autoFocus
                />
              </Field>
            </div>
            <Button onClick={() => saveReason(t)} disabled={isPending} variant="primary" size="sm">
              {isPending ? "Saving…" : "Save"}
            </Button>
            <Button onClick={() => setParking(null)} variant="ghost" size="sm">
              Cancel
            </Button>
          </div>
        )}

        {/* Reassign. The options are already limited to the roles this user
            may delegate to; the server checks the chosen one again anyway. */}
        {reassigning === t.id && (
          <div className="mt-2 ml-8 flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[180px]">
              <Field label="Reassign to">
                <Select defaultValue="" onChange={(e) => e.target.value && reassign(t, e.target.value)}>
                  <option value="">Pick someone…</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} · {u.roleLabel}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Button onClick={() => setReassigning(null)} variant="ghost" size="sm">
              Cancel
            </Button>
          </div>
        )}

        {rowError && (parking === t.id || reassigning === t.id) && (
          <div className="text-xs text-red-600 mt-1 ml-8">{rowError}</div>
        )}
      </div>
    );
  };

  // A section of tasks: open ones up top, completed folded underneath.
  const section = (
    heading: string,
    note: string,
    rows: TaskDTO[],
    empty: React.ReactNode,
    opts: { showAssignee?: boolean }
  ) => {
    const open = rows.filter((t) => t.status !== "done");
    const closed = rows.filter((t) => t.status === "done");
    return (
      <Card>
        <h3 className="text-[14px] font-bold mb-1">
          {heading} <span className="text-slate-400 font-normal">({open.length} open)</span>
        </h3>
        <div className="text-[11px] text-slate-400 mb-1">{note}</div>
        {rows.length === 0 ? (
          empty
        ) : (
          <>
            <div className="divide-y divide-slate-100">
              {open.map((t) => taskRow(t, opts))}
            </div>
            {closed.length > 0 && (
              <div className="mt-3 pt-2 border-t border-slate-100">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                  Completed
                </div>
                <div className="divide-y divide-slate-100">
                  {closed.map((t) => taskRow(t, opts))}
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    );
  };

  return (
    <div className="space-y-4">
      {/* Only the roles that sit above someone get a create form at all. */}
      {canDelegate && (
        <Card>
          <h3 className="text-[14px] font-bold mb-3">Assign a task</h3>
          {users.length === 0 ? (
            <div className="text-[13px] text-slate-500">
              Nobody reports to you yet.{" "}
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
                <Field label="Assign to" hint="Only people below you in the chain are listed.">
                  <Select value={assignedToId} onChange={(e) => setAssignedToId(e.target.value)}>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} · {u.roleLabel}
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

      {/* Everyone gets this one — it is the whole screen for a telecaller. */}
      {section(
        "Assigned to me",
        "Work you are expected to finish",
        myTasks,
        <div className="text-[13px] text-slate-500 py-2">Nothing assigned to you right now. 🎉</div>,
        {}
      )}

      {/* Shown to everyone who has ever handed work out, delegator or not —
          a task you created and then had your role changed still belongs on
          your screen. */}
      {byMeTasks.length > 0 &&
        section(
          "Assigned by me",
          "Work you handed to someone else",
          byMeTasks,
          <EmptyState title="Nothing assigned yet" sub="Assign the first task above." />,
          { showAssignee: true }
        )}

      {canDelegate &&
        section(
          "My team's tasks",
          "Everything sitting with the people below you, whoever assigned it",
          teamTasks,
          <EmptyState title="No tasks for your team yet" sub="Assign the first task above." />,
          { showAssignee: true }
        )}

      {rowError && !parking && !reassigning && (
        <div className="text-xs text-red-600">{rowError}</div>
      )}
    </div>
  );
}
