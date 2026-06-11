"use client";
import { useMemo, useState, useTransition } from "react";
import clsx from "clsx";
import { Avatar, Button, Card, Field, Input, Select } from "@/components/ui";
import { Icon } from "@/components/icons";
import { formatINR, formatNumber, formatISODate } from "@/lib/format";
import { distributeInt } from "@/lib/distribute";

type WorkerType = "loader" | "operator" | "employee";
type WorkerOption = { type: WorkerType; id: string; name: string };
type Mode = "loading" | "unloading" | "both";

type Crew = { workers: Array<{ type: WorkerType; id: string }>; ratePerBrick: number };
type Sub = {
  date: string;
  brickSizeId?: string;
  brickCount: number;
  loading?: Crew;
  unloading?: Crew;
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
  const [brickSizeId, setBrickSizeId] = useState(sizes[0]?.id ?? "");
  const [brickCount, setBrickCount] = useState<number>(1000);

  const [mode, setMode] = useState<Mode>("loading");
  const [loadSel, setLoadSel] = useState<Set<string>>(new Set());
  const [loadRate, setLoadRate] = useState<number>(0.5);
  const [unloadSel, setUnloadSel] = useState<Set<string>>(new Set());
  const [unloadRate, setUnloadRate] = useState<number>(0.5);

  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const showLoad = mode !== "unloading";
  const showUnload = mode !== "loading";

  const changeMode = (m: Mode) => {
    setMode(m);
    // When "both", pre-fill the unloading crew from the loading crew (editable).
    if (m === "both" && unloadSel.size === 0 && loadSel.size > 0) {
      setUnloadSel(new Set(loadSel));
    }
  };

  const toggle = (setter: React.Dispatch<React.SetStateAction<Set<string>>>) => (k: string) =>
    setter((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const workersFor = (sel: Set<string>) => all.filter((w) => sel.has(keyOf(w)));

  const groupSelector = (sel: Set<string>, onToggle: (k: string) => void) => {
    const group = (label: string, items: WorkerOption[]) =>
      items.length === 0 ? null : (
        <div className="mb-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
            {label}
          </div>
          <div className="flex flex-wrap gap-2">
            {items.map((w) => {
              const k = keyOf(w);
              const active = sel.has(k);
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => onToggle(k)}
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
    return (
      <>
        {group("Loaders", workers.loaders)}
        {group("Operators", workers.operators)}
        {group("Drivers & staff", workers.employees)}
      </>
    );
  };

  const splitTable = (sel: Set<string>, rate: number) => {
    const sw = workersFor(sel);
    if (sw.length === 0) return null;
    const split = distributeInt(brickCount || 0, sw.length);
    const total = Math.round((brickCount || 0) * (rate || 0));
    return (
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
            {sw.map((w, i) => (
              <tr key={keyOf(w)} className="border-t border-slate-200">
                <td className="px-3 py-2 font-semibold text-ink">{w.name}</td>
                <td className="px-3 py-2 text-right num">{formatNumber(split[i] ?? 0)}</td>
                <td className="px-3 py-2 text-right num font-semibold">
                  {formatINR(Math.round((split[i] ?? 0) * rate))}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-slate-300 bg-white">
              <td className="px-3 py-2 font-bold">Total</td>
              <td className="px-3 py-2 text-right num font-bold">{formatNumber(brickCount || 0)}</td>
              <td className="px-3 py-2 text-right num font-bold">{formatINR(total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  };

  const grandTotal = useMemo(() => {
    const load = showLoad ? Math.round((brickCount || 0) * (loadRate || 0)) : 0;
    const unload = showUnload ? Math.round((brickCount || 0) * (unloadRate || 0)) : 0;
    return load + unload;
  }, [brickCount, loadRate, unloadRate, showLoad, showUnload]);

  const submit = () => {
    setError(null);
    if (brickCount <= 0) return setError("Brick count must be more than 0");
    if (showLoad && loadSel.size === 0) return setError("Pick at least one person who loaded");
    if (showLoad && loadRate <= 0) return setError("Loading rate must be more than 0");
    if (showUnload && unloadSel.size === 0) return setError("Pick at least one person who unloaded");
    if (showUnload && unloadRate <= 0) return setError("Unloading rate must be more than 0");
    startTransition(async () => {
      try {
        await onSubmit({
          date,
          brickSizeId: brickSizeId || undefined,
          brickCount,
          loading: showLoad
            ? { workers: workersFor(loadSel).map((w) => ({ type: w.type, id: w.id })), ratePerBrick: loadRate }
            : undefined,
          unloading: showUnload
            ? { workers: workersFor(unloadSel).map((w) => ({ type: w.type, id: w.id })), ratePerBrick: unloadRate }
            : undefined,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Save failed";
        if (!msg.includes("NEXT_REDIRECT")) setError(msg);
      }
    });
  };

  const modeBtn = (m: Mode, label: string) => (
    <button
      type="button"
      onClick={() => changeMode(m)}
      className={clsx(
        "flex-1 px-3 py-2 rounded-lg text-[12px] font-semibold transition",
        mode === m ? "bg-ink text-white" : "bg-white text-slate-700 border border-slate-200"
      )}
    >
      {label}
    </button>
  );

  return (
    <Card>
      <div className="flex gap-1.5 mb-4">
        {modeBtn("loading", "Loading")}
        {modeBtn("unloading", "Unloading")}
        {modeBtn("both", "Both")}
      </div>
      {mode === "unloading" && (
        <div className="text-[11px] text-slate-500 -mt-2 mb-3">
          Use this to add unloading for a load you already saved - it doesn&apos;t add to the brick
          count, only the unloading salary.
        </div>
      )}

      <div className="grid sm:grid-cols-3 gap-3">
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
        <Field label="Total bricks">
          <Input
            type="number"
            value={brickCount || ""}
            onChange={(e) => setBrickCount(Number(e.target.value || 0))}
          />
        </Field>
      </div>

      {showLoad && (
        <div className="mt-4 pt-3 border-t border-slate-100">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[12px] font-bold uppercase tracking-wider text-ink">
              Loading · {loadSel.size} selected
            </div>
            <div className="w-32">
              <Field label="Rate ₹/brick">
                <Input
                  type="number"
                  step="0.1"
                  value={loadRate}
                  onChange={(e) => setLoadRate(Number(e.target.value || 0))}
                />
              </Field>
            </div>
          </div>
          {groupSelector(loadSel, toggle(setLoadSel))}
          {splitTable(loadSel, loadRate)}
        </div>
      )}

      {showUnload && (
        <div className="mt-4 pt-3 border-t border-slate-100">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[12px] font-bold uppercase tracking-wider text-ink">
              Unloading · {unloadSel.size} selected
            </div>
            <div className="w-32">
              <Field label="Rate ₹/brick">
                <Input
                  type="number"
                  step="0.1"
                  value={unloadRate}
                  onChange={(e) => setUnloadRate(Number(e.target.value || 0))}
                />
              </Field>
            </div>
          </div>
          {mode === "both" && (
            <div className="text-[11px] text-slate-500 mb-2">
              Pre-filled from the loading crew - deselect or add the people who unloaded.
            </div>
          )}
          {groupSelector(unloadSel, toggle(setUnloadSel))}
          {splitTable(unloadSel, unloadRate)}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between">
        <div className="text-[12px] text-slate-500">
          Total salary <span className="num font-bold text-ink">{formatINR(grandTotal)}</span>
          {mode === "both" && <span className="text-slate-400"> (loading + unloading)</span>}
        </div>
      </div>

      {error && <div className="text-xs text-red-600 mt-2">{error}</div>}
      <div className="mt-3">
        <Button onClick={submit} disabled={isPending} variant="primary" size="lg">
          {isPending ? "Saving…" : "Save loading entry"}
        </Button>
      </div>
    </Card>
  );
}
