"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button, Card, Field, Input, Select } from "@/components/ui";
import { formatISODate } from "@/lib/format";

type Sub = {
  date: string;
  tipperId: string;
  loadType: "bricks" | "material";
  brickSizeId?: string;
  materialName?: string;
  quantity: number;
  unit: string;
  fromLocation?: string;
  toLocation?: string;
  rentAmount: number;
  rentDirection: "in" | "out";
  returnBricks: number;
  notes?: string;
  method: "cash" | "gpay" | "bank" | "upi" | "cheque";
};

export function TipperForm({
  tippers,
  sizes,
  initial,
  submitLabel,
  onSubmit,
}: {
  tippers: Array<{ id: string; name: string; ownership: string; vendorName: string | null }>;
  sizes: Array<{ id: string; label: string }>;
  initial?: Partial<Sub>;
  submitLabel?: string;
  onSubmit: (d: Sub) => Promise<void>;
}) {
  const isEdit = !!initial;
  const [date, setDate] = useState(initial?.date ?? formatISODate(new Date()));
  const [tipperId, setTipperId] = useState(initial?.tipperId ?? tippers[0]?.id ?? "");
  const [loadType, setLoadType] = useState<"bricks" | "material">(initial?.loadType ?? "bricks");
  const [brickSizeId, setBrickSizeId] = useState(initial?.brickSizeId ?? sizes[0]?.id ?? "");
  const [materialName, setMaterialName] = useState(initial?.materialName ?? "");
  const [quantity, setQuantity] = useState<number>(initial?.quantity ?? 1000);
  const [unit, setUnit] = useState(initial?.unit ?? "pcs");
  const [fromLocation, setFromLocation] = useState(initial?.fromLocation ?? "Factory");
  const [toLocation, setToLocation] = useState(initial?.toLocation ?? "");
  const [rentAmount, setRentAmount] = useState<number>(initial?.rentAmount ?? 0);
  const [rentDirection, setRentDirection] = useState<"in" | "out">(initial?.rentDirection ?? "in");
  const [returnBricks, setReturnBricks] = useState<number>(initial?.returnBricks ?? 0);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [method, setMethod] = useState<Sub["method"]>(initial?.method ?? "cash");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // On an edit these two effects would clobber the saved values on mount, so
  // they skip their first run and only apply once the user changes something.
  const skipRent = useRef(isEdit);
  const skipUnit = useRef(isEdit);

  // Default rent direction by tipper ownership
  useEffect(() => {
    if (skipRent.current) {
      skipRent.current = false;
      return;
    }
    const t = tippers.find((x) => x.id === tipperId);
    if (!t) return;
    setRentDirection(t.ownership === "own" ? "in" : "out");
  }, [tipperId, tippers]);

  // Default unit when load type changes
  useEffect(() => {
    if (skipUnit.current) {
      skipUnit.current = false;
      return;
    }
    setUnit(loadType === "bricks" ? "pcs" : "unit");
  }, [loadType]);

  const submit = () => {
    setError(null);
    if (!quantity || quantity <= 0) return setError("Enter quantity");
    if (loadType === "bricks" && !brickSizeId) return setError("Pick a brick size");
    if (loadType === "material" && !materialName.trim()) return setError("Enter material name");
    if (returnBricks < 0) return setError("Return bricks can't be negative");
    startTransition(async () => {
      try {
        await onSubmit({
          date,
          tipperId,
          loadType,
          brickSizeId: loadType === "bricks" ? brickSizeId : undefined,
          materialName: loadType === "material" ? materialName.trim() : undefined,
          quantity,
          unit,
          fromLocation: fromLocation.trim() || undefined,
          toLocation: toLocation.trim() || undefined,
          rentAmount,
          rentDirection,
          returnBricks: loadType === "bricks" ? returnBricks : 0,
          notes: notes.trim() || undefined,
          method,
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
        <Field label="Tipper">
          <Select value={tipperId} onChange={(e) => setTipperId(e.target.value)}>
            {tippers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.ownership === "own" ? "RD" : t.vendorName})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Load type">
          <Select value={loadType} onChange={(e) => setLoadType(e.target.value as "bricks" | "material")}>
            <option value="bricks">Bricks</option>
            <option value="material">Raw material</option>
          </Select>
        </Field>
        {loadType === "bricks" ? (
          <Field label="Brick size">
            <Select value={brickSizeId} onChange={(e) => setBrickSizeId(e.target.value)}>
              {sizes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label="Material name">
            <Input
              value={materialName}
              onChange={(e) => setMaterialName(e.target.value)}
              placeholder="Cement, Powder, Sludge…"
            />
          </Field>
        )}
        <Field label="Quantity">
          <Input
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value || 0))}
          />
        </Field>
        <Field label="Unit">
          <Input value={unit} onChange={(e) => setUnit(e.target.value)} />
        </Field>
        {loadType === "bricks" && (
          <Field label="Return bricks (came back)">
            <Input
              type="number"
              value={returnBricks}
              onChange={(e) => setReturnBricks(Number(e.target.value || 0))}
              placeholder="0"
            />
          </Field>
        )}
        <Field label="From">
          <Input
            value={fromLocation}
            onChange={(e) => setFromLocation(e.target.value)}
            placeholder="Factory / Crusher / etc."
          />
        </Field>
        <Field label="To">
          <Input
            value={toLocation}
            onChange={(e) => setToLocation(e.target.value)}
            placeholder="Salem / Erode / Site name"
          />
        </Field>
        <Field label="Rent amount">
          <Input
            type="number"
            value={rentAmount}
            onChange={(e) => setRentAmount(Number(e.target.value || 0))}
          />
        </Field>
        <Field label="Rent direction">
          <Select
            value={rentDirection}
            onChange={(e) => setRentDirection(e.target.value as "in" | "out")}
          >
            <option value="in">We earn (cash in)</option>
            <option value="out">We pay (cash out)</option>
          </Select>
        </Field>
        <Field label="Payment method">
          <Select value={method} onChange={(e) => setMethod(e.target.value as Sub["method"])}>
            <option value="cash">Cash</option>
            <option value="gpay">GPay</option>
            <option value="upi">UPI</option>
            <option value="bank">Bank transfer</option>
            <option value="cheque">Cheque</option>
          </Select>
        </Field>
        <Field label="Notes">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
        </Field>
      </div>
      {loadType === "bricks" && returnBricks > 0 && (
        <div className="text-[11px] text-slate-500 mt-2">
          {returnBricks.toLocaleString("en-IN")} returned bricks go straight back into ready stock.
        </div>
      )}
      {error && <div className="text-xs text-red-600 mt-2">{error}</div>}
      <div className="mt-4">
        <Button onClick={submit} disabled={isPending} variant="primary" size="lg">
          {isPending ? "Saving…" : submitLabel ?? "Save load"}
        </Button>
      </div>
    </Card>
  );
}
