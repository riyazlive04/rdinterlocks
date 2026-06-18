"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Input, Select } from "@/components/ui";

type Freq = "weekly" | "monthly";
type Settings = {
  factoryName: string;
  ownerName: string;
  address: string;
  phone: string;
  gstin: string;
  cementBagsPer1000: number;
  cashOpening: number;
  dryingDays: number;
  curingDays: number;
  operatorPayFreq: Freq;
  loaderPayFreq: Freq;
  masonPayFreq: Freq;
};

export function FactoryForm({
  initial,
  onSave,
}: {
  initial: Settings;
  onSave: (data: Settings) => Promise<void>;
}) {
  const router = useRouter();
  const [form, setForm] = useState<Settings>(initial);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      try {
        await onSave({
          ...form,
          cementBagsPer1000: Number(form.cementBagsPer1000),
          cashOpening: Number(form.cashOpening),
          dryingDays: Math.max(0, Math.round(Number(form.dryingDays))),
          curingDays: Math.max(0, Math.round(Number(form.curingDays))),
        });
        setSaved(true);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
      }
    });
  };

  return (
    <Card>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Factory name">
          <Input
            value={form.factoryName}
            onChange={(e) => setForm({ ...form, factoryName: e.target.value })}
          />
        </Field>
        <Field label="Owner / admin name">
          <Input
            value={form.ownerName}
            onChange={(e) => setForm({ ...form, ownerName: e.target.value })}
          />
        </Field>
        <Field label="Address">
          <Input
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
        </Field>
        <Field label="Phone">
          <Input
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
        </Field>
        <Field label="GSTIN">
          <Input
            value={form.gstin}
            onChange={(e) => setForm({ ...form, gstin: e.target.value })}
          />
        </Field>
        <Field label="Cement bags per 1000 bricks (recipe)" hint="Used to reconcile production.">
          <Input
            type="number"
            step="0.5"
            value={form.cementBagsPer1000}
            onChange={(e) =>
              setForm({ ...form, cementBagsPer1000: Number(e.target.value) })
            }
          />
        </Field>
        <Field label="Opening cash balance">
          <Input
            type="number"
            value={form.cashOpening}
            onChange={(e) => setForm({ ...form, cashOpening: Number(e.target.value) })}
          />
        </Field>
        <Field label="Drying days" hint="Days 1..N after production count as Drying.">
          <Input
            type="number"
            value={form.dryingDays}
            onChange={(e) => setForm({ ...form, dryingDays: Number(e.target.value) })}
          />
        </Field>
        <Field label="Curing days" hint="Up to this many days = Curing; after that, Ready.">
          <Input
            type="number"
            value={form.curingDays}
            onChange={(e) => setForm({ ...form, curingDays: Number(e.target.value) })}
          />
        </Field>
      </div>

      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mt-5 mb-2">
        Salary settlement frequency
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        <Field label="Operators" hint="When operator wages settle.">
          <Select
            value={form.operatorPayFreq}
            onChange={(e) => setForm({ ...form, operatorPayFreq: e.target.value as Freq })}
          >
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </Select>
        </Field>
        <Field label="Loaders">
          <Select
            value={form.loaderPayFreq}
            onChange={(e) => setForm({ ...form, loaderPayFreq: e.target.value as Freq })}
          >
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </Select>
        </Field>
        <Field label="Masons">
          <Select
            value={form.masonPayFreq}
            onChange={(e) => setForm({ ...form, masonPayFreq: e.target.value as Freq })}
          >
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </Select>
        </Field>
      </div>
      <div className="text-[11px] text-slate-400 mt-1.5">
        Employees (drivers, manager, staff) are set individually on each employee.
      </div>
      {error && <div className="text-xs text-red-600 mt-2">{error}</div>}
      {saved && <div className="text-xs text-emerald-700 mt-2">✓ Saved</div>}
      <div className="mt-4">
        <Button onClick={submit} disabled={isPending} variant="primary">
          {isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </Card>
  );
}
