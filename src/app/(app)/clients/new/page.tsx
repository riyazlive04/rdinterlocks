"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Input, Select, PageHeader } from "@/components/ui";
import { formatINR, formatISODate } from "@/lib/format";
import { createClientWithAdvance } from "../actions";

type Method = "cash" | "gpay" | "bank" | "upi" | "cheque";

export default function NewClientPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [advance, setAdvance] = useState<number | "">("");
  const [advanceMethod, setAdvanceMethod] = useState<Method>("cash");
  const [advanceDate, setAdvanceDate] = useState(formatISODate(new Date()));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    if (!name.trim()) return setError("Name is required");
    startTransition(async () => {
      try {
        const c = await createClientWithAdvance({
          name: name.trim(),
          location: location.trim() || undefined,
          phone: phone.trim() || undefined,
          notes: notes.trim() || undefined,
          advance: Number(advance || 0),
          advanceMethod,
          advanceDate,
        });
        router.push(`/clients/${c.id}`);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
      }
    });
  };

  return (
    <>
      <PageHeader title="Add client" back="/clients" />
      <Card className="max-w-xl">
        <div className="space-y-3">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Raja" />
          </Field>
          <Field label="Location">
            <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Salem" />
          </Field>
          <Field label="Phone">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit mobile" />
          </Field>
          <Field label="Notes">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </Field>

          <div className="pt-2 border-t border-slate-100">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
              Opening advance (optional)
            </div>
            <div className="grid sm:grid-cols-3 gap-3">
              <Field label="Advance paid">
                <Input
                  type="number"
                  value={advance}
                  onChange={(e) => setAdvance(e.target.value === "" ? "" : Number(e.target.value))}
                  placeholder="0"
                />
              </Field>
              <Field label="Method">
                <Select value={advanceMethod} onChange={(e) => setAdvanceMethod(e.target.value as Method)}>
                  <option value="cash">Cash</option>
                  <option value="gpay">GPay</option>
                  <option value="upi">UPI</option>
                  <option value="bank">Bank</option>
                  <option value="cheque">Cheque</option>
                </Select>
              </Field>
              <Field label="Date">
                <Input type="date" value={advanceDate} onChange={(e) => setAdvanceDate(e.target.value)} />
              </Field>
            </div>
            {Number(advance || 0) > 0 && (
              <div className="mt-2 text-[12px] text-slate-500">
                Recorded as cash-in credit for this client:{" "}
                <span className="num font-semibold text-emerald-700">
                  {formatINR(Number(advance || 0))}
                </span>
              </div>
            )}
          </div>

          {error && <div className="text-xs text-red-600">{error}</div>}
          <Button onClick={submit} disabled={isPending} variant="primary" size="lg">
            {isPending ? "Saving…" : "Add client"}
          </Button>
        </div>
      </Card>
    </>
  );
}
