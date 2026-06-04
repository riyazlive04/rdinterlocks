"use client";
import { useEffect, useState, useTransition } from "react";
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
  notes?: string;
  method: "cash" | "gpay" | "bank" | "upi" | "cheque";
};

export function TipperForm({
  tippers,
  sizes,
  onSubmit,
}: {
  tippers: Array<{ id: string; name: string; ownership: string; vendorName: string | null }>;
  sizes: Array<{ id: string; label: string }>;
  onSubmit: (d: Sub) => Promise<void>;
}) {
  const [date, setDate] = useState(formatISODate(new Date()));
  const [tipperId, setTipperId] = useState(tippers[0]?.id ?? "");
  const [loadType, setLoadType] = useState<"bricks" | "material">("bricks");
  const [brickSizeId, setBrickSizeId] = useState(sizes[0]?.id ?? "");
  const [materialName, setMaterialName] = useState("");
  const [quantity, setQuantity] = useState<number>(1000);
  const [unit, setUnit] = useState("pcs");
  const [fromLocation, setFromLocation] = useState("Factory");
  const [toLocation, setToLocation] = useState("");
  const [rentAmount, setRentAmount] = useState<number>(0);
  const [rentDirection, setRentDirection] = useState<"in" | "out">("in");
  const [notes, setNotes] = useState("");
  const [method, setMethod] = useState<Sub["method"]>("cash");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Default rent direction by tipper ownership
  useEffect(() => {
    const t = tippers.find((x) => x.id === tipperId);
    if (!t) return;
    setRentDirection(t.ownership === "own" ? "in" : "out");
  }, [tipperId, tippers]);

  // Default unit when load type changes
  useEffect(() => {
    setUnit(loadType === "bricks" ? "pcs" : "unit");
  }, [loadType]);

  const submit = () => {
    setError(null);
    if (!quantity || quantity <= 0) return setError("Enter quantity");
    if (loadType === "bricks" && !brickSizeId) return setError("Pick a brick size");
    if (loadType === "material" && !materialName.trim()) return setError("Enter material name");
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
      {error && <div className="text-xs text-red-600 mt-2">{error}</div>}
      <div className="mt-4">
        <Button onClick={submit} disabled={isPending} variant="primary" size="lg">
          {isPending ? "Saving…" : "Save load"}
        </Button>
      </div>
    </Card>
  );
}
