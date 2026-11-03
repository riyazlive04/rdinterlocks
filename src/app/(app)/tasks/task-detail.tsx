"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Pill } from "@/components/ui";
import { Icon } from "@/components/icons";
import { formatShortDate } from "@/lib/format";
import {
  CATEGORY_LABEL,
  RECURRENCE_LABEL,
  TASK_CATEGORIES,
  TASK_RECURRENCES,
  normalizeCategory,
  normalizeRecurrence,
} from "./task-meta";
import { MAX_ATTACHMENTS_PER_TASK, formatBytes } from "@/lib/task-attachments";

export type ChecklistDTO = {
  id: string;
  text: string;
  done: boolean;
  doneByName: string | null;
};

export type CommentDTO = {
  id: string;
  body: string;
  authorName: string;
  createdAt: string;
  canRemove: boolean;
};

export type AttachmentDTO = {
  id: string;
  name: string;
  mimeType: string;
  byteSize: number;
  uploaderName: string;
  canRemove: boolean;
};

export type TaskDetailDTO = {
  checklist: ChecklistDTO[];
  comments: CommentDTO[];
  attachments: AttachmentDTO[];
  category: string | null;
  recurrence: string | null;
  /** May this user tick steps, comment and attach? */
  canContribute: boolean;
  /** May this user add/remove steps and set recurrence? (delegator/senior) */
  canInstruct: boolean;
};

/**
 * Everything hanging off one task: its steps, its thread and its files.
 *
 * Collapsed by default and loaded with the page rather than on demand —
 * these lists are small, and a second round trip per task to show a count
 * would be slower than fetching them.
 */
export function TaskDetail({
  taskId,
  detail,
  onAddStep,
  onToggleStep,
  onDeleteStep,
  onAddComment,
  onDeleteComment,
  onUpload,
  onDeleteAttachment,
  onSetCategory,
  onSetRecurrence,
}: {
  taskId: string;
  detail: TaskDetailDTO;
  onAddStep: (taskId: string, text: string) => Promise<void>;
  onToggleStep: (itemId: string, done: boolean) => Promise<void>;
  onDeleteStep: (itemId: string) => Promise<void>;
  onAddComment: (taskId: string, body: string) => Promise<void>;
  onDeleteComment: (commentId: string) => Promise<void>;
  onUpload: (formData: FormData) => Promise<void>;
  onDeleteAttachment: (attachmentId: string) => Promise<void>;
  onSetCategory: (taskId: string, category: string | null) => Promise<void>;
  onSetRecurrence: (taskId: string, recurrence: string | null) => Promise<void>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState("");
  const [comment, setComment] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const run = (fn: () => Promise<void>, after?: () => void) => {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
        after?.();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "That did not work");
      }
    });
  };

  const stepsDone = detail.checklist.filter((c) => c.done).length;
  const steps = detail.checklist.length;
  const category = normalizeCategory(detail.category);
  const recurrence = normalizeRecurrence(detail.recurrence);

  // The summary line, so a collapsed task still says what it is carrying.
  const counts = [
    steps > 0 ? `${stepsDone}/${steps} steps` : null,
    detail.comments.length > 0 ? `${detail.comments.length} notes` : null,
    detail.attachments.length > 0 ? `${detail.attachments.length} files` : null,
  ].filter(Boolean);

  return (
    <div className="mt-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {category && <Pill tone="blue">{CATEGORY_LABEL[category]}</Pill>}
        {recurrence && <Pill tone="dark">{RECURRENCE_LABEL[recurrence]}</Pill>}
        {steps > 0 && (
          <Pill tone={stepsDone === steps ? "success" : "slate"}>
            {stepsDone}/{steps} steps
          </Pill>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="text-[11px] font-semibold text-brand-blue hover:underline"
        >
          {open ? "Hide details" : counts.length ? `Details · ${counts.join(" · ")}` : "Add details"}
        </button>
      </div>

      {open && (
        <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3 space-y-3">
          {error && (
            <div role="alert" className="text-[12px] text-red-700">
              {error}
            </div>
          )}

          {/* ─── Filing ─────────────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Kind of work
              <select
                value={category ?? ""}
                disabled={isPending || !detail.canContribute}
                onChange={(e) => run(() => onSetCategory(taskId, e.target.value || null))}
                className="ml-1.5 h-7 rounded-md border border-slate-200 bg-white text-[11px] font-semibold text-slate-700 px-1"
              >
                <option value="">Uncategorised</option>
                {TASK_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </option>
                ))}
              </select>
            </label>

            {detail.canInstruct && (
              <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Repeats
                <select
                  value={recurrence ?? ""}
                  disabled={isPending}
                  onChange={(e) => run(() => onSetRecurrence(taskId, e.target.value || null))}
                  className="ml-1.5 h-7 rounded-md border border-slate-200 bg-white text-[11px] font-semibold text-slate-700 px-1"
                >
                  <option value="">Does not repeat</option>
                  {TASK_RECURRENCES.map((r) => (
                    <option key={r} value={r}>
                      {RECURRENCE_LABEL[r]}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {detail.canInstruct && recurrence && (
            <div className="text-[11px] text-slate-500">
              The next one is created when this is marked done — so nothing piles up
              while it is still open.
            </div>
          )}

          {/* ─── Steps ──────────────────────────────────────────── */}
          <section aria-label="Steps">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
              Steps
            </div>
            {detail.checklist.length === 0 ? (
              <div className="text-[12px] text-slate-500">No steps yet.</div>
            ) : (
              <ul className="space-y-1">
                {detail.checklist.map((c) => (
                  <li key={c.id} className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={c.done}
                      disabled={isPending || !detail.canContribute}
                      onChange={() => run(() => onToggleStep(c.id, !c.done))}
                      aria-label={c.text}
                      className="mt-0.5 w-4 h-4 accent-brand-red"
                    />
                    <span
                      className={`flex-1 text-[12.5px] ${
                        c.done ? "line-through text-slate-400" : "text-ink"
                      }`}
                    >
                      {c.text}
                      {c.done && c.doneByName && (
                        <span className="text-[11px] text-slate-400"> — {c.doneByName}</span>
                      )}
                    </span>
                    {detail.canInstruct && (
                      <button
                        type="button"
                        onClick={() => run(() => onDeleteStep(c.id))}
                        disabled={isPending}
                        aria-label={`Remove step "${c.text}"`}
                        className="text-slate-400 hover:text-red-600"
                      >
                        <Icon.X size={13} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {detail.canInstruct && (
              <form
                className="flex gap-1.5 mt-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!step.trim()) return;
                  run(() => onAddStep(taskId, step), () => setStep(""));
                }}
              >
                <input
                  value={step}
                  onChange={(e) => setStep(e.target.value)}
                  placeholder="Add a step…"
                  aria-label="New step"
                  className="flex-1 h-8 rounded-md border border-slate-200 px-2 text-[12.5px]"
                />
                <Button type="submit" disabled={isPending || !step.trim()}>
                  Add
                </Button>
              </form>
            )}
          </section>

          {/* ─── Notes ──────────────────────────────────────────── */}
          <section aria-label="Notes">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
              Notes
            </div>
            {detail.comments.length === 0 ? (
              <div className="text-[12px] text-slate-500">No notes yet.</div>
            ) : (
              <ul className="space-y-1.5">
                {detail.comments.map((c) => (
                  <li key={c.id} className="bg-white rounded-lg border border-slate-200 px-2.5 py-1.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[11px] font-semibold text-ink">{c.authorName}</span>
                      <span className="text-[10px] text-slate-400">
                        {formatShortDate(new Date(c.createdAt))}
                      </span>
                      {c.canRemove && (
                        <button
                          type="button"
                          onClick={() => run(() => onDeleteComment(c.id))}
                          disabled={isPending}
                          aria-label="Delete note"
                          className="text-slate-400 hover:text-red-600"
                        >
                          <Icon.X size={12} />
                        </button>
                      )}
                    </div>
                    {/* Plain text node — never dangerouslySetInnerHTML, so a
                        note containing markup stays a note. */}
                    <div className="text-[12.5px] text-slate-700 whitespace-pre-wrap">{c.body}</div>
                  </li>
                ))}
              </ul>
            )}
            {detail.canContribute && (
              <form
                className="flex gap-1.5 mt-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!comment.trim()) return;
                  run(() => onAddComment(taskId, comment), () => setComment(""));
                }}
              >
                <input
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Add a note…"
                  aria-label="New note"
                  className="flex-1 h-8 rounded-md border border-slate-200 px-2 text-[12.5px]"
                />
                <Button type="submit" disabled={isPending || !comment.trim()}>
                  Post
                </Button>
              </form>
            )}
          </section>

          {/* ─── Files ──────────────────────────────────────────── */}
          <section aria-label="Files">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
              Files
            </div>
            {detail.attachments.length === 0 ? (
              <div className="text-[12px] text-slate-500">Nothing attached.</div>
            ) : (
              <ul className="space-y-1">
                {detail.attachments.map((a) => (
                  <li key={a.id} className="flex items-center gap-2">
                    <Icon.FileText size={14} color="#475569" />
                    <a
                      href={`/api/tasks/attachments/${a.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 text-[12.5px] text-brand-blue hover:underline truncate"
                    >
                      {a.name}
                    </a>
                    <span className="text-[11px] text-slate-400">{formatBytes(a.byteSize)}</span>
                    <span className="text-[11px] text-slate-400 hidden sm:inline">
                      {a.uploaderName}
                    </span>
                    {a.canRemove && (
                      <button
                        type="button"
                        onClick={() => run(() => onDeleteAttachment(a.id))}
                        disabled={isPending}
                        aria-label={`Delete ${a.name}`}
                        className="text-slate-400 hover:text-red-600"
                      >
                        <Icon.Trash size={13} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {detail.canContribute && detail.attachments.length < MAX_ATTACHMENTS_PER_TASK && (
              <div className="mt-1.5">
                <input
                  ref={fileInput}
                  type="file"
                  aria-label="Attach a file"
                  accept="image/jpeg,image/png,image/webp,image/heic,application/pdf,text/plain,text/csv,.xlsx,.xls"
                  disabled={isPending}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const fd = new FormData();
                    fd.set("taskId", taskId);
                    fd.set("file", file);
                    run(
                      () => onUpload(fd),
                      () => {
                        if (fileInput.current) fileInput.current.value = "";
                      }
                    );
                  }}
                  className="text-[12px]"
                />
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Photos, PDFs, text or spreadsheets. Up to 5 MB each,{" "}
                  {MAX_ATTACHMENTS_PER_TASK} per task.
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
