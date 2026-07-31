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
  onCreate,
  onPay,
  onSetStatus,
}: {
  rows: RegisterRow[];
  sizes: Option[];
  types: Option[];
  // Sell price per (size × construction type), so the rate fills itself in the
  // same way the office already knows it by heart.
  priceFor: Record<string, number>;
  status: string;
  onCreate: (d: ReturnType<typeof blankDraft>) => Promise<void>;
  onPay: (d: { orderId: string; amount: number; date: string; method: Method }) => Promise<void>;
  onSetStatus: (orderId: string, status: string) => Promise<void>;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(() => blankDraft(sizes, types));
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payFor, setPayFor] = useState<RegisterRow | null>(null);
  const [payAmount, setPayAmount] = useState<number>(0);
  const [payMethod, setPayMethod] = useState<Method>("cash");
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
    if (!draft.quantity || draft.quantity <= 0) return setError("Enter the total bricks");
    if (!draft.pricePerBrick || draft.pricePerBrick <= 0) return setError("Enter the rate");
    startTransition(async () => {
      try {
        await onCreate(draft);
        setDraft(blankDraft(sizes, types));
        setAdding(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save the row");
      }
    });
  };

  const submitPay = () => {
    if (!payFor || payAmount <= 0) return;
    const row = payFor;
    startTransition(async () => {
      await onPay({
        orderId: row.orderId,
        amount: payAmount,
        date: formatISODate(new Date()),
        method: payMethod,
      });
      setPayFor(null);
      setPayAmount(0);
      router.refresh();
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

  return (
    <div className="space-y-4">
      {/* One-line entry — the whole row, the way it goes into the book */}
      {adding ? (
        <Card className="border-2 border-brand-red/30">
          <div className="text-[12px] font-bold uppercase tracking-wider text-ink mb-3">
            New register row
          </div>
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
            <Field label="Rate ₹">
              <Input
                type="number"
                value={draft.pricePerBrick || ""}
                onChange={(e) => set({ pricePerBrick: Number(e.target.value || 0) })}
              />
            </Field>
            <Field label="Total bricks">
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

      {/* Take a payment against a row */}
      {payFor && (
        <Card className="border-2 border-emerald-500/40">
          <div className="text-[13px] font-bold text-ink mb-2">
            Payment from {payFor.name}{" "}
            <span className="text-slate-500 font-normal">
              · balance {formatINR(payFor.balance)}
            </span>
          </div>
          <div className="grid sm:grid-cols-3 gap-2.5">
            <Field label="Amount ₹">
              <Input
                type="number"
                value={payAmount || ""}
                onChange={(e) => setPayAmount(Number(e.target.value || 0))}
                autoFocus
              />
            </Field>
            <Field label="Method">
              <Select value={payMethod} onChange={(e) => setPayMethod(e.target.value as Method)}>
                <option value="cash">Cash</option>
                <option value="gpay">GPay</option>
                <option value="upi">UPI</option>
                <option value="bank">Bank</option>
                <option value="cheque">Cheque</option>
              </Select>
            </Field>
            <div className="flex items-end gap-2">
              <Button onClick={submitPay} disabled={isPending} variant="primary">
                {isPending ? "Saving…" : "Record"}
              </Button>
              <Button onClick={() => setPayFor(null)} variant="ghost">
                Cancel
              </Button>
            </div>
          </div>
        </Card>
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
                  <Th align="right"></Th>
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
                    <Td align="right">
                      {r.balance > 0 && (
                        <button
                          onClick={() => {
                            setPayFor(r);
                            setPayAmount(r.balance);
                          }}
                          className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-emerald-600 text-white hover:bg-emerald-700"
                        >
                          Pay
                        </button>
                      )}
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
