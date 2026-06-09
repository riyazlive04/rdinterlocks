"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import clsx from "clsx";
import { Avatar, Button, Card, Field, Input, Select } from "@/components/ui";
import { Icon } from "@/components/icons";
import { formatINR, formatNumber, formatISODate } from "@/lib/format";
import { distributeInt } from "@/lib/distribute";

type Recipe = { name: string; unit: string; qtyPer1000: number };
type Sub = {
  date: string;
  shift: "day" | "night";
  machineId?: string;
  brickSizeId: string;
  brickCount: number;
  damagedCount: number;
  cementBagsUsed: number;
  ratePerBrick: number;
  operatorIds: string[];
  notes?: string;
};

export function ProductionForm({
  sizes,
  operators,
  machines,
  cementBagsPer1000,
  dayShiftRate,
  nightShiftRate,
  recipes,
  initial,
  submitLabel,
  onSubmit,
}: {
  sizes: Array<{ id: string; label: string; dayRate?: number; nightRate?: number }>;
  operators: Array<{ id: string; name: string }>;
  machines: Array<{ id: string; name: string }>;
  cementBagsPer1000: number;
  dayShiftRate: number;
  nightShiftRate: number;
  recipes: Record<string, Recipe[]>;
  initial?: Partial<Sub>;
  submitLabel?: string;
  onSubmit: (d: Sub) => Promise<void>;
}) {
  const isEdit = !!initial;
  // Effective operator rate for a size+shift: the size's own rate if set,
  // otherwise the global day/night fallback.
  const rateFor = (sizeId: string, sh: "day" | "night") => {
    const s = sizes.find((x) => x.id === sizeId);
    const r = sh === "day" ? s?.dayRate : s?.nightRate;
    return r && r > 0 ? r : sh === "day" ? dayShiftRate : nightShiftRate;
  };
  const [date, setDate] = useState(initial?.date ?? formatISODate(new Date()));
  const [shift, setShift] = useState<"day" | "night">(initial?.shift ?? "day");
  const [machineId, setMachineId] = useState(initial?.machineId ?? machines[0]?.id ?? "");
  const [brickSizeId, setBrickSizeId] = useState(initial?.brickSizeId ?? sizes[0]?.id ?? "");
  const [brickCount, setBrickCount] = useState<number>(initial?.brickCount ?? 1000);
  const [damagedCount, setDamagedCount] = useState<number>(initial?.damagedCount ?? 0);
  const [cementBags, setCementBags] = useState<number>(initial?.cementBagsUsed ?? 0);
  // When editing, start with manual cement so we don't overwrite the saved value.
  const [cementAuto, setCementAuto] = useState(!isEdit);
  const [ratePerBrick, setRatePerBrick] = useState<number>(initial?.ratePerBrick ?? dayShiftRate);
  const [selected, setSelected] = useState<Set<string>>(
    new Set(initial?.operatorIds ?? operators.map((o) => o.id))
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Auto rate from the selected size + shift - only on a fresh entry;
  // preserve the saved rate when editing.
  useEffect(() => {
    if (isEdit) return;
    setRatePerBrick(rateFor(brickSizeId, shift));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shift, brickSizeId, dayShiftRate, nightShiftRate, isEdit]);

  // Auto-cement
  useEffect(() => {
    if (cementAuto) setCementBags(Math.round((brickCount / 1000) * cementBagsPer1000 * 10) / 10);
  }, [brickCount, cementBagsPer1000, cementAuto]);

  const totals = useMemo(() => {
    const total = Math.round(brickCount * ratePerBrick);
    const n = selected.size;
    const brickShares = n > 0 ? distributeInt(brickCount, n) : [];
    const wageShares = n > 0 ? distributeInt(total, n) : [];
    return { total, brickShares, wageShares };
  }, [brickCount, ratePerBrick, selected]);

  const operatorList = useMemo(
    () => operators.filter((o) => selected.has(o.id)),
    [operators, selected]
  );

  const recipeForSize = recipes[brickSizeId] ?? [];

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const submit = () => {
    setError(null);
    if (selected.size === 0) return setError("Pick at least one operator");
    if (brickCount <= 0) return setError("Brick count must be > 0");
    if (ratePerBrick <= 0) return setError("Rate must be > 0");
    startTransition(async () => {
      try {
        await onSubmit({
          date,
          shift,
          machineId: machineId || undefined,
          brickSizeId,
          brickCount,
          damagedCount,
          cementBagsUsed: cementBags,
          ratePerBrick,
          operatorIds: Array.from(selected),
          notes: notes || undefined,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Save failed";
        if (!msg.includes("NEXT_REDIRECT")) setError(msg);
      }
    });
  };

  return (
    <div className="space-y-3 pb-32">
      <Card>
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Shift">
            <div className="grid grid-cols-2 gap-1 bg-slate-100 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => setShift("day")}
                className={clsx(
                  "py-2 rounded-lg text-[12px] font-semibold",
                  shift === "day"
                    ? "bg-white shadow-card text-amber-700"
                    : "text-slate-500"
                )}
              >
                Day
              </button>
              <button
                type="button"
                onClick={() => setShift("night")}
                className={clsx(
                  "py-2 rounded-lg text-[12px] font-semibold",
                  shift === "night"
                    ? "bg-ink text-white"
                    : "text-slate-500"
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
      </Card>

      <Card>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Brick size">
            <Select value={brickSizeId} onChange={(e) => setBrickSizeId(e.target.value)}>
              {sizes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Operator rate (₹ per brick)">
            <div className="flex gap-1.5">
              <Input
                type="number"
                step="0.1"
                value={ratePerBrick}
                onChange={(e) => setRatePerBrick(Number(e.target.value || 0))}
              />
              <button
                type="button"
                onClick={() => setRatePerBrick(dayShiftRate)}
                className="px-2.5 rounded-xl bg-amber-100 text-amber-800 text-[11px] font-semibold whitespace-nowrap hover:bg-amber-200"
              >
                Day ₹{dayShiftRate}
              </button>
              <button
                type="button"
                onClick={() => setRatePerBrick(nightShiftRate)}
                className="px-2.5 rounded-xl bg-slate-200 text-slate-800 text-[11px] font-semibold whitespace-nowrap hover:bg-slate-300"
              >
                Night ₹{nightShiftRate}
              </button>
            </div>
          </Field>
          <Field label="Quantity produced">
            <div className="space-y-1.5">
              <Input
                type="number"
                value={brickCount || ""}
                onChange={(e) => setBrickCount(Number(e.target.value || 0))}
              />
              <div className="flex flex-wrap gap-1.5">
                {[500, 800, 1000, 2000].map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setBrickCount(q)}
                    className="px-3 py-1 rounded-full bg-slate-100 hover:bg-slate-200 text-[11px] font-semibold"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          </Field>
          <Field
            label="Damaged bricks (tracked separately)"
            hint="Recorded for waste tracking - does not reduce production count or salary."
          >
            <Input
              type="number"
              value={damagedCount || ""}
              onChange={(e) => setDamagedCount(Number(e.target.value || 0))}
            />
          </Field>
          <Field
            label="Cement bags used"
            hint={cementAuto ? `Auto from recipe (${cementBagsPer1000} bags / 1000)` : "Manual"}
          >
            <div className="flex gap-2">
              <Input
                type="number"
                step="0.5"
                value={cementBags}
                onChange={(e) => {
                  setCementAuto(false);
                  setCementBags(Number(e.target.value || 0));
                }}
              />
              <button
                type="button"
                onClick={() => setCementAuto(true)}
                className="px-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-[11px] font-semibold text-slate-700"
              >
                Auto
              </button>
            </div>
          </Field>
          <Field label="Notes">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </Field>
        </div>

        {recipeForSize.length > 0 && (
          <div className="mt-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
              Material consumption (auto-decrements stock on save)
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
              {recipeForSize.map((r) => {
                const used = ((brickCount / 1000) * r.qtyPer1000).toFixed(1);
                return (
                  <div key={r.name}>
                    <span className="font-semibold">{r.name}</span>{" "}
                    <span className="num text-slate-700">{used}</span>{" "}
                    <span className="text-slate-500">{r.unit}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>

      <Card>
        <div className="flex items-baseline justify-between mb-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Operators · {selected.size} selected
          </div>
          <button
            type="button"
            onClick={() =>
              setSelected((s) =>
                s.size === operators.length ? new Set() : new Set(operators.map((o) => o.id))
              )
            }
            className="text-[11px] font-semibold text-brand-blue"
          >
            {selected.size === operators.length ? "Clear all" : "Select all"}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {operators.map((o) => {
            const active = selected.has(o.id);
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => toggle(o.id)}
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
      </Card>

      <Card>
        <div className="grid grid-cols-3 gap-3 mb-3">
          <Stat label="Production" value={formatNumber(brickCount)} />
          <Stat label="Damaged" value={formatNumber(damagedCount)} color="text-brand-red" />
          <Stat label="Total salary" value={formatINR(totals.total)} />
        </div>
        {operatorList.length > 0 && (
          <>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
              Split per operator
            </div>
            <div className="bg-slate-50 rounded-xl overflow-hidden">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-slate-500 text-[10px] uppercase tracking-wider">
                    <th className="text-left px-3 py-2">Operator</th>
                    <th className="text-right px-3 py-2">Bricks</th>
                    <th className="text-right px-3 py-2">Salary</th>
                  </tr>
                </thead>
                <tbody>
                  {operatorList.map((o, i) => (
                    <tr key={o.id} className="border-t border-slate-200">
                      <td className="px-3 py-2 font-semibold text-ink">{o.name}</td>
                      <td className="px-3 py-2 text-right num">
                        {formatNumber(totals.brickShares[i] ?? 0)}
                      </td>
                      <td className="px-3 py-2 text-right num font-semibold">
                        {formatINR(totals.wageShares[i] ?? 0)}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-slate-300 bg-white">
                    <td className="px-3 py-2 font-bold text-ink">Total</td>
                    <td className="px-3 py-2 text-right num font-bold">
                      {formatNumber(totals.brickShares.reduce((s, n) => s + n, 0))}
                    </td>
                    <td className="px-3 py-2 text-right num font-bold">
                      {formatINR(totals.wageShares.reduce((s, n) => s + n, 0))}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="text-[10px] text-slate-500 mt-2">
              Splits round to whole rupees / whole bricks; the first operator absorbs the
              remainder so totals match exactly.
            </div>
          </>
        )}
      </Card>

      {/* Sticky bottom CTA — sits above the mobile bottom nav (which is z-30) */}
      <div className="fixed left-0 md:left-60 lg:left-64 right-0 bottom-[60px] md:bottom-0 z-40 bg-white border-t border-slate-200 px-4 md:px-8 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:pb-3">
        {error && <div className="text-xs text-red-600 mb-2">{error}</div>}
        <div className="max-w-screen-xl mx-auto flex items-center justify-between gap-3">
          <div className="text-[12px] text-slate-500 hidden sm:block">
            {brickCount > 0 ? (
              <>
                {formatNumber(brickCount)} bricks · {formatINR(totals.total)} salary
              </>
            ) : (
              "Enter a count"
            )}
          </div>
          <Button onClick={submit} disabled={isPending} variant="primary" size="lg" className="ml-auto">
            {isPending ? "Saving…" : submitLabel ?? "Save production entry"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div className={`num display text-lg font-bold mt-0.5 ${color ?? "text-ink"}`}>{value}</div>
    </div>
  );
}
