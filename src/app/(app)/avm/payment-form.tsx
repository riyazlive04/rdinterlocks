"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Input, Select } from "@/components/ui";
import { Icon } from "@/components/icons";
import { formatISODate } from "@/lib/format";

type Option = { id: string; label: string };
type Method = "cash" | "gpay" | "bank" | "upi" | "cheque";

export function VendorPaymentForm({
  vendors,
  tippers,
  defaultVendorId,
  onSubmit,
}: {
  vendors: Option[];
  tippers: Array<Option & { vendorId: string | null }>;
  defaultVendorId?: string;
  onSubmit: (d: {
    vendorId: string;
    tipperId?: string;
    date: string;
    kind: "advance" | "rent";
    amount: number;
    method: Method;
    notes?: string;
  }) => Promise<void>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [vendorId, setVendorId] = useState(defaultVendorId ?? vendors[0]?.id ?? "");
  const [tipperId, setTipperId] = useState("");
  const [date, setDate] = useState(formatISODate(new Date()));
  const [kind, setKind] = useState<"advance" | "rent">("advance");
  const [amount, setAmount] = useState<number>(0);
  const [method, setMethod] = useState<Method>("cash");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const vendorTippers = tippers.filter((t) => !t.vendorId || t.vendorId === vendorId);

  const save = () => {
    setError(null);
    if (!vendorId) return setError("Pick the vendor");
    if (!amount || amount <= 0) return setError("Enter an amount");
    startTransition(async () => {
      try {
        await onSubmit({
          vendorId,
          tipperId: tipperId || undefined,
          date,
          kind,
          amount,
          method,
          notes: notes.trim() || undefined,
        });
        setAmount(0);
        setNotes("");
        setOpen(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save the payment");
      }
    });
  };

  if (!open) {
    return (
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)} variant="primary">
          <Icon.Plus size={15} stroke={2.4} /> Record payment
        </Button>
      </div>
    );
  }

  return (
    <Card className="border-2 border-brand-red/30">
      <div className="flex gap-1.5 mb-3">
        {(["advance", "rent"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`flex-1 px-3 py-2 rounded-lg text-[12px] font-semibold transition ${
              kind === k ? "bg-ink text-white" : "bg-white text-slate-700 border border-slate-200"
            }`}
          >
            {k === "advance" ? "Advance paid" : "Rent balance (tipper due)"}
          </button>
        ))}
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        <Field label="Vendor">
          <Select
            value={vendorId}
            onChange={(e) => {
              setVendorId(e.target.value);
              setTipperId("");
            }}
          >
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Amount ₹">
          <Input
            type="number"
            value={amount || ""}
            onChange={(e) => setAmount(Number(e.target.value || 0))}
            autoFocus
          />
        </Field>
        <Field label="Tipper (optional)">
          <Select value={tipperId} onChange={(e) => setTipperId(e.target.value)}>
            <option value="">- any -</option>
            {vendorTippers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Paid by">
          <Select value={method} onChange={(e) => setMethod(e.target.value as Method)}>
            <option value="cash">Cash</option>
            <option value="gpay">GPay</option>
            <option value="upi">UPI</option>
            <option value="bank">Bank</option>
            <option value="cheque">Cheque</option>
          </Select>
        </Field>
        <Field label="Note (optional)">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
      {error && <div className="text-xs text-red-600 mt-2">{error}</div>}
      <div className="flex gap-2 mt-3">
        <Button onClick={save} disabled={isPending} variant="primary">
          {isPending ? "Saving…" : "Save payment"}
        </Button>
        <Button onClick={() => setOpen(false)} variant="ghost">
          Cancel
        </Button>
      </div>
    </Card>
  );
}
