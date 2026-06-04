"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Select } from "@/components/ui";
import { formatISODate } from "@/lib/format";

type Sub = {
  date: string;
  employeeId: string;
  amount: number;
  notes?: string;
  method: "cash" | "gpay" | "bank" | "upi" | "cheque";
};

export function AdvanceForm({
  employeeId,
  onSubmit,
}: {
  employeeId: string;
  onSubmit: (d: Sub) => Promise<void>;
}) {
  const router = useRouter();
  const [date, setDate] = useState(formatISODate(new Date()));
  const [amount, setAmount] = useState<number | "">("");
  const [notes, setNotes] = useState("");
  const [method, setMethod] = useState<Sub["method"]>("cash");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    const n = Number(amount);
    if (!n || n <= 0) return setError("Enter an amount");
    startTransition(async () => {
      try {
        await onSubmit({ date, employeeId, amount: n, notes: notes || undefined, method });
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
      <Field label="Amount">
        <Input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value === "" ? "" : Number(e.target.value))}
        />
      </Field>
      <Field label="Method">
        <Select value={method} onChange={(e) => setMethod(e.target.value as Sub["method"])}>
          <option value="cash">Cash</option>
          <option value="gpay">GPay</option>
          <option value="upi">UPI</option>
          <option value="bank">Bank</option>
          <option value="cheque">Cheque</option>
        </Select>
      </Field>
      <Field label="Notes">
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
      </Field>
      {error && <div className="text-xs text-red-600">{error}</div>}
      <Button onClick={submit} disabled={isPending} variant="primary" className="w-full">
        {isPending ? "Saving…" : "Give advance"}
      </Button>
    </div>
  );
}
