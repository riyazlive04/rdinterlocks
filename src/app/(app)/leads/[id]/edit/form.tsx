"use client";
import { useState, useTransition } from "react";
import { Button, Card, Field, Input, Select } from "@/components/ui";
import { STAGE_ORDER, stageLabel } from "@/lib/leads";
import { updateLead } from "../../actions";

type Option = { id: string; label: string };

export type LeadFormValues = {
  customerName: string;
  phoneNumber: string;
  place: string;
  brickType: string;
  brickCount: number | null;
  constructionType: string;
  costPerBrick: number | null;
  totalBudget: number | null;
  notes: string;
  followUpDate: string;
  quotationStage: string;
  brickSizeId: string;
  constructionTypeId: string;
};

// The office correcting a machine extraction. Every field is optional here for
// the same reason it is on import: a half-captured enquiry is still worth
// keeping, and forcing a blank to be filled invites invented data.
export function EditLeadForm({
  id,
  initial,
  brickSizes,
  constructionTypes,
  phoneMasked,
}: {
  id: string;
  initial: LeadFormValues;
  brickSizes: Option[];
  constructionTypes: Option[];
  phoneMasked?: string;
}) {
  const [v, setV] = useState<LeadFormValues>(initial);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const set = <K extends keyof LeadFormValues>(k: K, val: LeadFormValues[K]) =>
    setV((prev) => ({ ...prev, [k]: val }));

  const num = (s: string): number | null => (s === "" ? null : Number(s));

  const submit = () => {
    setError(null);
    startTransition(async () => {
      try {
        await updateLead(id, {
          ...v,
          followUpDate: v.followUpDate || undefined,
          brickSizeId: v.brickSizeId || undefined,
          constructionTypeId: v.constructionTypeId || undefined,
        });
      } catch (e) {
        // A redirect from the action throws a control-flow error that must not
        // be shown as a failure.
        if (e && typeof e === "object" && "digest" in e) throw e;
        setError(e instanceof Error ? e.message : "Save failed");
      }
    });
  };

  const total = v.brickCount && v.costPerBrick ? v.brickCount * v.costPerBrick : null;

  return (
    <Card className="max-w-2xl">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Customer name">
          <Input value={v.customerName} onChange={(e) => set("customerName", e.target.value)} autoFocus />
        </Field>
        <Field
          label="Phone"
          hint={!v.phoneNumber && phoneMasked ? `Masked on record: ${phoneMasked}` : undefined}
        >
          <Input value={v.phoneNumber} onChange={(e) => set("phoneNumber", e.target.value)} />
        </Field>
        <Field label="Place">
          <Input value={v.place} onChange={(e) => set("place", e.target.value)} />
        </Field>

        <Field label="Type of bricks (as spoken)">
          <Input
            value={v.brickType}
            onChange={(e) => set("brickType", e.target.value)}
            placeholder='e.g. 6 inch'
          />
        </Field>
        <Field label="Matched brick size" hint="Links the lead to master data for conversion">
          <Select value={v.brickSizeId} onChange={(e) => set("brickSizeId", e.target.value)}>
            <option value="">Not matched</option>
            {brickSizes.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Type of construction (as spoken)">
          <Input
            value={v.constructionType}
            onChange={(e) => set("constructionType", e.target.value)}
            placeholder="e.g. compound wall"
          />
        </Field>
        <Field label="Matched construction type">
          <Select
            value={v.constructionTypeId}
            onChange={(e) => set("constructionTypeId", e.target.value)}
          >
            <option value="">Not matched</option>
            {constructionTypes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Number of bricks">
          <Input
            type="number"
            value={v.brickCount ?? ""}
            onChange={(e) => set("brickCount", num(e.target.value))}
            placeholder="Not captured"
          />
        </Field>
        <Field label="Cost per brick">
          <Input
            type="number"
            step="0.01"
            value={v.costPerBrick ?? ""}
            onChange={(e) => set("costPerBrick", num(e.target.value))}
            placeholder="Not captured"
          />
        </Field>

        <Field
          label="Total budget"
          hint={total ? `Quantity × rate = ₹${total.toLocaleString("en-IN")}` : undefined}
        >
          <Input
            type="number"
            step="0.01"
            value={v.totalBudget ?? ""}
            onChange={(e) => set("totalBudget", num(e.target.value))}
            placeholder="Not captured"
          />
        </Field>
        <Field label="Follow-up date">
          <Input
            type="date"
            value={v.followUpDate}
            onChange={(e) => set("followUpDate", e.target.value)}
          />
        </Field>

        <Field label="Quotation stage">
          <Select
            value={v.quotationStage}
            onChange={(e) => set("quotationStage", e.target.value)}
          >
            {(STAGE_ORDER as readonly string[]).includes(v.quotationStage) ? null : (
              <option value={v.quotationStage}>{stageLabel(v.quotationStage)}</option>
            )}
            {STAGE_ORDER.map((s) => (
              <option key={s} value={s}>
                {stageLabel(s)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="mt-3">
        <Field label="Notes">
          <textarea
            value={v.notes}
            onChange={(e) => set("notes", e.target.value)}
            rows={4}
            className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-slate-200 text-[14px] text-ink focus:outline-none focus:ring-2 focus:ring-brand-red/30"
          />
        </Field>
      </div>

      {error && <div className="text-xs text-red-600 mt-3">{error}</div>}
      <div className="mt-4">
        <Button onClick={submit} disabled={isPending} variant="primary" size="lg">
          {isPending ? "Saving…" : "Save lead"}
        </Button>
      </div>
    </Card>
  );
}
