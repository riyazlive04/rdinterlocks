"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { logLeadActivity } from "./actions";
import { ACTIVITY_KINDS, ACTIVITY_OUTCOMES, kindLabel, outcomeLabel } from "./activity-meta";

// "Log a call" — the one thing a telecaller does dozens of times a day, so it
// sits on the lead itself and clears itself on success rather than navigating
// away. A next-action date entered here is mirrored onto Lead.followUpDate by
// the action, which is what keeps the "Follow-ups due" view honest.

export function ActivityForm({ id, locked }: { id: string; locked: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [kind, setKind] = useState<string>("call");
  const [outcome, setOutcome] = useState("");
  const [note, setNote] = useState("");
  const [nextActionAt, setNextActionAt] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (locked) {
    return (
      <div className="text-[12px] text-slate-500">
        This lead is converted — the log is read-only.
      </div>
    );
  }

  const submit = () => {
    setError(null);
    startTransition(async () => {
      try {
        await logLeadActivity(id, {
          kind,
          outcome,
          note,
          nextActionAt: nextActionAt || null,
        });
        setOutcome("");
        setNote("");
        setNextActionAt("");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not log this activity");
      }
    });
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="grid sm:grid-cols-3 gap-3">
        <Field label="What happened">
          <Select value={kind} onChange={(e) => setKind(e.target.value)} disabled={isPending}>
            {ACTIVITY_KINDS.map((k) => (
              <option key={k} value={k}>
                {kindLabel(k)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Outcome" hint="Qualified also moves the lead to the Qualified stage">
          <Select value={outcome} onChange={(e) => setOutcome(e.target.value)} disabled={isPending}>
            <option value="">No outcome</option>
            {ACTIVITY_OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {outcomeLabel(o)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Next action" hint="Also sets the follow-up date">
          <Input
            type="date"
            value={nextActionAt}
            disabled={isPending}
            onChange={(e) => setNextActionAt(e.target.value)}
          />
        </Field>
      </div>
      <div className="mt-3">
        <Field label="Note">
          <Textarea
            rows={2}
            value={note}
            disabled={isPending}
            placeholder="What the customer said, in their words where it matters…"
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      </div>
      {error && <div className="text-[11px] text-red-600 mt-2">{error}</div>}
      <div className="mt-3 flex items-center gap-3">
        <Button type="button" size="sm" disabled={isPending} onClick={submit}>
          {isPending ? "Saving…" : "Log activity"}
        </Button>
        <span className="text-[11px] text-slate-500">
          Entries cannot be edited or deleted once saved.
        </span>
      </div>
    </div>
  );
}
