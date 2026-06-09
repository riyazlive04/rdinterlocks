"use client";
import { useMemo, useState, useTransition } from "react";
import clsx from "clsx";
import { Avatar, Button, Card, Field, Input, Select } from "@/components/ui";
import { Icon } from "@/components/icons";
import { formatINR, formatNumber, formatISODate } from "@/lib/format";
import { distributeInt } from "@/lib/distribute";

type WorkerType = "loader" | "operator" | "employee";
type WorkerOption = { type: WorkerType; id: string; name: string };

type Sub = {
  date: string;
  workers: Array<{ type: WorkerType; id: string }>;
  brickSizeId?: string;
  brickCount: number;
  ratePerBrick: number;
};

export function LoadingMultiForm({
  workers,
  sizes,
  onSubmit,
}: {
  workers: { loaders: WorkerOption[]; operators: WorkerOption[]; employees: WorkerOption[] };
  sizes: Array<{ id: string; label: string }>;
  onSubmit: (d: Sub) => Promise<void>;
}) {
  const all = [...workers.loaders, ...workers.operators, ...workers.employees];
  const keyOf = (w: WorkerOption) => `${w.type}:${w.id}`;

  const [date, setDate] = useState(formatISODate(new Date()));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [brickSizeId, setBrickSizeId] = useState(sizes[0]?.id ?? "");
  const [brickCount, setBrickCount] = useState<number>(1000);
  const [ratePerBrick, setRatePerBrick] = useState<number>(0.5);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const toggle = (k: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const selectedWorkers = all.filter((w) => selected.has(keyOf(w)));
  const split = useMemo(() => {
    const n = selectedWorkers.length;
    if (n === 0) return [];
    return distributeInt(brickCount || 0, n);
  }, [brickCount, selectedWorkers.length]);

  const totalWage = Math.round((brickCount || 0) * (ratePerBrick || 0));

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
                    ? "bg-ink text-white"
                    : "bg-white text-slate-700 border border-slate-200 hover:border-slate-400"
                )}
              >
                <Avatar name={w.name} size={22} />
                <span>{w.name}</span>
                {active && <Icon.Check size={12} color="#E11D2C" stroke={2.5} />}
              </button>
            );
          })}
        </div>
      </div>
    );

  const submit = () => {
    setError(null);
    if (selected.size === 0) return setError("Pick at least one person who loaded");
    if (brickCount <= 0) return setError("Brick count must be more than 0");
    if (ratePerBrick <= 0) return setError("Rate must be more than 0");
    startTransition(async () => {
      try {
        await onSubmit({
          date,
          workers: selectedWorkers.map((w) => ({ type: w.type, id: w.id })),
          brickSizeId: brickSizeId || undefined,
          brickCount,
          ratePerBrick,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Save failed";
        if (!msg.includes("NEXT_REDIRECT")) setError(msg);
      }
    });
  };

  return (
    <Card>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Brick size (optional)">
          <Select value={brickSizeId} onChange={(e) => setBrickSizeId(e.target.value)}>
            <option value="">- mixed -</option>
            {sizes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Total bricks loaded">
          <Input
            type="number"
            value={brickCount || ""}
            onChange={(e) => setBrickCount(Number(e.target.value || 0))}
          />
        </Field>
        <Field label="Rate (₹/brick)">
          <Input
            type="number"
            step="0.1"
            value={ratePerBrick}
            onChange={(e) => setRatePerBrick(Number(e.target.value || 0))}
          />
        </Field>
      </div>

      <div className="mt-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
          Who loaded · {selected.size} selected · bricks split equally
        </div>
        {group("Loaders", workers.loaders)}
        {group("Operators", workers.operators)}
        {group("Drivers & staff", workers.employees)}
      </div>

      {selectedWorkers.length > 0 && (
        <div className="mt-3 bg-slate-50 rounded-xl overflow-hidden">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-slate-500 text-[10px] uppercase tracking-wider">
                <th className="text-left px-3 py-2">Worker</th>
                <th className="text-right px-3 py-2">Bricks</th>
                <th className="text-right px-3 py-2">Salary</th>
              </tr>
            </thead>
            <tbody>
              {selectedWorkers.map((w, i) => (
                <tr key={keyOf(w)} className="border-t border-slate-200">
                  <td className="px-3 py-2 font-semibold text-ink">{w.name}</td>
                  <td className="px-3 py-2 text-right num">{formatNumber(split[i] ?? 0)}</td>
                  <td className="px-3 py-2 text-right num font-semibold">
                    {formatINR(Math.round((split[i] ?? 0) * ratePerBrick))}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-300 bg-white">
                <td className="px-3 py-2 font-bold">Total</td>
                <td className="px-3 py-2 text-right num font-bold">{formatNumber(brickCount || 0)}</td>
                <td className="px-3 py-2 text-right num font-bold">{formatINR(totalWage)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {error && <div className="text-xs text-red-600 mt-2">{error}</div>}
      <div className="mt-4">
        <Button onClick={submit} disabled={isPending} variant="primary" size="lg">
          {isPending ? "Saving…" : "Save loading entry"}
        </Button>
      </div>
    </Card>
  );
}
