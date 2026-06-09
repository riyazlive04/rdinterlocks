"use client";
import { useState, useTransition } from "react";
import { Button, Card, Field, Input, Select } from "@/components/ui";
import { formatISODate } from "@/lib/format";

type Sub = {
  date: string;
  categoryId: string;
  title: string;
  amount: number;
  notes?: string;
  vendorId?: string;
  tipperId?: string;
  method: "cash" | "gpay" | "bank" | "upi" | "cheque";
};

export function ExpenseForm({
  categories,
  vendors,
  tippers,
  initial,
  onSubmit,
}: {
  categories: Array<{ id: string; name: string }>;
  vendors: Array<{ id: string; name: string }>;
  tippers: Array<{ id: string; name: string }>;
  initial?: {
    categoryId?: string;
    title?: string;
    amount?: number;
    tipperId?: string;
    notes?: string;
  };
  onSubmit: (d: Sub) => Promise<void>;
}) {
  const [date, setDate] = useState(formatISODate(new Date()));
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? categories[0]?.id ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [amount, setAmount] = useState<number | "">(initial?.amount ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [vendorId, setVendorId] = useState("");
  const [tipperId, setTipperId] = useState(initial?.tipperId ?? "");
  const [method, setMethod] = useState<"cash" | "gpay" | "bank" | "upi" | "cheque">("cash");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    if (!title.trim()) return setError("Enter a title");
    const n = Number(amount);
    if (!n || n <= 0) return setError("Enter a positive amount");
    startTransition(async () => {
      try {
        await onSubmit({
          date,
          categoryId,
          title: title.trim(),
          amount: n,
          notes: notes.trim() || undefined,
          vendorId: vendorId || undefined,
          tipperId: tipperId || undefined,
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
        <Field label="Category">
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Title">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Cement - 25 bags"
            autoFocus
          />
        </Field>
        <Field label="Amount">
          <Input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value === "" ? "" : Number(e.target.value))}
            placeholder="0"
          />
        </Field>
        <Field label="Vendor (optional)">
          <Select value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
            <option value="">- none -</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Tipper (if vehicle expense)">
          <Select value={tipperId} onChange={(e) => setTipperId(e.target.value)}>
            <option value="">- none -</option>
            {tippers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Payment method">
          <Select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
            <option value="cash">Cash</option>
            <option value="gpay">GPay</option>
            <option value="upi">UPI</option>
            <option value="bank">Bank transfer</option>
            <option value="cheque">Cheque</option>
          </Select>
        </Field>
        <Field label="Notes (optional)">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. ₹340/bag" />
        </Field>
      </div>
      {error && <div className="text-xs text-red-600 mt-2">{error}</div>}
      <div className="mt-4">
        <Button onClick={submit} disabled={isPending} variant="primary" size="lg">
          {isPending ? "Saving…" : "Save expense"}
        </Button>
      </div>
    </Card>
  );
}
