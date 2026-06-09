"use client";
import { useMemo, useState, useTransition } from "react";
import clsx from "clsx";
import { Avatar, Button, Card, Field, Input, Select } from "@/components/ui";
import { Icon } from "@/components/icons";
import { formatINR, formatNumber, formatISODate } from "@/lib/format";

type Row = {
  brickSizeId: string;
  brickCount: number;
  ratePerBrick: number;
  cementBagsUsed: number;
  damagedCount: number;
};

type Sub = {
  date: string;
  shift: "day" | "night";
  machineId?: string;
  operatorIds: string[];
  rows: Row[];
};

export function DaySheet({
  sizes,
  operators,
  machines,
  cementBagsPer1000,
  dayShiftRate,
  nightShiftRate,
  onSubmit,
}: {
  sizes: Array<{ id: string; label: string; dayRate?: number; nightRate?: number }>;
  operators: Array<{ id: string; name: string }>;
  machines: Array<{ id: string; name: string }>;
  cementBagsPer1000: number;
  dayShiftRate: number;
  nightShiftRate: number;
  onSubmit: (d: Sub) => Promise<void>;
}) {
  const [date, setDate] = useState(formatISODate(new Date()));
  const [shift, setShift] = useState<"day" | "night">("day");
  const [machineId, setMachineId] = useState(machines[0]?.id ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set(operators.map((o) => o.id)));

  // Effective rate for a size+shift: size's own rate if set, else global.
  const rateFor = (sizeId: string, sh: "day" | "night") => {
    const s = sizes.find((x) => x.id === sizeId);
    const r = sh === "day" ? s?.dayRate : s?.nightRate;
    return r && r > 0 ? r : sh === "day" ? dayShiftRate : nightShiftRate;
  };

  const newRow = (): Row => ({
    brickSizeId: sizes[0]?.id ?? "",
    brickCount: 1000,
    ratePerBrick: rateFor(sizes[0]?.id ?? "", shift),
    cementBagsUsed: Math.round((1000 / 1000) * cementBagsPer1000 * 10) / 10,
    damagedCount: 0,
  });
  const [rows, setRows] = useState<Row[]>([newRow()]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((arr) => {
      const next = arr.slice();
      const merged = { ...next[i], ...patch };
      // auto-cement when count changes
      if (patch.brickCount != null) {
        merged.cementBagsUsed = Math.round((patch.brickCount / 1000) * cementBagsPer1000 * 10) / 10;
      }
      // auto-rate when the row's size changes
      if (patch.brickSizeId != null) {
        merged.ratePerBrick = rateFor(patch.brickSizeId, shift);
      }
      next[i] = merged;
      return next;
    });

  // When the shift changes, refresh every row's rate from its size.
  const changeShift = (sh: "day" | "night") => {
    setShift(sh);
    setRows((arr) => arr.map((r) => ({ ...r, ratePerBrick: rateFor(r.brickSizeId, sh) })));
  };

  const toggleOp = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const totals = useMemo(() => {
    const bricks = rows.reduce((s, r) => s + (r.brickCount || 0), 0);
    const wage = rows.reduce((s, r) => s + Math.round((r.brickCount || 0) * (r.ratePerBrick || 0)), 0);
    const cement = rows.reduce((s, r) => s + (r.cementBagsUsed || 0), 0);
    return { bricks, wage, cement };
  }, [rows]);

  const submit = () => {
    setError(null);
    if (selected.size === 0) return setError("Pick at least one operator");
    if (rows.length === 0) return setError("Add at least one row");
    for (const r of rows) {
      if (!r.brickSizeId) return setError("Pick a size for every row");
      if (r.brickCount <= 0) return setError("Every row needs a brick count > 0");
      if (r.ratePerBrick <= 0) return setError("Every row needs a rate > 0");
    }
    startTransition(async () => {
      try {
        await onSubmit({
          date,
          shift,
          machineId: machineId || undefined,
          operatorIds: Array.from(selected),
          rows,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Save failed";
        if (!msg.includes("NEXT_REDIRECT")) setError(msg);
      }
    });
  };

  const sizeLabel = (id: string) => sizes.find((s) => s.id === id)?.label ?? "?";

  return (
    <div className="space-y-3 pb-40">
      {/* Shared header */}
      <Card>
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Shift">
            <div className="grid grid-cols-2 gap-1 bg-slate-100 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => changeShift("day")}
                className={clsx(
                  "py-2 rounded-lg text-[12px] font-semibold",
                  shift === "day" ? "bg-white shadow-card text-amber-700" : "text-slate-500"
                )}
              >
                Day
              </button>
              <button
                type="button"
                onClick={() => changeShift("night")}
                className={clsx(
                  "py-2 rounded-lg text-[12px] font-semibold",
                  shift === "night" ? "bg-ink text-white" : "text-slate-500"
                )}
              >
                Night
              </button>
            </div>
          </Field>
          {machines.length > 0 && (
            <Field label="Machine">
              <Select value={machineId} onChange={(e) => setMachineId(e.target.value)}>
                <option value="">- none -</option>
                {machines.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
        <div className="mt-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
            Operators (wage split) · {selected.size} selected
          </div>
          <div className="flex flex-wrap gap-2">
            {operators.map((o) => {
              const active = selected.has(o.id);
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => toggleOp(o.id)}
                  className={clsx(
                    "inline-flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-full text-[12px] font-semibold transition",
                    active
                      ? "bg-ink text-white"
                      : "bg-white text-slate-700 border border-slate-200 hover:border-slate-400"
                  )}
                >
                  <Avatar name={o.name} size={22} />
                  <span>{o.name}</span>
                  {active && <Icon.Check size={12} color="#E11D2C" stroke={2.5} />}
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      {/* Rows */}
      <Card>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
          Production rows — one per brick size / batch
        </div>
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div
              key={i}
              className="grid grid-cols-2 lg:grid-cols-6 gap-2 items-end border-b border-slate-100 pb-2 last:border-b-0"
            >
              <Field label="Size">
                <Select value={r.brickSizeId} onChange={(e) => setRow(i, { brickSizeId: e.target.value })}>
                  {sizes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Bricks">
                <Input
                  type="number"
                  value={r.brickCount || ""}
                  onChange={(e) => setRow(i, { brickCount: Number(e.target.value || 0) })}
                />
              </Field>
              <Field label="₹/brick">
                <Input
                  type="number"
                  step="0.1"
                  value={r.ratePerBrick}
                  onChange={(e) => setRow(i, { ratePerBrick: Number(e.target.value || 0) })}
                />
              </Field>
              <Field label="Cement">
                <Input
                  type="number"
                  step="0.5"
                  value={r.cementBagsUsed}
                  onChange={(e) => setRow(i, { cementBagsUsed: Number(e.target.value || 0) })}
                />
              </Field>
              <Field label="Damaged">
                <Input
                  type="number"
                  value={r.damagedCount || ""}
                  onChange={(e) => setRow(i, { damagedCount: Number(e.target.value || 0) })}
                />
              </Field>
              <div className="flex items-center justify-between gap-2">
                <div className="num font-bold text-ink">
                  {formatINR(Math.round((r.brickCount || 0) * (r.ratePerBrick || 0)))}
                </div>
                {rows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setRows((arr) => arr.filter((_, idx) => idx !== i))}
                    className="w-8 h-8 rounded-md hover:bg-red-50 flex items-center justify-center text-red-600"
                  >
                    <Icon.Trash size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setRows((arr) => [...arr, newRow()])}
          className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 text-[12px] font-semibold"
        >
          <Icon.Plus size={14} /> Add row
        </button>

        {rows.length > 0 && (
          <div className="mt-3 text-[12px] text-slate-500">
            {rows.map((r) => `${formatNumber(r.brickCount || 0)} × ${sizeLabel(r.brickSizeId)}`).join("  ·  ")}
          </div>
        )}
      </Card>

      {/* Sticky totals + save — sits above the mobile bottom nav (z-30) */}
      <div className="fixed left-0 md:left-60 lg:left-64 right-0 bottom-[60px] md:bottom-0 z-40 bg-white border-t border-slate-200 px-4 md:px-8 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:pb-3">
        {error && <div className="text-xs text-red-600 mb-2">{error}</div>}
        <div className="max-w-screen-xl mx-auto flex items-center justify-between gap-3">
          <div className="text-[12px] text-slate-600 hidden sm:block">
            {rows.length} {rows.length === 1 ? "batch" : "batches"} · {formatNumber(totals.bricks)} bricks ·{" "}
            {totals.cement.toFixed(1)} cement · {formatINR(totals.wage)} wage
          </div>
          <Button onClick={submit} disabled={isPending} variant="primary" size="lg" className="ml-auto">
            {isPending ? "Saving…" : `Save ${rows.length} ${rows.length === 1 ? "entry" : "entries"}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
