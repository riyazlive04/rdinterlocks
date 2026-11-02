"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { Icon } from "@/components/icons";

export type RecordPaymentValues = {
  amount: number;
  method: "cash" | "gpay" | "bank" | "upi" | "cheque";
  reference: string;
  paidAt: string;
  notes: string;
};

/**
 * Record what the customer paid against a quotation. Lives in the payments
 * folder rather than next to the quotation page because the whole payment
 * flow — this form and the manager's queue — is one feature, and both ends
 * have to agree on the shape of this input.
 *
 * Follows QuotationControls' pattern: the server action arrives as a prop,
 * useTransition drives the pending state, and the error is shown inline
 * rather than thrown at the user as a crashed page.
 */
export function RecordPaymentForm({
  quotationId,
  /** "yyyy-mm-dd" for today, formatted on the server. */
  defaultPaidAt,
  /** Pre-filled with the outstanding balance, so the common case is one click. */
  suggestedAmount,
  onRecord,
}: {
  quotationId: string;
  defaultPaidAt: string;
  suggestedAmount: number;
  onRecord: (quotationId: string, input: RecordPaymentValues) => Promise<void>;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState(suggestedAmount > 0 ? String(suggestedAmount) : "");
  const [method, setMethod] = useState<RecordPaymentValues["method"]>("cash");
  const [reference, setReference] = useState("");
  const [paidAt, setPaidAt] = useState(defaultPaidAt);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const parsed = Number(amount);
  const valid = Number.isFinite(parsed) && parsed > 0;

  const submit = () => {
    if (!valid) {
      setError("Enter the amount the customer paid.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await onRecord(quotationId, { amount: parsed, method, reference, paidAt, notes });
        setAmount("");
        setReference("");
        setNotes("");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not record the payment");
      }
    });
  };

  return (
    <div className="space-y-2.5">
      <div className="grid sm:grid-cols-2 gap-2.5">
        <Field label="Amount received">
          <Input
            type="number"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
          />
        </Field>
        <Field label="Method">
          <Select value={method} onChange={(e) => setMethod(e.target.value as RecordPaymentValues["method"])}>
            <option value="cash">Cash</option>
            <option value="gpay">GPay</option>
            <option value="upi">UPI</option>
            <option value="bank">Bank transfer</option>
            <option value="cheque">Cheque</option>
          </Select>
        </Field>
        <Field label="Reference" hint="UTR, cheque number or screenshot ref">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" />
        </Field>
        <Field label="Paid on">
          <Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
        </Field>
      </div>
      <Field label="Notes">
        <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
      </Field>
      <Button onClick={submit} disabled={isPending || !valid} variant="primary" className="w-full">
        <Icon.Check size={15} /> Record payment for approval
      </Button>
      <div className="text-[11px] text-slate-500">
        This is sent to a manager for approval. The order is created when they approve it — not now.
      </div>
      {error && <div className="text-[11px] text-red-600">{error}</div>}
    </div>
  );
}
