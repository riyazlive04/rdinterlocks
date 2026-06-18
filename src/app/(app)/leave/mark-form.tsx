"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Avatar, Button, Card, Field, Input } from "@/components/ui";
import { Icon } from "@/components/icons";
import { formatISODate } from "@/lib/format";

type WorkerType = "operator" | "loader" | "mason" | "employee";
type WorkerOption = { type: WorkerType; id: string; name: string };

export function MarkLeaveForm({
  workers,
  onSubmit,
}: {
  workers: {
    operators: WorkerOption[];
    loaders: WorkerOption[];
    masons: WorkerOption[];
    employees: WorkerOption[];
  };
  onSubmit: (d: {
    date: string;
    reason?: string;
    persons: Array<{ type: WorkerType; id: string }>;
  }) => Promise<void>;
}) {
  const router = useRouter();
  const all = [...workers.operators, ...workers.loaders, ...workers.masons, ...workers.employees];
  const keyOf = (w: WorkerOption) => `${w.type}:${w.id}`;

  const [date, setDate] = useState(formatISODate(new Date()));
  const [reason, setReason] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const toggle = (k: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const group = (label: string, items: WorkerOption[]) =>
    items.length === 0 ? null : (
      <div className="mb-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">{label}</div>
        <div className="flex flex-wrap gap-2">
          {items.map((w) => {
            const k = keyOf(w);
            const active = selected.has(k);
            return (
              <button
                key={k}
                type="button"
                onClick={() => toggle(k)}
                className={clsx(
                  "inline-flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-full text-[12px] font-semibold transition",
                  active
                    ? "bg-brand-red text-white"
                    : "bg-white text-slate-700 border border-slate-200 hover:border-slate-400"
                )}
              >
                <Avatar name={w.name} size={22} />
                <span>{w.name}</span>
                {active && <Icon.Check size={12} color="#FFFFFF" stroke={2.5} />}
              </button>
            );
          })}
        </div>
      </div>
    );

  const submit = () => {
    setError(null);
    if (selected.size === 0) return setError("Pick who is on leave");
    const persons = all.filter((w) => selected.has(keyOf(w))).map((w) => ({ type: w.type, id: w.id }));
    startTransition(async () => {
      try {
        await onSubmit({ date, reason: reason.trim() || undefined, persons });
        setSelected(new Set());
        setReason("");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
      }
    });
  };

  return (
    <Card className="mb-5">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Reason (optional)">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Sick, personal…" />
        </Field>
      </div>

      <div className="mt-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
          On leave · {selected.size} selected
        </div>
        {group("Operators", workers.operators)}
        {group("Loaders", workers.loaders)}
        {group("Masons", workers.masons)}
        {group("Drivers & staff", workers.employees)}
      </div>

      {error && <div className="text-xs text-red-600 mt-2">{error}</div>}
      <div className="mt-4">
        <Button onClick={submit} disabled={isPending} variant="primary">
          {isPending ? "Saving…" : "Mark leave"}
        </Button>
      </div>
    </Card>
  );
}
