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
type LoadType = "brick" | "lintel";
type Dir = "in" | "out";

type Crew = { workers: Array<{ type: WorkerType; id: string }>; ratePerBrick: number };
type ClientOption = { id: string; name: string; location?: string };
type TipperOption = { id: string; name: string; ownership: string };
type VendorOption = { id: string; name: string };
type ChargeLine = {
  name: string;
  direction: Dir;
  quantity: number;
  unit: string;
  amount: number;
  vendorId?: string;
};
type Sub = {
  date: string;
  loadType: LoadType;
  brickSizeId?: string;
  clientId?: string;
  vehicleRequested?: string;
  brickCount: number;
  loading?: Crew;
  unloading?: Crew;
  tipperId?: string;
  tipperCharge: number;
  charges: ChargeLine[];
};

const CHARGE_PRESETS: Array<{ name: string; unit: string }> = [
  { name: "Shifting charge", unit: "trip" },
  { name: "Lintel slab", unit: "pcs" },
  { name: "Cement", unit: "bag" },
];

export function LoadingMultiForm({
  workers,
  sizes,
  clients,
  tippers,
  vendors,
  onSubmit,
}: {
  workers: { loaders: WorkerOption[]; operators: WorkerOption[]; employees: WorkerOption[] };
  sizes: Array<{ id: string; label: string }>;
  clients: ClientOption[];
  tippers: TipperOption[];
  vendors: VendorOption[];
  onSubmit: (d: Sub) => Promise<void>;
}) {
  const all = [...workers.loaders, ...workers.operators, ...workers.employees];
  const keyOf = (w: WorkerOption) => `${w.type}:${w.id}`;

  const [date, setDate] = useState(formatISODate(new Date()));
  const [loadType, setLoadType] = useState<LoadType>("brick");
  const [brickSizeId, setBrickSizeId] = useState(sizes[0]?.id ?? "");
  const [clientId, setClientId] = useState<string>("");
  const [vehicleRequested, setVehicleRequested] = useState<string>("");
  const [brickCount, setBrickCount] = useState<number>(1000);

  const [tipperId, setTipperId] = useState<string>("");
  const [tipperCharge, setTipperCharge] = useState<number>(0);
  const [charges, setCharges] = useState<ChargeLine[]>([]);

  const [mode, setMode] = useState<Mode>("loading");
  const [loadSel, setLoadSel] = useState<Set<string>>(new Set());
  const [loadRate, setLoadRate] = useState<number>(0.5);
  const [unloadSel, setUnloadSel] = useState<Set<string>>(new Set());
  const [unloadRate, setUnloadRate] = useState<number>(0.5);

  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isLintel = loadType === "lintel";
  const unit = isLintel ? "slabs" : "bricks";
  const unitOne = isLintel ? "slab" : "brick";

  const showLoad = mode !== "unloading";
  const showUnload = mode !== "loading";

  const tipper = tippers.find((t) => t.id === tipperId);
  const tipperIsOwn = tipper?.ownership === "own";

  const changeMode = (m: Mode) => {
    setMode(m);
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

  // ── Charge line helpers ──
  const addCharge = (preset?: { name: string; unit: string }) =>
    setCharges((c) => [
      ...c,
      {
        name: preset?.name ?? "",
        direction: "in",
        quantity: 1,
        unit: preset?.unit ?? "unit",
        amount: 0,
        vendorId: undefined,
      },
    ]);
  const updateCharge = (i: number, patch: Partial<ChargeLine>) =>
    setCharges((c) => c.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  const removeCharge = (i: number) => setCharges((c) => c.filter((_, idx) => idx !== i));

  const chargeIncome = charges
    .filter((c) => c.direction === "in")
    .reduce((s, c) => s + (c.amount || 0), 0);
  const chargeExpense = charges
    .filter((c) => c.direction === "out")
    .reduce((s, c) => s + (c.amount || 0), 0);

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
              <th className="text-right px-3 py-2 capitalize">{unit}</th>
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
    if (brickCount <= 0) return setError(`${isLintel ? "Slab" : "Brick"} count must be more than 0`);
    if (showLoad && loadSel.size === 0) return setError("Pick at least one person who loaded");
    if (showLoad && loadRate <= 0) return setError("Loading rate must be more than 0");
    if (showUnload && unloadSel.size === 0) return setError("Pick at least one person who unloaded");
    if (showUnload && unloadRate <= 0) return setError("Unloading rate must be more than 0");
    if (tipperId && tipperCharge < 0) return setError("Tipper charge can't be negative");
    for (const c of charges) {
      if (!c.name.trim()) return setError("Every charge needs a name (or remove the empty line)");
    }
    startTransition(async () => {
      try {
        await onSubmit({
          date,
          loadType,
          brickSizeId: isLintel ? undefined : brickSizeId || undefined,
          clientId: clientId || undefined,
          vehicleRequested: vehicleRequested.trim() || undefined,
          brickCount,
          loading: showLoad
            ? { workers: workersFor(loadSel).map((w) => ({ type: w.type, id: w.id })), ratePerBrick: loadRate }
            : undefined,
          unloading: showUnload
            ? { workers: workersFor(unloadSel).map((w) => ({ type: w.type, id: w.id })), ratePerBrick: unloadRate }
            : undefined,
          tipperId: tipperId || undefined,
          tipperCharge: tipperId ? tipperCharge : 0,
          charges: charges
            .filter((c) => c.name.trim() && c.amount > 0)
            .map((c) => ({
              name: c.name.trim(),
              direction: c.direction,
              quantity: c.quantity || 1,
              unit: c.unit || "unit",
              amount: c.amount,
              vendorId: c.direction === "out" ? c.vendorId || undefined : undefined,
            })),
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

      <Field label="What was handled">
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => setLoadType("brick")}
            className={clsx(
              "flex-1 px-3 py-2 rounded-lg text-[12px] font-semibold transition",
              !isLintel ? "bg-ink text-white" : "bg-white text-slate-700 border border-slate-200"
            )}
          >
            Bricks
          </button>
          <button
            type="button"
            onClick={() => setLoadType("lintel")}
            className={clsx(
              "flex-1 px-3 py-2 rounded-lg text-[12px] font-semibold transition",
              isLintel ? "bg-ink text-white" : "bg-white text-slate-700 border border-slate-200"
            )}
          >
            Lintel slabs
          </button>
        </div>
      </Field>

      <div className="grid sm:grid-cols-3 gap-3 mt-3">
        <Field label="Date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        {!isLintel && (
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
        )}
        <Field label={`Total ${unit}`}>
          <Input
            type="number"
            value={brickCount || ""}
            onChange={(e) => setBrickCount(Number(e.target.value || 0))}
          />
        </Field>
      </div>

      <div className="grid sm:grid-cols-2 gap-3 mt-3">
        <Field label="Customer (optional)">
          <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">- none -</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.location ? `${c.name} — ${c.location}` : c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Vehicle requested (optional)">
          <Input
            type="text"
            placeholder="e.g. tractor, tipper, 6-wheel lorry"
            value={vehicleRequested}
            onChange={(e) => setVehicleRequested(e.target.value)}
          />
        </Field>
      </div>

      {/* Transport: tipper + shifting charge */}
      <div className="mt-4 pt-3 border-t border-slate-100">
        <div className="text-[12px] font-bold uppercase tracking-wider text-ink mb-2">
          Transport (optional)
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Tipper">
            <Select value={tipperId} onChange={(e) => setTipperId(e.target.value)}>
              <option value="">- none -</option>
              {tippers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.ownership === "own" ? "RD" : "vendor"})
                </option>
              ))}
            </Select>
          </Field>
          {tipperId && (
            <Field label="Shifting / rent charge (₹)">
              <Input
                type="number"
                value={tipperCharge || ""}
                onChange={(e) => setTipperCharge(Number(e.target.value || 0))}
              />
            </Field>
          )}
        </div>
        {tipperId && tipperCharge > 0 && (
          <div
            className={clsx(
              "text-[11px] mt-1 font-semibold",
              tipperIsOwn ? "text-emerald-700" : "text-brand-red"
            )}
          >
            {tipperIsOwn
              ? `RD tipper → +${formatINR(tipperCharge)} income`
              : `Vendor tipper → −${formatINR(tipperCharge)} expense`}
          </div>
        )}
      </div>

      {/* Add-on charges (shifting extras, lintel slab, cement, custom) */}
      <div className="mt-4 pt-3 border-t border-slate-100">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[12px] font-bold uppercase tracking-wider text-ink">
            Charges (optional)
          </div>
          <div className="flex flex-wrap gap-1.5">
            {CHARGE_PRESETS.map((preset) => (
              <button
                key={preset.name}
                type="button"
                onClick={() => addCharge(preset)}
                className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200"
              >
                + {preset.name}
              </button>
            ))}
            <button
              type="button"
              onClick={() => addCharge()}
              className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200"
            >
              + Custom
            </button>
          </div>
        </div>

        {charges.length === 0 ? (
          <div className="text-[12px] text-slate-500">
            No extra charges. Add shifting, lintel slab, cement, etc. — mark each as sold to the
            customer (income) or bought from a vendor (expense).
          </div>
        ) : (
          <div className="space-y-2">
            {charges.map((c, i) => (
              <div
                key={i}
                className="grid grid-cols-12 gap-2 items-end bg-slate-50 rounded-xl p-2.5"
              >
                <div className="col-span-12 sm:col-span-4">
                  <Field label="Item">
                    <Input
                      type="text"
                      placeholder="Shifting / Cement…"
                      value={c.name}
                      onChange={(e) => updateCharge(i, { name: e.target.value })}
                    />
                  </Field>
                </div>
                <div className="col-span-4 sm:col-span-2">
                  <Field label="Qty">
                    <Input
                      type="number"
                      value={c.quantity || ""}
                      onChange={(e) => updateCharge(i, { quantity: Number(e.target.value || 0) })}
                    />
                  </Field>
                </div>
                <div className="col-span-8 sm:col-span-3">
                  <Field label="Amount (₹)">
                    <Input
                      type="number"
                      value={c.amount || ""}
                      onChange={(e) => updateCharge(i, { amount: Number(e.target.value || 0) })}
                    />
                  </Field>
                </div>
                <div className="col-span-10 sm:col-span-2">
                  <Field label="Type">
                    <Select
                      value={c.direction}
                      onChange={(e) => updateCharge(i, { direction: e.target.value as Dir })}
                    >
                      <option value="in">Sold (income)</option>
                      <option value="out">Bought (expense)</option>
                    </Select>
                  </Field>
                </div>
                <div className="col-span-2 sm:col-span-1 flex justify-end">
                  <button
                    type="button"
                    onClick={() => removeCharge(i)}
                    className="w-9 h-9 rounded-md hover:bg-slate-200 inline-flex items-center justify-center text-slate-500"
                    title="Remove"
                  >
                    <Icon.Trash size={15} />
                  </button>
                </div>
                {c.direction === "out" && vendors.length > 0 && (
                  <div className="col-span-12">
                    <Field label="Vendor (bought from)">
                      <Select
                        value={c.vendorId ?? ""}
                        onChange={(e) => updateCharge(i, { vendorId: e.target.value || undefined })}
                      >
                        <option value="">- none -</option>
                        {vendors.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {showLoad && (
        <div className="mt-4 pt-3 border-t border-slate-100">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[12px] font-bold uppercase tracking-wider text-ink">
              Loading · {loadSel.size} selected
            </div>
            <div className="w-32">
              <Field label={`Rate ₹/${unitOne}`}>
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
              <Field label={`Rate ₹/${unitOne}`}>
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

      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 justify-between">
        <div className="text-[12px] text-slate-500">
          Total salary <span className="num font-bold text-ink">{formatINR(grandTotal)}</span>
          {mode === "both" && <span className="text-slate-400"> (loading + unloading)</span>}
        </div>
        {(chargeIncome > 0 || chargeExpense > 0 || (tipperId && tipperCharge > 0)) && (
          <div className="text-[12px] text-slate-500 flex gap-4">
            <span>
              Income{" "}
              <span className="num font-bold text-emerald-700">
                {formatINR(chargeIncome + (tipperId && tipperIsOwn ? tipperCharge : 0))}
              </span>
            </span>
            <span>
              Expense{" "}
              <span className="num font-bold text-brand-red">
                {formatINR(chargeExpense + (tipperId && !tipperIsOwn ? tipperCharge : 0))}
              </span>
            </span>
          </div>
        )}
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
