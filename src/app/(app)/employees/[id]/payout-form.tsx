"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Select } from "@/components/ui";
import { formatINR, formatISODate } from "@/lib/format";

type Sub = {
  employeeId: string;
  date: string;
  periodStart: string;
  periodEnd: string;
  baseAmount: number;
  bonus: number;
  deductions: number;
  advancesSettled: number;
  notes?: string;
  method: "cash" | "gpay" | "bank" | "upi" | "cheque";
};

export function PayoutForm({
  employeeId,
  defaultBase,
  defaultPeriodStart,
  defaultPeriodEnd,
  defaultAdvanceTotal,
  onSubmit,
}: {
  employeeId: string;
  defaultBase: number;
  defaultPeriodStart: string;
  defaultPeriodEnd: string;
  defaultAdvanceTotal: number;
  onSubmit: (d: Sub) => Promise<void>;
}) {
  const router = useRouter();
  const [date, setDate] = useState(formatISODate(new Date()));
  const [periodStart, setPeriodStart] = useState(defaultPeriodStart);
  const [periodEnd, setPeriodEnd] = useState(defaultPeriodEnd);
  const [baseAmount, setBaseAmount] = useState<number>(defaultBase);
  const [bonus, setBonus] = useState<number>(0);
  const [deductions, setDeductions] = useState<number>(0);
  const [advancesSettled, setAdvancesSettled] = useState<number>(defaultAdvanceTotal);
  const [method, setMethod] = useState<Sub["method"]>("cash");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const net = baseAmount + bonus - deductions - advancesSettled;

  const submit = () => {
    setError(null);
    if (baseAmount <= 0) return setError("Base amount must be more than 0");
    startTransition(async () => {
      try {
        await onSubmit({
          employeeId,
          date,
          periodStart,
          periodEnd,
          baseAmount,
          bonus,
          deductions,
          advancesSettled,
          notes: notes || undefined,
          method,
        });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
      }
    });
  };

  return (
    <div className="grid sm:grid-cols-2 gap-3">
      <Field label="Pay date">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
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
      <Field label="Period start">
        <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
      </Field>
      <Field label="Period end">
        <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
      </Field>
      <Field label="Base amount">
        <Input
          type="number"
          value={baseAmount}
          onChange={(e) => setBaseAmount(Number(e.target.value || 0))}
        />
      </Field>
      <Field label="Bonus">
        <Input
          type="number"
          value={bonus}
          onChange={(e) => setBonus(Number(e.target.value || 0))}
        />
      </Field>
      <Field label="Deductions">
        <Input
          type="number"
          value={deductions}
          onChange={(e) => setDeductions(Number(e.target.value || 0))}
        />
      </Field>
      <Field label="Advances settled">
        <Input
          type="number"
          value={advancesSettled}
          onChange={(e) => setAdvancesSettled(Number(e.target.value || 0))}
        />
      </Field>
      <Field label="Notes">
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
      </Field>
      <Field label="Net payout">
        <div className="num display text-2xl font-bold py-1.5 text-emerald-700">
          {formatINR(Math.max(0, net))}
        </div>
      </Field>
      {error && <div className="col-span-2 text-xs text-red-600">{error}</div>}
      <div className="col-span-2 flex justify-end">
        <Button onClick={submit} disabled={isPending} variant="primary">
          {isPending ? "Saving…" : "Record payout"}
        </Button>
      </div>
    </div>
  );
}
