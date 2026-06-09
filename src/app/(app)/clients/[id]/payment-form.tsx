"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Select } from "@/components/ui";
import { formatISODate } from "@/lib/format";

type Sub = {
  clientId: string;
  orderId?: string;
  date: string;
  amount: number;
  method: "cash" | "gpay" | "bank" | "upi" | "cheque";
  notes?: string;
};

export function PaymentForm({
  clientId,
  orders,
  onSubmit,
}: {
  clientId: string;
  orders: Array<{ id: string; label: string }>;
  onSubmit: (d: Sub) => Promise<void>;
}) {
  const router = useRouter();
  const [date, setDate] = useState(formatISODate(new Date()));
  const [orderId, setOrderId] = useState(orders[0]?.id ?? "");
  const [amount, setAmount] = useState<number | "">("");
  const [method, setMethod] = useState<Sub["method"]>("cash");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    const n = Number(amount);
    if (!n || n <= 0) return setError("Enter an amount");
    startTransition(async () => {
      try {
        await onSubmit({
          clientId,
          orderId: orderId || undefined,
          date,
          amount: n,
          method,
          notes: notes.trim() || undefined,
        });
        setAmount("");
        setNotes("");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
      }
    });
  };

  return (
    <div className="space-y-2.5">
      <Field label="Date">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      {orders.length > 0 && (
        <Field label="Against order (optional)">
          <Select value={orderId} onChange={(e) => setOrderId(e.target.value)}>
            <option value="">- general -</option>
            {orders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="Amount">
        <Input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value === "" ? "" : Number(e.target.value))}
          placeholder="0"
        />
      </Field>
      <Field label="Method">
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
      {error && <div className="text-xs text-red-600">{error}</div>}
      <Button onClick={submit} disabled={isPending} variant="primary" className="w-full">
        {isPending ? "Saving…" : "Record payment"}
      </Button>
    </div>
  );
}
