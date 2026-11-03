"use client";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Button, Card, Field, Input, Pill, Select } from "@/components/ui";
import { Icon } from "@/components/icons";
import { formatINR, formatNumber, formatISODate, formatShortDate } from "@/lib/format";
import { ORDER_STATUSES, orderStatusLabel, orderStatusTone } from "@/lib/order-status";

export type RegisterRow = {
  orderId: string;
  clientId: string;
  date: string; // ISO
  phone: string;
  name: string;
  location: string;
  brickSizeId: string;
  brickSize: string;
  constructionTypeId: string;
  constructionType: string;
  quantity: number;
  pricePerBrick: number;
  amount: number;
  advance: number;
  balance: number;
  status: string;
  notes: string;
  expectedDeliveryDate: string | null;
};

type Option = { id: string; label: string };

// A loading trip for a named customer that never became an order.
export type UnbilledLoad = {
  loadGroupId: string;
  date: string;
  clientId: string;
  clientName: string;
  phone: string;
  location: string;
  brickSizeId: string;
  sizeLabel: string;
  bricks: number;
};
// Opened by a telecaller with a name, number and advance — no order yet.
export type WaitingClient = {
  id: string;
  name: string;
  phone: string;
  location: string;
  advance: number;
  since: string;
};

type Method = "cash" | "gpay" | "bank" | "upi" | "cheque";

const blankDraft = (sizes: Option[], types: Option[]) => ({
  date: formatISODate(new Date()),
  phone: "",
  name: "",
  location: "",
  brickSizeId: sizes[0]?.id ?? "",
  constructionTypeId: types[0]?.id ?? "",
  quantity: 0,
  pricePerBrick: 0,
  advance: 0,
  advanceMethod: "cash" as Method,
  expectedDeliveryDate: "",
  notes: "",
});

export function RegisterView({
  rows,
  sizes,
  types,
  priceFor,
  status,
  unbilled,
  waiting,
  onCreate,
  onSetStatus,
}: {
  rows: RegisterRow[];
  sizes: Option[];
  types: Option[];
  // Sell price per (size × construction type), so the rate fills itself in the
  // same way the office already knows it by heart.
  priceFor: Record<string, number>;
  status: string;
  unbilled: UnbilledLoad[];
  waiting: WaitingClient[];
  onCreate: (d: ReturnType<typeof blankDraft> & { fromLoadGroupId?: string }) => Promise<void>;
  onSetStatus: (orderId: string, status: string) => Promise<void>;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(() => blankDraft(sizes, types));
  const [adding, setAdding] = useState(false);
  const [showUnbilled, setShowUnbilled] = useState(false);
  const [showWaiting, setShowWaiting] = useState(false);
  // Set while billing a load, so the saved order also books the delivery.
  const [fromLoad, setFromLoad] = useState<UnbilledLoad | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const set = (patch: Partial<ReturnType<typeof blankDraft>>) =>
    setDraft((d) => ({ ...d, ...patch }));

  // Picking a size / type pulls in the matrix rate unless the user typed one.
  const applyRate = (brickSizeId: string, constructionTypeId: string) => {
    const rate = priceFor[`${brickSizeId}:${constructionTypeId}`];
    setDraft((d) => ({
      ...d,
      brickSizeId,
      constructionTypeId,
      pricePerBrick: d.pricePerBrick > 0 ? d.pricePerBrick : (rate ?? 0),
    }));
  };

  const draftAmount = (draft.quantity || 0) * (draft.pricePerBrick || 0);
  const draftBalance = Math.max(0, draftAmount - (draft.advance || 0));

  const totals = useMemo(
    () => ({
      bricks: rows.reduce((s, r) => s + r.quantity, 0),
      amount: rows.reduce((s, r) => s + r.amount, 0),
      advance: rows.reduce((s, r) => s + r.advance, 0),
      balance: rows.reduce((s, r) => s + r.balance, 0),
    }),
    [rows]
  );

  const save = () => {
    setError(null);
    if (!draft.name.trim()) return setError("Enter the customer name");
    // A telecaller's row is just the customer and their advance. Bricks and
    // rate come later, when the lorry is loaded — but half of a pair is a
    // mistake worth catching.
    const wantsOrder = draft.quantity > 0 || draft.pricePerBrick > 0;
    if (wantsOrder && draft.quantity <= 0) return setError("Enter the total bricks, or clear the rate");
    if (wantsOrder && draft.pricePerBrick <= 0) return setError("Enter the rate, or clear the bricks");
    if (!wantsOrder && draft.advance <= 0 && !fromLoad) {
      return setError("Enter an advance, or the bricks and rate");
    }
    startTransition(async () => {
      try {
        await onCreate({ ...draft, fromLoadGroupId: fromLoad?.loadGroupId });
        setDraft(blankDraft(sizes, types));
        setAdding(false);
        setFromLoad(null);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save the row");
      }
    });
  };

  const cycleStatus = (row: RegisterRow) => {
    const order = ["upcoming", "active", "completed"];
    const next = order[(order.indexOf(row.status) + 1) % order.length];
    startTransition(async () => {
      await onSetStatus(row.orderId, next);
      router.refresh();
    });
  };

  // Everything about the trip is already known except the price, so prefill it
  // and put the cursor on the one thing the office has to decide.
  const billLoad = (u: UnbilledLoad) => {
    setFromLoad(u);
    setDraft({
      ...blankDraft(sizes, types),
      date: u.date,
      phone: u.phone,
      name: u.clientName,
      location: u.location,
      brickSizeId: u.brickSizeId || sizes[0]?.id || "",
      quantity: u.bricks,
      pricePerBrick: 0,
    });
    setAdding(true);
    setShowUnbilled(false);
  };

  return (
    <div className="space-y-4">
      {/* Customers a telecaller opened - name and advance, nothing ordered yet */}
      {waiting.length > 0 && (
        <div className="rounded-2xl border border-blue-300 bg-blue-50 overflow-hidden">
          <button
            onClick={() => setShowWaiting((v) => !v)}
            className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
          >
            <div>
              <div className="text-[13px] font-bold text-blue-900">
                {waiting.length} customer{waiting.length === 1 ? "" : "s"} waiting to be loaded
              </div>
              <div className="text-[11px] text-blue-800/80 mt-0.5">
                Opened with a name and an advance. They become a sale when the lorry is loaded and
                the rate is entered on the loading screen.
              </div>
            </div>
            <span className="text-[12px] font-semibold text-blue-900 whitespace-nowrap">
              {showWaiting ? "Hide" : "Show"}
            </span>
          </button>
          {showWaiting && (
            <div className="border-t border-blue-200 divide-y divide-blue-200">
              {waiting.map((w) => (
                <div key={w.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-ink">
                      {w.name}
                      <span className="text-slate-500 font-normal">
                        {w.location ? ` · ${w.location}` : ""}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-600">
                      {w.phone ? `${w.phone} · ` : ""}since {formatShortDate(new Date(w.since))}
                    </div>
                  </div>
                  <div className="text-right whitespace-nowrap">
                    {w.advance > 0 ? (
                      <div className="num text-[12px] font-bold text-emerald-700">
                        {formatINR(w.advance)} advance
                      </div>
                    ) : (
                      <div className="text-[11px] text-slate-400">no advance</div>
                    )}
                    <Link
                      href="/loading/new"
                      className="text-[11px] font-semibold text-brand-blue hover:underline"
                    >
                      Enter loading →
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Bricks that went out but were never billed */}
      {unbilled.length > 0 && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 overflow-hidden">
          <button
            onClick={() => setShowUnbilled((v) => !v)}
            className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
          >
            <div>
              <div className="text-[13px] font-bold text-amber-900">
                {unbilled.length} load{unbilled.length === 1 ? "" : "s"} went out with no order
              </div>
              <div className="text-[11px] text-amber-800/80 mt-0.5">
                Bricks were loaded for a customer but never billed - they are not in this register
                and not counted as sold.
              </div>
            </div>
            <span className="text-[12px] font-semibold text-amber-900 whitespace-nowrap">
              {showUnbilled ? "Hide" : "Show"}
            </span>
          </button>
          {showUnbilled && (
            <div className="border-t border-amber-200 divide-y divide-amber-200">
              {unbilled.map((u) => (
                <div key={u.loadGroupId} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-ink">
                      {u.clientName}
                      <span className="text-slate-500 font-normal">
                        {u.location ? ` · ${u.location}` : ""}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-600">
                      {formatShortDate(new Date(u.date))} · {formatNumber(u.bricks)} bricks ·{" "}
                      {u.sizeLabel}
                    </div>
                  </div>
                  <button
                    onClick={() => billLoad(u)}
                    className="px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-amber-600 text-white hover:bg-amber-700 whitespace-nowrap"
                  >
                    Bill it
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* One-line entry — the whole row, the way it goes into the book */}
      {adding ? (
        <Card className="border-2 border-brand-red/30">
          <div className="text-[12px] font-bold uppercase tracking-wider text-ink mb-3">
            {fromLoad ? "Bill the load that went out" : "New register row"}
          </div>
          {fromLoad && (
            <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
              {formatNumber(fromLoad.bricks)} bricks went to <b>{fromLoad.clientName}</b> on{" "}
              {formatShortDate(new Date(fromLoad.date))}. Everything is filled in except the rate -
              enter it and this becomes an order with those bricks already delivered.
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5">
            <Field label="Date">
              <Input type="date" value={draft.date} onChange={(e) => set({ date: e.target.value })} />
            </Field>
            <Field label="Number">
              <Input
                value={draft.phone}
                onChange={(e) => set({ phone: e.target.value })}
                placeholder="94xxxxxxxx"
                inputMode="tel"
              />
            </Field>
            <Field label="Name">
              <Input
                value={draft.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="Customer"
                autoFocus
              />
            </Field>
            <Field label="Location">
              <Input
                value={draft.location}
                onChange={(e) => set({ location: e.target.value })}
                placeholder="Salem"
              />
            </Field>
            <Field label="Brick size">
              <Select
                value={draft.brickSizeId}
                onChange={(e) => applyRate(e.target.value, draft.constructionTypeId)}
              >
                {sizes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Room / Comp">
              <Select
                value={draft.constructionTypeId}
                onChange={(e) => applyRate(draft.brickSizeId, e.target.value)}
              >
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Rate ₹ (later)">
              <Input
                type="number"
                value={draft.pricePerBrick || ""}
                onChange={(e) => set({ pricePerBrick: Number(e.target.value || 0) })}
              />
            </Field>
            <Field label="Total bricks (later)">
              <Input
                type="number"
                value={draft.quantity || ""}
                onChange={(e) => set({ quantity: Number(e.target.value || 0) })}
              />
            </Field>
            <Field label="Advance ₹">
              <Input
                type="number"
                value={draft.advance || ""}
                onChange={(e) => set({ advance: Number(e.target.value || 0) })}
              />
            </Field>
            <Field label="Advance by">
              <Select
                value={draft.advanceMethod}
                onChange={(e) => set({ advanceMethod: e.target.value as Method })}
              >
                <option value="cash">Cash</option>
                <option value="gpay">GPay</option>
                <option value="upi">UPI</option>
                <option value="bank">Bank</option>
                <option value="cheque">Cheque</option>
              </Select>
            </Field>
            <Field label="Delivery date">
              <Input
                type="date"
                value={draft.expectedDeliveryDate}
                onChange={(e) => set({ expectedDeliveryDate: e.target.value })}
              />
            </Field>
            <Field label="Note">
              <Input
                value={draft.notes}
                onChange={(e) => set({ notes: e.target.value })}
                placeholder="Aug 2nd month…"
              />
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 mt-3 text-[12px] text-slate-600">
            <span>
              Total amount{" "}
              <span className="num font-bold text-ink">{formatINR(draftAmount)}</span>
            </span>
            <span>
              Balance <span className="num font-bold text-brand-red">{formatINR(draftBalance)}</span>
            </span>
          </div>

          {error && <div className="text-xs text-red-600 mt-2">{error}</div>}
          <div className="flex gap-2 mt-3">
            <Button onClick={save} disabled={isPending} variant="primary">
              {isPending ? "Saving…" : "Save row"}
            </Button>
            <Button
              onClick={() => {
                setAdding(false);
                setFromLoad(null);
                setError(null);
              }}
              variant="ghost"
            >
              Cancel
            </Button>
          </div>
        </Card>
      ) : (
        <div className="flex justify-end">
          <Button onClick={() => setAdding(true)} variant="primary">
            <Icon.Plus size={15} stroke={2.4} /> Add row
          </Button>
        </div>
      )}

      {rows.length === 0 ? (
        <Card>
          <div className="text-center text-sm text-slate-500 py-8">
            No rows for this filter yet. Hit <b>Add row</b> to write the first one.
          </div>
        </Card>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-900/[.06] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] whitespace-nowrap">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <Th>S.No</Th>
                  <Th>Date</Th>
                  <Th>Number</Th>
                  <Th>Name</Th>
                  <Th>Location</Th>
                  <Th align="center">Size</Th>
                  <Th align="center">Room / Comp</Th>
                  <Th align="right">Rate</Th>
                  <Th align="right">Total bricks</Th>
                  <Th align="right">Total amount</Th>
                  <Th align="right">Advance</Th>
                  <Th align="right">Balance</Th>
                  <Th align="center">Status</Th>
                  <Th>Note</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={r.orderId}
                    className={clsx(
                      "border-b border-slate-100 last:border-b-0 hover:bg-slate-50",
                      r.status === "completed" && "text-slate-500"
                    )}
                  >
                    <Td className="text-slate-400 num">{i + 1}</Td>
                    <Td className="num">{formatShortDate(new Date(r.date))}</Td>
                    <Td className="mono text-[12px]">
                      {r.phone ? (
                        <a href={`tel:${r.phone}`} className="text-brand-blue">
                          {r.phone}
                        </a>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </Td>
                    <Td className="font-semibold text-ink">
                      <Link href={`/clients/${r.clientId}`} className="hover:underline">
                        {r.name}
                      </Link>
                    </Td>
                    <Td className="text-slate-600">{r.location || "-"}</Td>
                    <Td align="center" className="font-semibold">
                      {r.brickSize}
                    </Td>
                    <Td align="center" className="text-slate-600">
                      {r.constructionType}
                    </Td>
                    <Td align="right" className="num">
                      ₹{r.pricePerBrick}
                    </Td>
                    <Td align="right" className="num">
                      {formatNumber(r.quantity)}
                    </Td>
                    <Td align="right" className="num font-bold">
                      {formatINR(r.amount)}
                    </Td>
                    <Td align="right" className="num text-emerald-700">
                      {r.advance > 0 ? formatINR(r.advance) : "-"}
                    </Td>
                    <Td align="right" className="num font-semibold text-brand-red">
                      {r.balance > 0 ? formatINR(r.balance) : "-"}
                    </Td>
                    <Td align="center">
                      <button
                        onClick={() => cycleStatus(r)}
                        disabled={isPending}
                        title="Tap to change"
                      >
                        <Pill tone={orderStatusTone(r.status)}>{orderStatusLabel(r.status)}</Pill>
                      </button>
                    </Td>
                    <Td className="text-slate-500 max-w-[180px] truncate" title={r.notes}>
                      {r.notes || "-"}
                    </Td>
                  </tr>
                ))}
                <tr className="bg-slate-50 border-t-2 border-slate-300 font-bold">
                  <Td />
                  <Td />
                  <Td />
                  <Td>Total</Td>
                  <Td />
                  <Td />
                  <Td />
                  <Td />
                  <Td align="right" className="num">
                    {formatNumber(totals.bricks)}
                  </Td>
                  <Td align="right" className="num">
                    {formatINR(totals.amount)}
                  </Td>
                  <Td align="right" className="num text-emerald-700">
                    {formatINR(totals.advance)}
                  </Td>
                  <Td align="right" className="num text-brand-red">
                    {formatINR(totals.balance)}
                  </Td>
                  <Td />
                  <Td />
                  <Td />
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="text-[11px] text-slate-500 px-1">
        Showing <b>{orderStatusLabel(status)}</b> rows. Tap a status chip to move a row between
        Upcoming, Active and Completed.
      </div>
    </div>
  );
}

function Th({
  children,
  align,
}: {
  children?: React.ReactNode;
  align?: "right" | "left" | "center";
}) {
  return (
    <th
      className={`px-3 py-2.5 font-semibold text-slate-600 uppercase tracking-wider text-[10px] ${
        align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align,
  className,
  title,
}: {
  children?: React.ReactNode;
  align?: "right" | "left" | "center";
  className?: string;
  title?: string;
}) {
  return (
    <td
      title={title}
      className={`px-3 py-2.5 ${
        align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"
      } ${className ?? ""}`}
    >
      {children}
    </td>
  );
}

export { ORDER_STATUSES };
