"use client";
import { useState, useTransition } from "react";
import clsx from "clsx";
import { Button, Card, Field, Input, PageHeader, Select } from "@/components/ui";
import { formatISODate } from "@/lib/format";
import { createManualCashEntry } from "../actions";

export default function NewCashEntryPage() {
  const [date, setDate] = useState(formatISODate(new Date()));
  const [direction, setDirection] = useState<"in" | "out">("out");
  const [category, setCategory] = useState("Other");
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState<number | "">("");
  const [notes, setNotes] = useState("");
  const [method, setMethod] = useState<"cash" | "gpay" | "bank" | "upi" | "cheque">("cash");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    const n = Number(amount);
    if (!n || n <= 0) return setError("Enter an amount");
    if (!title.trim()) return setError("Enter a title");
    startTransition(async () => {
      try {
        await createManualCashEntry({
          date,
          amount: n,
          direction,
          category,
          title: title.trim(),
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
    <>
      <PageHeader title="New manual cash entry" back="/cash" />
      <Card className="max-w-xl">
        <div className="grid grid-cols-2 gap-1 mb-4 bg-slate-100 rounded-xl p-1">
          <button
            onClick={() => setDirection("in")}
            className={clsx(
              "py-2.5 rounded-[9px] text-[13px]",
              direction === "in"
                ? "bg-white shadow-card font-semibold text-emerald-700"
                : "font-medium text-slate-500"
            )}
          >
            Cash in
          </button>
          <button
            onClick={() => setDirection("out")}
            className={clsx(
              "py-2.5 rounded-[9px] text-[13px]",
              direction === "out"
                ? "bg-white shadow-card font-semibold text-red-700"
                : "font-medium text-slate-500"
            )}
          >
            Cash out
          </button>
        </div>
        <div className="space-y-3">
          <Field label="Date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Title">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              placeholder="e.g. Petty cash"
            />
          </Field>
          <Field label="Amount">
            <Input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value === "" ? "" : Number(e.target.value))}
            />
          </Field>
          <Field label="Category">
            <Input value={category} onChange={(e) => setCategory(e.target.value)} />
          </Field>
          <Field label="Method">
            <Select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
              <option value="cash">Cash</option>
              <option value="gpay">GPay</option>
              <option value="upi">UPI</option>
              <option value="bank">Bank</option>
              <option value="cheque">Cheque</option>
            </Select>
          </Field>
          <Field label="Notes">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        {error && <div className="text-xs text-red-600 mt-2">{error}</div>}
        <div className="mt-4">
          <Button onClick={submit} disabled={isPending} variant="primary" size="lg">
            {isPending ? "Saving…" : "Save entry"}
          </Button>
        </div>
      </Card>
    </>
  );
}
