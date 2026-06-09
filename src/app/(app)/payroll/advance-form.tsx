"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Input, Select } from "@/components/ui";
import { Icon } from "@/components/icons";
import { formatISODate } from "@/lib/format";

type PersonType = "operator" | "mason" | "loader" | "employee";
type Method = "cash" | "gpay" | "bank" | "upi" | "cheque";
type Group = { type: PersonType; label: string; people: { id: string; name: string }[] };

export function PayrollAdvanceForm({
  groups,
  onSubmit,
}: {
  groups: Group[];
  onSubmit: (d: {
    personType: PersonType;
    personId: string;
    date: string;
    amount: number;
    method: Method;
    notes?: string;
  }) => Promise<void>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(""); // "type:id"
  const [date, setDate] = useState(formatISODate(new Date()));
  const [amount, setAmount] = useState<number | "">("");
  const [method, setMethod] = useState<Method>("cash");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const reset = () => {
    setSel("");
    setAmount("");
    setNotes("");
    setMethod("cash");
    setError(null);
  };

  const submit = () => {
    setError(null);
    if (!sel) return setError("Choose a worker");
    const n = Number(amount);
    if (!n || n <= 0) return setError("Enter an amount");
    const [personType, personId] = sel.split(":") as [PersonType, string];
    startTransition(async () => {
      try {
        await onSubmit({ personType, personId, date, amount: n, method, notes: notes || undefined });
        reset();
        setOpen(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
      }
    });
  };

  if (!open) {
    return (
      <div className="flex justify-end mb-4">
        <Button onClick={() => setOpen(true)} variant="primary" size="sm">
          <Icon.Plus size={14} stroke={2.4} /> Record advance
        </Button>
      </div>
    );
  }

  return (
    <Card className="mb-4 border-2 border-brand-red/30">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-3">
        Record advance — any worker
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Worker">
          <Select value={sel} onChange={(e) => setSel(e.target.value)} autoFocus>
            <option value="">Select a person…</option>
            {groups.map((g) =>
              g.people.length === 0 ? null : (
                <optgroup key={g.type} label={g.label}>
                  {g.people.map((p) => (
                    <option key={`${g.type}:${p.id}`} value={`${g.type}:${p.id}`}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              )
            )}
          </Select>
        </Field>
        <Field label="Amount">
          <Input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value === "" ? "" : Number(e.target.value))}
            placeholder="₹"
          />
        </Field>
        <Field label="Date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Method">
          <Select value={method} onChange={(e) => setMethod(e.target.value as Method)}>
            <option value="cash">Cash</option>
            <option value="gpay">GPay</option>
            <option value="upi">UPI</option>
            <option value="bank">Bank</option>
            <option value="cheque">Cheque</option>
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Notes">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </Field>
        </div>
      </div>
      {error && <div className="text-xs text-red-600 mt-3">{error}</div>}
      <div className="flex gap-2 mt-4">
        <Button onClick={submit} disabled={isPending} variant="primary">
          {isPending ? "Saving…" : "Give advance"}
        </Button>
        <Button
          onClick={() => {
            reset();
            setOpen(false);
          }}
          variant="ghost"
        >
          Cancel
        </Button>
      </div>
    </Card>
  );
}
