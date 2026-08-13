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
type Dir = "in" | "out";

type Crew = {
  workers: Array<{ type: WorkerType; id: string }>;
  ratePerBrick: number;
  ratePerSlab: number;
};
type ClientOption = { id: string; name: string; location?: string; advance: number };
type OrderOption = {
  id: string;
  clientId: string;
  date: string;
  ordered: number;
  delivered: number;
  pending: number;
  sizes: string[];
};
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
type SizeLine = { brickSizeId: string; brickCount: number };
type Sub = {
  date: string;
  clientId?: string;
  vehicleRequested?: string;
  items: Array<{ brickSizeId?: string; brickCount: number }>;
  slabCount: number;
  orderId?: string;
  saleRate?: number;
  constructionTypeId?: string;
  payNow?: number;
  payNowMethod?: "cash" | "gpay" | "bank" | "upi" | "cheque";
  loading?: Crew;
  unloading?: Crew;
  tipperId?: string;
  tipperCharge: number;
  charges: ChargeLine[];
};

// Sentinel for "deliberately no customer", so a blank select can be told apart
// from a field the user simply never touched.
const INTERNAL = "__internal__";

const CHARGE_PRESETS: Array<{ name: string; unit: string }> = [
  { name: "Shifting charges", unit: "trip" },
  { name: "Lintel Beam", unit: "pcs" },
  { name: "Cement", unit: "bag" },
];

export function LoadingMultiForm({
  workers,
  sizes,
  types,
  priceFor,
  clients,
  orders,
  tippers,
  vendors,
  onSubmit,
}: {
  workers: { loaders: WorkerOption[]; operators: WorkerOption[]; employees: WorkerOption[] };
  sizes: Array<{ id: string; label: string }>;
  types: Array<{ id: string; label: string }>;
  // Sell price per (size × construction type) so the rate fills itself in.
  priceFor: Record<string, number>;
  clients: ClientOption[];
  orders: OrderOption[];
  tippers: TipperOption[];
  vendors: VendorOption[];
  onSubmit: (d: Sub) => Promise<void>;
}) {
  const all = [...workers.loaders, ...workers.operators, ...workers.employees];
  const keyOf = (w: WorkerOption) => `${w.type}:${w.id}`;

  const [date, setDate] = useState(formatISODate(new Date()));
  // One line per brick size on the trip, so a lorry carrying 6" AND 8" is a
  // single entry instead of two. Lintel beams ride along on the same entry.
  const [lines, setLines] = useState<SizeLine[]>([
    { brickSizeId: sizes[0]?.id ?? "", brickCount: 1000 },
  ]);
  const [slabCount, setSlabCount] = useState<number>(0);
  const [clientId, setClientId] = useState<string>("");
  const [orderId, setOrderId] = useState<string>("");
  // Rate agreed with the customer when the lorry is loaded. The telecaller only
  // took a name and an advance, so this is where the sale actually gets priced.
  const [saleRate, setSaleRate] = useState<number>(0);
  const [saleTypeId, setSaleTypeId] = useState<string>(types[0]?.id ?? "");
  // The matrix already knows what this size × type sells for, so offer it and
  // let the manager overwrite it if the customer agreed something else.
  const matrixRate = (sizeId: string, typeId: string) => priceFor[`${sizeId}:${typeId}`] ?? 0;
  const fillRate = (typeId: string) => {
    const sizeId = lines.find((l) => l.brickCount > 0)?.brickSizeId || lines[0]?.brickSizeId || "";
    const r = matrixRate(sizeId, typeId);
    if (r > 0) setSaleRate(r);
  };
  // Cash handed over at the lorry, on top of anything already advanced.
  const [payNow, setPayNow] = useState<number>(0);
  const [payNowMethod, setPayNowMethod] = useState<"cash" | "gpay" | "bank" | "upi" | "cheque">("cash");
  const [vehicleRequested, setVehicleRequested] = useState<string>("");

  const [tipperId, setTipperId] = useState<string>("");
  const [tipperCharge, setTipperCharge] = useState<number>(0);
  const [charges, setCharges] = useState<ChargeLine[]>([]);

  const [mode, setMode] = useState<Mode>("loading");
  const [loadSel, setLoadSel] = useState<Set<string>>(new Set());
  const [loadRate, setLoadRate] = useState<number>(0.5);
  const [loadSlabRate, setLoadSlabRate] = useState<number>(0);
  const [unloadSel, setUnloadSel] = useState<Set<string>>(new Set());
  const [unloadRate, setUnloadRate] = useState<number>(0.5);
  const [unloadSlabRate, setUnloadSlabRate] = useState<number>(0);

  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const showLoad = mode !== "unloading";
  const showUnload = mode !== "loading";

  // Every crew is paid on the whole trip, so the split tables and the salary
  // work off the combined count across all size lines, plus the slabs.
  const brickCount = lines.reduce((s, l) => s + (l.brickCount || 0), 0);
  const hasSlabs = slabCount > 0;
  const hasBricks = brickCount > 0;

  const addLine = () =>
    setLines((l) => [
      ...l,
      {
        brickSizeId: sizes.find((s) => !l.some((x) => x.brickSizeId === s.id))?.id ?? "",
        brickCount: 0,
      },
    ]);
  const updateLine = (i: number, patch: Partial<SizeLine>) =>
    setLines((l) => l.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  const removeLine = (i: number) => setLines((l) => l.filter((_, idx) => idx !== i));

  const tipper = tippers.find((t) => t.id === tipperId);
  const tipperIsOwn = tipper?.ownership === "own";

  const client = clients.find((c) => c.id === clientId);
  const priorAdvance = client?.advance ?? 0;
  const saleValue = Math.round(brickCount * (saleRate || 0));
  const clientOrders = orders.filter((o) => o.clientId === clientId);
  const selectedOrder = orders.find((o) => o.id === orderId);

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

  // Bricks and slabs are split across the crew separately, because they are
  // paid at different rates, then added up per worker.
  const crewTotal = (rate: number, slabRate: number) =>
    Math.round(brickCount * (rate || 0) + slabCount * (slabRate || 0));

  const splitTable = (sel: Set<string>, rate: number, slabRate: number) => {
    const sw = workersFor(sel);
    if (sw.length === 0) return null;
    const bricksSplit = distributeInt(brickCount || 0, sw.length);
    const slabsSplit = distributeInt(slabCount || 0, sw.length);
    return (
      <div className="mt-3 bg-slate-50 rounded-xl overflow-hidden">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-slate-500 text-[10px] uppercase tracking-wider">
              <th className="text-left px-3 py-2">Worker</th>
              {hasBricks && <th className="text-right px-3 py-2">Bricks</th>}
              {hasSlabs && <th className="text-right px-3 py-2">Slabs</th>}
              <th className="text-right px-3 py-2">Salary</th>
            </tr>
          </thead>
          <tbody>
            {sw.map((w, i) => {
              const b = bricksSplit[i] ?? 0;
              const s = slabsSplit[i] ?? 0;
              return (
                <tr key={keyOf(w)} className="border-t border-slate-200">
                  <td className="px-3 py-2 font-semibold text-ink">{w.name}</td>
                  {hasBricks && <td className="px-3 py-2 text-right num">{formatNumber(b)}</td>}
                  {hasSlabs && <td className="px-3 py-2 text-right num">{formatNumber(s)}</td>}
                  <td className="px-3 py-2 text-right num font-semibold">
                    {formatINR(Math.round(b * (rate || 0) + s * (slabRate || 0)))}
                  </td>
                </tr>
              );
            })}
            <tr className="border-t-2 border-slate-300 bg-white">
              <td className="px-3 py-2 font-bold">Total</td>
              {hasBricks && (
                <td className="px-3 py-2 text-right num font-bold">{formatNumber(brickCount)}</td>
              )}
              {hasSlabs && (
                <td className="px-3 py-2 text-right num font-bold">{formatNumber(slabCount)}</td>
              )}
              <td className="px-3 py-2 text-right num font-bold">
                {formatINR(crewTotal(rate, slabRate))}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  };

  const grandTotal = useMemo(() => {
    const load = showLoad ? Math.round(brickCount * (loadRate || 0) + slabCount * (loadSlabRate || 0)) : 0;
    const unload = showUnload
      ? Math.round(brickCount * (unloadRate || 0) + slabCount * (unloadSlabRate || 0))
      : 0;
    return load + unload;
  }, [brickCount, slabCount, loadRate, loadSlabRate, unloadRate, unloadSlabRate, showLoad, showUnload]);

  const submit = () => {
    setError(null);
    if (brickCount <= 0 && slabCount <= 0) {
      return setError("Enter the bricks, the lintel beams, or both");
    }
    const seen = new Set<string>();
    for (const l of lines.filter((x) => x.brickCount > 0)) {
      const key = l.brickSizeId || "mixed";
      if (seen.has(key)) return setError("Each brick size can only be listed once");
      seen.add(key);
    }
    if (!clientId) {
      return setError("Choose the customer, or pick 'No customer' if it was an internal move");
    }
    if (showLoad && loadSel.size === 0) return setError("Pick at least one person who loaded");
    if (showLoad && hasBricks && loadRate <= 0) return setError("Loading rate must be more than 0");
    if (showLoad && hasSlabs && loadSlabRate <= 0) {
      return setError("Enter the loading rate per slab");
    }
    if (showUnload && unloadSel.size === 0) return setError("Pick at least one person who unloaded");
    if (showUnload && hasBricks && unloadRate <= 0) {
      return setError("Unloading rate must be more than 0");
    }
    if (showUnload && hasSlabs && unloadSlabRate <= 0) {
      return setError("Enter the unloading rate per slab");
    }
    // Every load for a real customer has to be billed. Leaving the rate blank
    // is what left 95 loads and 26,698 bricks sold but never invoiced.
    if (clientId && clientId !== INTERNAL && !orderId && hasBricks && saleRate <= 0) {
      return setError(
        "Enter the rate per brick so this load is billed - or choose 'No customer' if it is an internal move"
      );
    }
    if (tipperId && tipperCharge < 0) return setError("Tipper charge can't be negative");
    for (const c of charges) {
      if (!c.name.trim()) return setError("Every charge needs a name (or remove the empty line)");
    }
    startTransition(async () => {
      try {
        await onSubmit({
          date,
          clientId: clientId && clientId !== INTERNAL ? clientId : undefined,
          vehicleRequested: vehicleRequested.trim() || undefined,
          items: lines
            .filter((l) => l.brickCount > 0)
            .map((l) => ({ brickSizeId: l.brickSizeId || undefined, brickCount: l.brickCount })),
          slabCount,
          orderId: orderId || undefined,
          saleRate: !orderId && saleRate > 0 ? saleRate : 0,
          constructionTypeId: !orderId ? saleTypeId || undefined : undefined,
          payNow: payNow > 0 ? payNow : 0,
          payNowMethod,
          loading: showLoad
            ? {
                workers: workersFor(loadSel).map((w) => ({ type: w.type, id: w.id })),
                ratePerBrick: loadRate,
                ratePerSlab: loadSlabRate,
              }
            : undefined,
          unloading: showUnload
            ? {
                workers: workersFor(unloadSel).map((w) => ({ type: w.type, id: w.id })),
                ratePerBrick: unloadRate,
                ratePerSlab: unloadSlabRate,
              }
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

      <div className="grid sm:grid-cols-3 gap-3">
        <Field label="Date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>

      {/* What went on the lorry — brick sizes and lintel beams, one entry */}
      <div className="mt-4 pt-3 border-t border-slate-100">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[12px] font-bold uppercase tracking-wider text-ink">
            What went on the lorry
          </div>
          <button
            type="button"
            onClick={addLine}
            className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200"
          >
            + Add another size
          </button>
        </div>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-end bg-slate-50 rounded-xl p-2.5">
              <div className="col-span-6 sm:col-span-6">
                <Field label="Brick size">
                  <Select
                    value={l.brickSizeId}
                    onChange={(e) => updateLine(i, { brickSizeId: e.target.value })}
                  >
                    <option value="">- mixed -</option>
                    {sizes.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div className="col-span-4 sm:col-span-5">
                <Field label="Bricks">
                  <Input
                    type="number"
                    value={l.brickCount || ""}
                    onChange={(e) => updateLine(i, { brickCount: Number(e.target.value || 0) })}
                  />
                </Field>
              </div>
              <div className="col-span-2 sm:col-span-1 flex justify-end">
                {lines.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeLine(i)}
                    className="w-9 h-9 rounded-md hover:bg-slate-200 inline-flex items-center justify-center text-slate-500"
                    title="Remove this size"
                  >
                    <Icon.Trash size={15} />
                  </button>
                )}
              </div>
            </div>
          ))}

          {/* Lintel beams travel with the bricks — same trip, same entry. */}
          <div className="grid grid-cols-12 gap-2 items-end bg-amber-50 rounded-xl p-2.5 border border-amber-200">
            <div className="col-span-6 sm:col-span-6">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-800 mb-1.5">
                Lintel beams
              </div>
              <div className="text-[11px] text-amber-800/80">
                On the same lorry - leave 0 if none
              </div>
            </div>
            <div className="col-span-6 sm:col-span-5">
              <Field label="Slabs">
                <Input
                  type="number"
                  value={slabCount || ""}
                  onChange={(e) => setSlabCount(Number(e.target.value || 0))}
                />
              </Field>
            </div>
          </div>
        </div>
        <div className="text-[11px] text-slate-500 mt-1.5">
          This trip: <span className="num font-bold text-ink">{formatNumber(brickCount)}</span>{" "}
          bricks
          {hasSlabs && (
            <>
              {" "}
              + <span className="num font-bold text-ink">{formatNumber(slabCount)}</span> slabs
            </>
          )}
          . Each size and the slabs are saved separately, so the reports still show 6&quot;, 8&quot;
          and slabs apart.
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3 mt-3">
        {/* Not optional any more: a blank customer used to be a silent skip,
            which made loads impossible to trace back. Internal moves are still
            allowed, but they have to be chosen on purpose. */}
        <Field label="Customer">
          <Select
            value={clientId}
            onChange={(e) => {
              const next = e.target.value;
              setClientId(next);
              // Pre-pick the order when the customer has exactly one open —
              // the common case, and the office shouldn't have to think.
              const theirs = orders.filter((o) => o.clientId === next);
              const one = theirs.length === 1 ? theirs[0].id : "";
              setOrderId(one);
              if (!one && next && next !== INTERNAL && saleRate <= 0) fillRate(saleTypeId);
            }}
          >
            <option value="">- choose the customer -</option>
            <option value={INTERNAL}>No customer (internal / yard move)</option>
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

      {/* Deliver against an order — what makes the customer's balance move */}
      {clientId && clientId !== INTERNAL && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <div className="text-[12px] font-bold uppercase tracking-wider text-ink mb-2">
            The sale
          </div>

          {clientOrders.length > 0 && (
            <Field label="Deliver against an existing order">
              <Select value={orderId} onChange={(e) => setOrderId(e.target.value)}>
                <option value="">- new sale, priced below -</option>
                {clientOrders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {new Date(o.date).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                    {o.sizes.length ? ` · ${Array.from(new Set(o.sizes)).join(", ")}` : ""} ·{" "}
                    {formatNumber(o.pending)} of {formatNumber(o.ordered)} still to deliver
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {/* No order picked: price the load here and the sale is created. */}
          {!orderId && (
            <div className="grid sm:grid-cols-3 gap-3 mt-3">
              <Field label="Rate ₹ / brick" hint="What the customer pays">
                <Input
                  type="number"
                  step="0.5"
                  value={saleRate || ""}
                  onChange={(e) => setSaleRate(Number(e.target.value || 0))}
                />
              </Field>
              <Field label="Room / Compound">
                <Select
                  value={saleTypeId}
                  onChange={(e) => {
                    setSaleTypeId(e.target.value);
                    fillRate(e.target.value);
                  }}
                >
                  {types.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="flex items-end">
                <div className="text-[12px] text-slate-600">
                  {saleRate > 0 && hasBricks ? (
                    <>
                      Sale value{" "}
                      <span className="num font-bold text-ink">
                        {formatINR(Math.round(brickCount * saleRate))}
                      </span>
                    </>
                  ) : (
                    <span className="text-slate-400">Enter a rate to bill this load</span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Money at the lorry: what was already advanced, what is handed over
              now, and what is still owed. */}
          {(saleRate > 0 || orderId) && (
            <div className="grid sm:grid-cols-3 gap-3 mt-3">
              <Field label="Received now ₹" hint="Cash taken at the lorry">
                <Input
                  type="number"
                  value={payNow || ""}
                  onChange={(e) => setPayNow(Number(e.target.value || 0))}
                />
              </Field>
              <Field label="Paid by">
                <Select
                  value={payNowMethod}
                  onChange={(e) =>
                    setPayNowMethod(e.target.value as "cash" | "gpay" | "bank" | "upi" | "cheque")
                  }
                >
                  <option value="cash">Cash</option>
                  <option value="gpay">GPay</option>
                  <option value="upi">UPI</option>
                  <option value="bank">Bank</option>
                  <option value="cheque">Cheque</option>
                </Select>
              </Field>
              <div className="flex items-end">
                {priorAdvance > 0 && (
                  <div className="text-[11px] text-slate-600">
                    Advance already paid{" "}
                    <span className="num font-bold text-emerald-700">
                      {formatINR(priorAdvance)}
                    </span>
                    <div className="text-slate-400">attached automatically</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {!orderId && saleRate > 0 && hasBricks && (
            <div className="mt-2 bg-slate-50 rounded-xl p-2.5 text-[12px]">
              <div className="flex justify-between">
                <span>{formatNumber(brickCount)} bricks × ₹{saleRate}</span>
                <span className="num font-bold text-ink">{formatINR(saleValue)}</span>
              </div>
              {priorAdvance > 0 && (
                <div className="flex justify-between text-emerald-700">
                  <span>less advance already paid</span>
                  <span className="num">−{formatINR(Math.min(priorAdvance, saleValue))}</span>
                </div>
              )}
              {payNow > 0 && (
                <div className="flex justify-between text-emerald-700">
                  <span>less received now</span>
                  <span className="num">−{formatINR(payNow)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-slate-200 mt-1.5 pt-1.5 font-bold">
                <span>Balance</span>
                <span className="num text-brand-red">
                  {formatINR(
                    Math.max(0, saleValue - Math.min(priorAdvance, saleValue) - (payNow || 0))
                  )}
                </span>
              </div>
              <div className="text-[10px] text-slate-500 mt-1">
                An order is created for this customer, already delivered, with this money set
                against it.
              </div>
            </div>
          )}
          {!orderId && saleRate <= 0 && (
            <div className="text-[11px] mt-1.5 text-brand-red font-semibold">
              A rate is needed - the load can&apos;t be saved unbilled for a customer.
            </div>
          )}

          {selectedOrder && hasBricks && (
            <div
              className={clsx(
                "text-[11px] mt-1.5 font-semibold",
                brickCount > selectedOrder.pending ? "text-amber-700" : "text-emerald-700"
              )}
            >
              {brickCount > selectedOrder.pending
                ? `${formatNumber(brickCount)} bricks is more than the ${formatNumber(
                    selectedOrder.pending
                  )} still owed on this order - it will be over-delivered.`
                : `${formatNumber(brickCount)} bricks will be booked as delivered. ${formatNumber(
                    selectedOrder.pending - brickCount
                  )} left after this.`}
            </div>
          )}
          {hasSlabs && (
            <div className="text-[11px] mt-1 text-slate-500">
              The {formatNumber(slabCount)} lintel beams stay as loading work - beams are priced on
              their own order lines, not delivered as bricks.
            </div>
          )}
        </div>
      )}

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
            <Field label="Shifting / rent charge (₹)" hint="Enter the amount once">
              <Input
                type="number"
                value={tipperCharge || ""}
                onChange={(e) => setTipperCharge(Number(e.target.value || 0))}
              />
            </Field>
          )}
        </div>
        {tipperId && tipperCharge > 0 && (
          <div className="text-[11px] mt-1 font-semibold">
            {tipperIsOwn ? (
              <span className="text-slate-600">
                Own RD tipper → <span className="text-emerald-700">+{formatINR(tipperCharge)}</span>{" "}
                income on the tipper and{" "}
                <span className="text-brand-red">−{formatINR(tipperCharge)}</span> transport expense,
                both recorded automatically.
              </span>
            ) : (
              <span className="text-slate-600">
                Rented tipper → <span className="text-brand-red">−{formatINR(tipperCharge)}</span>{" "}
                expense recorded automatically. Pay it from the AVM page (advance / tipper due).
              </span>
            )}
          </div>
        )}
      </div>

      {/* Add-on charges (shifting extras, lintel beam, cement, custom) */}
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
            No extra charges. Add shifting, lintel beam, cement, etc. — mark each as sold to the
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
          <div className="flex items-center justify-between mb-2 gap-3">
            <div className="text-[12px] font-bold uppercase tracking-wider text-ink">
              Loading · {loadSel.size} selected
            </div>
            <div className="flex gap-2">
              <div className="w-28">
                <Field label="Rate ₹/brick">
                  <Input
                    type="number"
                    step="0.1"
                    value={loadRate}
                    onChange={(e) => setLoadRate(Number(e.target.value || 0))}
                  />
                </Field>
              </div>
              {hasSlabs && (
                <div className="w-28">
                  <Field label="Rate ₹/slab">
                    <Input
                      type="number"
                      step="0.5"
                      value={loadSlabRate || ""}
                      onChange={(e) => setLoadSlabRate(Number(e.target.value || 0))}
                    />
                  </Field>
                </div>
              )}
            </div>
          </div>
          {groupSelector(loadSel, toggle(setLoadSel))}
          {splitTable(loadSel, loadRate, loadSlabRate)}
        </div>
      )}

      {showUnload && (
        <div className="mt-4 pt-3 border-t border-slate-100">
          <div className="flex items-center justify-between mb-2 gap-3">
            <div className="text-[12px] font-bold uppercase tracking-wider text-ink">
              Unloading · {unloadSel.size} selected
            </div>
            <div className="flex gap-2">
              <div className="w-28">
                <Field label="Rate ₹/brick">
                  <Input
                    type="number"
                    step="0.1"
                    value={unloadRate}
                    onChange={(e) => setUnloadRate(Number(e.target.value || 0))}
                  />
                </Field>
              </div>
              {hasSlabs && (
                <div className="w-28">
                  <Field label="Rate ₹/slab">
                    <Input
                      type="number"
                      step="0.5"
                      value={unloadSlabRate || ""}
                      onChange={(e) => setUnloadSlabRate(Number(e.target.value || 0))}
                    />
                  </Field>
                </div>
              )}
            </div>
          </div>
          {mode === "both" && (
            <div className="text-[11px] text-slate-500 mb-2">
              Pre-filled from the loading crew - deselect or add the people who unloaded.
            </div>
          )}
          {groupSelector(unloadSel, toggle(setUnloadSel))}
          {splitTable(unloadSel, unloadRate, unloadSlabRate)}
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
