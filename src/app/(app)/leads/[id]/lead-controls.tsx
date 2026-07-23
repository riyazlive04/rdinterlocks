"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pill } from "@/components/ui";
import { STAGE_ORDER, stageLabel, stageTone } from "@/lib/leads";
import { deleteLead, discardLead, reopenLead, setFollowUp, setLeadStage } from "../actions";

// Inline controls on the lead detail page. Moving a lead along the pipeline or
// pushing a follow-up is a one-click job — it shouldn't need the edit form.

export function StagePicker({ id, stage, locked }: { id: string; stage: string; locked: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [current, setCurrent] = useState(stage);

  // An unrecognised stage (the import endpoint lets new ones through) is shown
  // as an extra chip so it stays visible instead of silently reading as "New".
  const stages: string[] = STAGE_ORDER.includes(current as (typeof STAGE_ORDER)[number])
    ? [...STAGE_ORDER]
    : [current, ...STAGE_ORDER];

  if (locked) {
    return <Pill tone={stageTone(current)}>{stageLabel(current)}</Pill>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {stages.map((s) => (
        <button
          key={s}
          type="button"
          disabled={isPending}
          onClick={() => {
            setCurrent(s);
            startTransition(async () => {
              await setLeadStage(id, s);
              router.refresh();
            });
          }}
          className={`px-2.5 py-1.5 rounded-lg text-[12px] font-semibold transition disabled:opacity-50 ${
            current === s
              ? "bg-ink text-white"
              : "bg-white text-slate-600 border border-slate-200 hover:border-slate-400"
          }`}
        >
          {stageLabel(s)}
        </button>
      ))}
    </div>
  );
}

export function FollowUpControl({
  id,
  date,
  locked,
}: {
  id: string;
  date: string | null;
  locked: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [value, setValue] = useState(date ?? "");

  if (locked) return <span className="text-[13px] text-ink">{date || "—"}</span>;

  const save = (next: string) => {
    setValue(next);
    startTransition(async () => {
      await setFollowUp(id, next || null);
      router.refresh();
    });
  };

  return (
    <div className="flex items-center gap-2">
      <input
        type="date"
        value={value}
        disabled={isPending}
        onChange={(e) => save(e.target.value)}
        className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-brand-red/30"
      />
      {value && (
        <button
          type="button"
          disabled={isPending}
          onClick={() => save("")}
          className="text-[12px] font-semibold text-slate-500 hover:text-slate-700"
        >
          Clear
        </button>
      )}
    </div>
  );
}

export function LeadStatusActions({
  id,
  status,
  converted,
}: {
  id: string;
  status: string;
  converted: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const run = (fn: () => Promise<void>) => startTransition(async () => {
    await fn();
    router.refresh();
  });

  return (
    <div className="flex flex-wrap items-center gap-3">
      {!converted && status === "open" && (
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            if (!confirm("Discard this lead? It stays on record and can be reopened.")) return;
            run(() => discardLead(id));
          }}
          className="text-[12px] font-semibold text-slate-600 hover:text-slate-900 disabled:opacity-50"
        >
          Discard lead
        </button>
      )}
      {!converted && status === "discarded" && (
        <button
          type="button"
          disabled={isPending}
          onClick={() => run(() => reopenLead(id))}
          className="text-[12px] font-semibold text-brand-blue hover:text-brand-blueDark disabled:opacity-50"
        >
          Reopen lead
        </button>
      )}
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (
            !confirm(
              "Delete this lead permanently?\n\nThe import audit trail is kept, but the lead itself cannot be recovered.\n\nPrefer 'Discard' unless this is junk."
            )
          )
            return;
          startTransition(async () => {
            await deleteLead(id);
          });
        }}
        className="text-[12px] font-semibold text-red-600 hover:text-red-700 disabled:opacity-50"
      >
        Delete
      </button>
    </div>
  );
}
