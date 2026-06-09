"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Select } from "@/components/ui";
import { formatINR, formatISODate } from "@/lib/format";

type PersonType = "operator" | "mason" | "loader" | "employee";
type Method = "cash" | "gpay" | "bank" | "upi" | "cheque";

export function SettleButton({
  personType,
  personId,
  name,
  earned,
  advances,
  paid,
  openAdvances,
  onSubmit,
}: {
  personType: PersonType;
  personId: string;
  name: string;
  earned: number;
  advances: number;
  paid: number;
  openAdvances: number;
  onSubmit: (d: {
    personType: PersonType;
    personId: string;
    date: string;
    earned: number;
    advancesSettled: number;
    netPaid: number;
    method: Method;
    notes?: string;
  }) => Promise<void>;
}) {
  const suggestedNet = Math.max(0, earned - advances - paid);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(formatISODate(new Date()));
  const [deduct, setDeduct] = useState<number>(openAdvances);
  const [net, setNet] = useState<number>(suggestedNet);
  const [method, setMethod] = useState<Method>("cash");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    if (net < 0 || deduct < 0) return setError("Amounts can't be negative");
    if (net === 0 && deduct === 0) return setError("Nothing to settle");
    startTransition(async () => {
      try {
        await onSubmit({
          personType,
          personId,
          date,
          earned,
          advancesSettled: deduct,
          netPaid: net,
          method,
          notes: notes || undefined,
        });
        setOpen(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed");
      }
    });
  };
  const router = useRouter();

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="px-2.5 py-1.5 rounded-lg bg-ink text-white text-[11px] font-semibold hover:bg-ink/90"
      >
        Settle
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-cardLg w-full max-w-[400px] p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-base font-bold text-ink">Settle {name}</div>
            <div className="grid grid-cols-3 gap-2 my-3 text-center">
              <Mini label="Earned" value={formatINR(earned)} />
              <Mini label="Advances" value={formatINR(advances)} tone="amber" />
              <Mini label="Already paid" value={formatINR(paid)} tone="emerald" />
            </div>

            <div className="space-y-2.5">
              <Field label="Deduct advance" hint={`Open: ${formatINR(openAdvances)}`}>
                <Input
                  type="number"
                  value={deduct}
                  onChange={(e) => setDeduct(e.target.value === "" ? 0 : Number(e.target.value))}
                />
              </Field>
              <Field label="Net pay now (cash out)">
                <Input
                  type="number"
                  value={net}
                  onChange={(e) => setNet(e.target.value === "" ? 0 : Number(e.target.value))}
                />
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
              <Field label="Notes">
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
              </Field>
            </div>

            {error && <div className="text-xs text-red-600 mt-2">{error}</div>}
            <div className="flex gap-2 mt-4">
              <Button onClick={submit} disabled={isPending} variant="primary" className="flex-1">
                {isPending ? "Saving…" : `Pay ${formatINR(net)} & settle`}
              </Button>
              <Button onClick={() => setOpen(false)} variant="ghost">
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Mini({ label, value, tone }: { label: string; value: string; tone?: "amber" | "emerald" }) {
  return (
    <div className="rounded-lg bg-slate-50 py-2">
      <div className="text-[9px] uppercase tracking-wider text-slate-500 font-semibold">{label}</div>
      <div
        className={`num text-[13px] font-bold mt-0.5 ${
          tone === "amber" ? "text-amber-700" : tone === "emerald" ? "text-emerald-700" : "text-ink"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
