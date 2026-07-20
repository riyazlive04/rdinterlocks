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

type SlabItem = {
  slabSizeId: string;
  quantity: number;
  pricePerSlab: number;
};

type Sub = {
  clientId: string;
  date: string;
  expectedDeliveryDate?: string;
  notes?: string;
  items: Item[];
  slabItems: SlabItem[];
  advance: number;
  advanceMethod: "cash" | "gpay" | "bank" | "upi" | "cheque";
};

export function OrderForm({
  clientId,
  sizes,
  ctypes,
  slabSizes,
  priceMap,
  initial,
  submitLabel,
  hideAdvance,
  onSubmit,
}: {
  clientId: string;
  sizes: Array<{ id: string; label: string }>;
  ctypes: Array<{ id: string; name: string }>;
  slabSizes: Array<{ id: string; label: string }>;
  priceMap: Record<string, number>;
  initial?: Partial<Sub>;
  submitLabel?: string;
  hideAdvance?: boolean;
  onSubmit: (d: Sub) => Promise<void>;
}) {
  const [date, setDate] = useState(initial?.date ?? formatISODate(new Date()));
  const [expected, setExpected] = useState(initial?.expectedDeliveryDate ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [items, setItems] = useState<Item[]>(
    initial?.items && initial.items.length > 0
      ? initial.items
      : [
          {
            brickSizeId: sizes[0]?.id ?? "",
            constructionTypeId: ctypes[0]?.id ?? "",
            quantity: 1000,
            pricePerBrick: priceMap[`${sizes[0]?.id}_${ctypes[0]?.id}`] ?? 0,
          },
        ]
  );
  const [slabItems, setSlabItems] = useState<SlabItem[]>(initial?.slabItems ?? []);
  const [advance, setAdvance] = useState<number | "">("");
  const [advanceMethod, setAdvanceMethod] = useState<Sub["advanceMethod"]>("cash");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const setItem = (i: number, patch: Partial<Item>) => {
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
  };

  const addItem = () => {
    setItems((arr) => [
      ...arr,
      {
        brickSizeId: sizes[0]?.id ?? "",
        constructionTypeId: ctypes[0]?.id ?? "",
        quantity: 1000,
        pricePerBrick: priceMap[`${sizes[0]?.id}_${ctypes[0]?.id}`] ?? 0,
      },
    ]);
  };

  const removeItem = (i: number) => {
    setItems((arr) => arr.filter((_, idx) => idx !== i));
  };

  const setSlab = (i: number, patch: Partial<SlabItem>) => {
    setSlabItems((arr) => {
      const next = arr.slice();
      next[i] = { ...next[i], ...patch };
      return next;
    });
  };

  const addSlab = () => {
    setSlabItems((arr) => [
      ...arr,
      { slabSizeId: slabSizes[0]?.id ?? "", quantity: 1, pricePerSlab: 0 },
    ]);
  };

  const removeSlab = (i: number) => {
    setSlabItems((arr) => arr.filter((_, idx) => idx !== i));
  };

  const bricksTotal = items.reduce((s, it) => s + it.quantity * it.pricePerBrick, 0);
  const slabsTotal = slabItems.reduce((s, it) => s + it.quantity * it.pricePerSlab, 0);
  const total = bricksTotal + slabsTotal;
  const balance = total - Number(advance || 0);

  const submit = () => {
    setError(null);
    if (items.length === 0 && slabItems.length === 0)
      return setError("Add at least one brick or slab item");
    for (const it of items) {
      if (!it.brickSizeId || !it.constructionTypeId) return setError("Pick size + type for all brick items");
      if (it.quantity <= 0) return setError("Brick quantity must be > 0");
      if (it.pricePerBrick <= 0) return setError("Brick price must be > 0");
    }
    for (const it of slabItems) {
      if (!it.slabSizeId) return setError("Pick a size for all slab items");
      if (it.quantity <= 0) return setError("Slab count must be > 0");
      if (it.pricePerSlab < 0) return setError("Slab price can't be negative");
    }
    startTransition(async () => {
      try {
        await onSubmit({
          clientId,
          date,
          expectedDeliveryDate: expected || undefined,
          notes: notes.trim() || undefined,
          items,
          slabItems,
          advance: Number(advance || 0),
          advanceMethod,
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
          <Field label="Order date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Expected delivery">
            <Input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} />
          </Field>
          <Field label="Notes">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </Field>
        </div>
      </Card>

      <Card>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
          Bricks
        </div>
        {items.length === 0 ? (
          <div className="text-[12px] text-slate-400 mb-1">No brick items - add one below or use lintel slabs only.</div>
        ) : (
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
                  <div className="num font-bold text-ink">
                    {formatINR(it.quantity * it.pricePerBrick)}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeItem(i)}
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
          onClick={addItem}
          className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 text-[12px] font-semibold"
        >
          <Icon.Plus size={14} /> Add brick item
        </button>
      </Card>

      <Card>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
          Lintel slabs
        </div>
        {slabItems.length === 0 ? (
          <div className="text-[12px] text-slate-400 mb-1">No lintel slabs on this order.</div>
        ) : (
          <div className="space-y-3">
            {slabItems.map((it, i) => (
              <div key={i} className="grid grid-cols-2 lg:grid-cols-4 gap-2 items-end">
                <Field label="Size">
                  <Select
                    value={it.slabSizeId}
                    onChange={(e) => setSlab(i, { slabSizeId: e.target.value })}
                  >
                    {slabSizes.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="No. of slabs">
                  <Input
                    type="number"
                    value={it.quantity}
                    onChange={(e) => setSlab(i, { quantity: Number(e.target.value || 0) })}
                  />
                </Field>
                <Field label="₹/slab (optional)">
                  <Input
                    type="number"
                    step="1"
                    value={it.pricePerSlab}
                    onChange={(e) => setSlab(i, { pricePerSlab: Number(e.target.value || 0) })}
                  />
                </Field>
                <div className="flex items-center justify-between gap-2">
                  <div className="num font-bold text-ink">
                    {formatINR(it.quantity * it.pricePerSlab)}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeSlab(i)}
                    className="w-8 h-8 rounded-md hover:bg-red-50 flex items-center justify-center text-red-600"
                  >
                    <Icon.Trash size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {slabSizes.length === 0 ? (
          <div className="mt-2 text-[12px] text-slate-500">
            Add lintel slab sizes in Settings → Lintel slab sizes first.
          </div>
        ) : (
          <button
            type="button"
            onClick={addSlab}
            className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 text-[12px] font-semibold"
          >
            <Icon.Plus size={14} /> Add lintel slab
          </button>
        )}
      </Card>

      {hideAdvance ? (
        <Card>
          <Field label="Order total">
            <div className="num display text-2xl font-bold py-1.5">{formatINR(total)}</div>
          </Field>
        </Card>
      ) : (
        <Card>
          <div className="grid sm:grid-cols-3 gap-3">
            <Field label="Order total">
              <div className="num display text-2xl font-bold py-1.5">{formatINR(total)}</div>
            </Field>
            <Field label="Advance now">
              <Input
                type="number"
                value={advance}
                onChange={(e) => setAdvance(e.target.value === "" ? "" : Number(e.target.value))}
                placeholder="0"
              />
            </Field>
            <Field label="Method">
              <Select
                value={advanceMethod}
                onChange={(e) => setAdvanceMethod(e.target.value as Sub["advanceMethod"])}
              >
                <option value="cash">Cash</option>
                <option value="gpay">GPay</option>
                <option value="upi">UPI</option>
                <option value="bank">Bank</option>
                <option value="cheque">Cheque</option>
              </Select>
            </Field>
          </div>
          <div className="mt-2 text-[12px] text-slate-500">
            Balance after advance:{" "}
            <span className="num font-semibold text-ink">{formatINR(balance)}</span>
          </div>
        </Card>
      )}

      {error && <div className="text-xs text-red-600">{error}</div>}

      <div className="flex justify-end">
        <Button onClick={submit} disabled={isPending} variant="primary" size="lg">
          {isPending ? "Saving…" : submitLabel ?? "Save order"}
        </Button>
      </div>
    </div>
  );
}
