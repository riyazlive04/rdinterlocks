"use client";
import { useState, useTransition } from "react";
import { Button, Card, Field, Input, Select } from "@/components/ui";
import { Icon } from "@/components/icons";
import { formatINR, formatISODate } from "@/lib/format";

type Item = {
  brickSizeId: string;
  constructionTypeId: string;
  quantity: number;
  pricePerBrick: number;
};
type AddOn = { name: string; quantity: number; unit: string; pricePerUnit: number };
type Return = { brickCount: number; refundAmount: number; notes?: string };

type Sub = {
  orderId: string;
  date: string;
  truckPlate?: string;
  notes?: string;
  items: Item[];
  addOns: AddOn[];
  returns: Return[];
  paymentReceived: number;
  paymentMethod: "cash" | "gpay" | "bank" | "upi" | "cheque";
};

type DeliveryInitial = {
  date: string;
  truckPlate?: string;
  notes?: string;
  items: Item[];
  addOns: AddOn[];
  returns: Return[];
};

export function DeliveryForm({
  orderId,
  sizes,
  ctypes,
  priceMap,
  defaults,
  initial,
  submitLabel,
  hidePayment,
  onSubmit,
}: {
  orderId: string;
  sizes: Array<{ id: string; label: string }>;
  ctypes: Array<{ id: string; name: string }>;
  priceMap: Record<string, number>;
  defaults: Item[];
  initial?: DeliveryInitial;
  submitLabel?: string;
  hidePayment?: boolean;
  onSubmit: (d: Sub) => Promise<void>;
}) {
  const [date, setDate] = useState(initial?.date ?? formatISODate(new Date()));
  const [truckPlate, setTruckPlate] = useState(initial?.truckPlate ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [items, setItems] = useState<Item[]>(
    initial?.items && initial.items.length > 0
      ? initial.items
      : defaults.length > 0
        ? defaults
        : [
            {
              brickSizeId: sizes[0]?.id ?? "",
              constructionTypeId: ctypes[0]?.id ?? "",
              quantity: 1000,
              pricePerBrick: priceMap[`${sizes[0]?.id}_${ctypes[0]?.id}`] ?? 0,
            },
          ]
  );
  const [addOns, setAddOns] = useState<AddOn[]>(initial?.addOns ?? []);
  const [returns, setReturns] = useState<Return[]>(initial?.returns ?? []);
  const [paymentReceived, setPaymentReceived] = useState<number | "">("");
  const [paymentMethod, setPaymentMethod] = useState<Sub["paymentMethod"]>("cash");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const setItem = (i: number, patch: Partial<Item>) =>
    setItems((arr) => {
      const next = arr.slice();
      const merged = { ...next[i], ...patch };
      const auto = priceMap[`${merged.brickSizeId}_${merged.constructionTypeId}`];
      if ((patch.brickSizeId || patch.constructionTypeId) && auto != null) {
        merged.pricePerBrick = auto;
      }
      next[i] = merged;
      return next;
    });

  const itemsTotal = items.reduce((s, it) => s + it.quantity * it.pricePerBrick, 0);
  const addOnsTotal = addOns.reduce((s, a) => s + a.quantity * a.pricePerUnit, 0);
  const returnsTotal = returns.reduce((s, r) => s + r.refundAmount, 0);
  const grandTotal = itemsTotal + addOnsTotal - returnsTotal;
  const balance = grandTotal - Number(paymentReceived || 0);

  const submit = () => {
    setError(null);
    if (items.length === 0) return setError("Add at least one delivery item");
    startTransition(async () => {
      try {
        await onSubmit({
          orderId,
          date,
          truckPlate: truckPlate.trim() || undefined,
          notes: notes.trim() || undefined,
          items,
          addOns,
          returns,
          paymentReceived: Number(paymentReceived || 0),
          paymentMethod,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Save failed";
        if (!msg.includes("NEXT_REDIRECT")) setError(msg);
      }
    });
  };

  return (
    <div className="space-y-3">
      <Card>
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Delivery date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Truck plate">
            <Input value={truckPlate} onChange={(e) => setTruckPlate(e.target.value)} />
          </Field>
          <Field label="Notes">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
          Bricks delivered
        </div>
        <div className="space-y-3">
          {items.map((it, i) => (
            <div key={i} className="grid grid-cols-2 lg:grid-cols-5 gap-2 items-end">
              <Field label="Size">
                <Select
                  value={it.brickSizeId}
                  onChange={(e) => setItem(i, { brickSizeId: e.target.value })}
                >
                  {sizes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Type">
                <Select
                  value={it.constructionTypeId}
                  onChange={(e) => setItem(i, { constructionTypeId: e.target.value })}
                >
                  {ctypes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Quantity">
                <Input
                  type="number"
                  value={it.quantity}
                  onChange={(e) => setItem(i, { quantity: Number(e.target.value || 0) })}
                />
              </Field>
              <Field label="₹/brick">
                <Input
                  type="number"
                  step="0.5"
                  value={it.pricePerBrick}
                  onChange={(e) => setItem(i, { pricePerBrick: Number(e.target.value || 0) })}
                />
              </Field>
              <div className="flex items-center justify-between gap-2">
                <div className="num font-bold">{formatINR(it.quantity * it.pricePerBrick)}</div>
                {items.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setItems((arr) => arr.filter((_, idx) => idx !== i))}
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
          onClick={() =>
            setItems((arr) => [
              ...arr,
              {
                brickSizeId: sizes[0]?.id ?? "",
                constructionTypeId: ctypes[0]?.id ?? "",
                quantity: 1000,
                pricePerBrick: priceMap[`${sizes[0]?.id}_${ctypes[0]?.id}`] ?? 0,
              },
            ])
          }
          className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 text-[12px] font-semibold"
        >
          <Icon.Plus size={14} /> Add row
        </button>
      </Card>

      <Card>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
          Add-on products (cement, lintel slab, loading charges, etc.)
        </div>
        {addOns.length === 0 ? (
          <div className="text-[12px] text-slate-500">No add-ons.</div>
        ) : (
          <div className="space-y-2">
            {addOns.map((a, i) => (
              <div key={i} className="grid grid-cols-2 lg:grid-cols-5 gap-2 items-end">
                <Field label="Name">
                  <Input
                    value={a.name}
                    onChange={(e) =>
                      setAddOns((arr) => arr.map((x, idx) => (idx === i ? { ...x, name: e.target.value } : x)))
                    }
                  />
                </Field>
                <Field label="Quantity">
                  <Input
                    type="number"
                    value={a.quantity}
                    onChange={(e) =>
                      setAddOns((arr) =>
                        arr.map((x, idx) =>
                          idx === i ? { ...x, quantity: Number(e.target.value || 0) } : x
                        )
                      )
                    }
                  />
                </Field>
                <Field label="Unit">
                  <Input
                    value={a.unit}
                    onChange={(e) =>
                      setAddOns((arr) => arr.map((x, idx) => (idx === i ? { ...x, unit: e.target.value } : x)))
                    }
                  />
                </Field>
                <Field label="Price/unit">
                  <Input
                    type="number"
                    value={a.pricePerUnit}
                    onChange={(e) =>
                      setAddOns((arr) =>
                        arr.map((x, idx) =>
                          idx === i ? { ...x, pricePerUnit: Number(e.target.value || 0) } : x
                        )
                      )
                    }
                  />
                </Field>
                <div className="flex items-center justify-between">
                  <div className="num font-bold">{formatINR(a.quantity * a.pricePerUnit)}</div>
                  <button
                    type="button"
                    onClick={() => setAddOns((arr) => arr.filter((_, idx) => idx !== i))}
                    className="w-8 h-8 rounded-md hover:bg-red-50 flex items-center justify-center text-red-600"
                  >
                    <Icon.Trash size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={() => setAddOns((arr) => [...arr, { name: "", quantity: 1, unit: "unit", pricePerUnit: 0 }])}
          className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 text-[12px] font-semibold"
        >
          <Icon.Plus size={14} /> Add add-on
        </button>
      </Card>

      <Card>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
          Returns from site
        </div>
        {returns.length === 0 ? (
          <div className="text-[12px] text-slate-500">No returns.</div>
        ) : (
          <div className="space-y-2">
            {returns.map((r, i) => (
              <div key={i} className="grid grid-cols-2 lg:grid-cols-4 gap-2 items-end">
                <Field label="Bricks returned">
                  <Input
                    type="number"
                    value={r.brickCount}
                    onChange={(e) =>
                      setReturns((arr) =>
                        arr.map((x, idx) =>
                          idx === i ? { ...x, brickCount: Number(e.target.value || 0) } : x
                        )
                      )
                    }
                  />
                </Field>
                <Field label="Refund amount">
                  <Input
                    type="number"
                    value={r.refundAmount}
                    onChange={(e) =>
                      setReturns((arr) =>
                        arr.map((x, idx) =>
                          idx === i ? { ...x, refundAmount: Number(e.target.value || 0) } : x
                        )
                      )
                    }
                  />
                </Field>
                <Field label="Notes">
                  <Input
                    value={r.notes ?? ""}
                    onChange={(e) =>
                      setReturns((arr) => arr.map((x, idx) => (idx === i ? { ...x, notes: e.target.value } : x)))
                    }
                  />
                </Field>
                <div className="flex items-center justify-end">
                  <button
                    type="button"
                    onClick={() => setReturns((arr) => arr.filter((_, idx) => idx !== i))}
                    className="w-8 h-8 rounded-md hover:bg-red-50 flex items-center justify-center text-red-600"
                  >
                    <Icon.Trash size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={() => setReturns((arr) => [...arr, { brickCount: 0, refundAmount: 0 }])}
          className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 text-[12px] font-semibold"
        >
          <Icon.Plus size={14} /> Add return
        </button>
      </Card>

      <Card>
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Bricks total">
            <div className="num display text-lg font-bold py-1">{formatINR(itemsTotal)}</div>
          </Field>
          <Field label="Add-ons">
            <div className="num display text-lg font-bold py-1">+{formatINR(addOnsTotal)}</div>
          </Field>
          <Field label="Returns">
            <div className="num display text-lg font-bold py-1 text-brand-red">−{formatINR(returnsTotal)}</div>
          </Field>
          <Field label="Delivery total">
            <div className="num display text-2xl font-bold py-1">{formatINR(grandTotal)}</div>
          </Field>
          {!hidePayment && (
            <>
              <Field label="Payment received now">
                <Input
                  type="number"
                  value={paymentReceived}
                  onChange={(e) =>
                    setPaymentReceived(e.target.value === "" ? "" : Number(e.target.value))
                  }
                  placeholder="0"
                />
              </Field>
              <Field label="Method">
                <Select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as Sub["paymentMethod"])}
                >
                  <option value="cash">Cash</option>
                  <option value="gpay">GPay</option>
                  <option value="upi">UPI</option>
                  <option value="bank">Bank</option>
                  <option value="cheque">Cheque</option>
                </Select>
              </Field>
            </>
          )}
        </div>
        {!hidePayment && (
          <div className="mt-2 text-[12px] text-slate-500">
            Balance after this payment:{" "}
            <span className="num font-semibold text-ink">{formatINR(balance)}</span>
          </div>
        )}
      </Card>

      {error && <div className="text-xs text-red-600">{error}</div>}

      <div className="flex justify-end">
        <Button onClick={submit} disabled={isPending} variant="primary" size="lg">
          {isPending ? "Saving…" : "Save delivery"}
        </Button>
      </div>
    </div>
  );
}
