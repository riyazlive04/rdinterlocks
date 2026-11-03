"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Input, Select } from "@/components/ui";

export type AutomationSettings = {
  quoteReviewRequired: boolean;
  quoteReviewByOwner: boolean;
  autoQuoteEnabled: boolean;
  autoQuoteOnStage: string;
  autoQuoteRequiresZone: boolean;
  leadAutoAssign: boolean;
  quoteExpiryDays: number;
  stockAllocationEnforced: boolean;
};

type StageOption = { slug: string; name: string; isActive: boolean };

/** A labelled switch with the consequence spelled out underneath it. */
function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2.5 py-2 cursor-pointer">
      <input
        type="checkbox"
        className="mt-0.5"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="flex-1 min-w-0">
        <span className="block text-[13px] font-semibold text-ink">{label}</span>
        <span className="block text-[11.5px] text-slate-500 mt-0.5">{hint}</span>
      </span>
    </label>
  );
}

export function AutomationForm({
  initial,
  stages,
  onSave,
}: {
  initial: AutomationSettings;
  stages: StageOption[];
  onSave: (data: AutomationSettings) => Promise<void>;
}) {
  const router = useRouter();
  const [form, setForm] = useState<AutomationSettings>(initial);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // The saved slug may point at a stage an admin has since renamed away. Say
  // so on screen instead of silently snapping the picker to another stage —
  // that is precisely the state in which the sweep draws a blank.
  const stageMissing =
    form.autoQuoteOnStage !== "" && !stages.some((s) => s.slug === form.autoQuoteOnStage);

  const submit = () => {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      try {
        await onSave({
          ...form,
          quoteExpiryDays: Math.max(0, Math.round(Number(form.quoteExpiryDays) || 0)),
        });
        setSaved(true);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
      }
    });
  };

  return (
    <>
      <Card className="mb-4 border-slate-200 bg-slate-50">
        <div className="text-[12.5px] text-ink leading-relaxed">
          <span className="font-semibold">Nothing on this page sends anything to a customer.</span>{" "}
          An auto-drafted quotation is a <span className="font-semibold">draft</span>: it goes to the
          review queue and a person has to approve it before it can be sent. Everything here is off
          (or set to today&apos;s behaviour) until you turn it on.
        </div>
      </Card>

      <Card className="mb-4">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
          Quotation review
        </div>
        <Toggle
          label="Require approval before a quotation can be sent"
          hint="On: a quotation must be submitted for review and approved, and the PDF is frozen at submission so the document approved is the document sent. Off: the desk sends a draft straight to the customer, as it does today."
          checked={form.quoteReviewRequired}
          onChange={(v) => setForm({ ...form, quoteReviewRequired: v })}
        />
        <Toggle
          label="Send the review to the lead's owner"
          hint="On: the person who spoke to the customer reviews their own quotation. If the lead has no owner, it falls to anyone who can review quotations. Off: it goes to whoever opens the queue."
          checked={form.quoteReviewByOwner}
          onChange={(v) => setForm({ ...form, quoteReviewByOwner: v })}
        />
      </Card>

      <Card className="mb-4">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
          Auto-draft quotations
        </div>
        <Toggle
          label="Draft a quotation automatically when a lead reaches a stage"
          hint="On: the scheduled sweep prepares a priced draft for every open lead on the stage below that has no quotation yet. The draft always waits for human approval — it is never sent automatically. Off: no quotation is ever drafted automatically; the desk creates every one by hand."
          checked={form.autoQuoteEnabled}
          onChange={(v) => setForm({ ...form, autoQuoteEnabled: v })}
        />
        {!form.autoQuoteEnabled && (
          <div className="text-[12px] text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 mt-1 mb-2">
            Auto-drafting is <span className="font-semibold">off</span>. No quotation will ever be
            drafted automatically — every quotation is created by a person.
          </div>
        )}
        <div className="grid sm:grid-cols-2 gap-3 mt-2">
          <Field
            label="Trigger stage"
            hint="The pipeline stage a lead has to reach. Only open leads with no quotation yet are drafted, and only one draft is ever made per lead."
            error={stageMissing ? "This stage no longer exists — pick one, or the sweep will do nothing." : undefined}
          >
            <Select
              value={form.autoQuoteOnStage}
              onChange={(e) => setForm({ ...form, autoQuoteOnStage: e.target.value })}
            >
              {stageMissing && (
                <option value={form.autoQuoteOnStage}>
                  {form.autoQuoteOnStage} (missing)
                </option>
              )}
              {stages.map((s) => (
                <option key={s.slug} value={s.slug}>
                  {s.name}
                  {s.isActive ? "" : " (inactive)"}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Toggle
          label="Only draft when the delivery zone is known"
          hint="On (recommended): a lead with no delivery zone set is skipped. Off: the draft is priced from the flat price matrix, which can be ₹4-6 per brick short for a far-away customer — someone has to catch that in review. The zone is never guessed from the town the caller said; it has to have been chosen."
          checked={form.autoQuoteRequiresZone}
          onChange={(v) => setForm({ ...form, autoQuoteRequiresZone: v })}
        />
        <div className="text-[11.5px] text-slate-500 mt-1">
          A lead is only drafted when it has a brick size, a construction type, a brick count and a
          configured price for that combination. Everything skipped is counted by reason in the
          sweep&apos;s output, so you can see why nothing is being drafted.
        </div>
      </Card>

      <Card className="mb-4">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
          Lead assignment
        </div>
        <Toggle
          label="Give new leads an owner automatically"
          hint="On: the sweep hands every unassigned open lead to one of the users who can see Leads, sharing them out evenly. Off: leads stay unassigned until someone picks them up — which is the state most Meta leads are in today."
          checked={form.leadAutoAssign}
          onChange={(v) => setForm({ ...form, leadAutoAssign: v })}
        />
      </Card>

      <Card className="mb-4">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
          Godown stock
        </div>
        <Toggle
          label="Refuse a delivery that takes another order's bricks"
          hint="Ready stock is one shared pool, handed down the production queue oldest-order-first. On: a delivery that would take bricks already allocated to an earlier order is refused, naming the order holding them — an owner or manager can still dispatch it anyway, and the override is written onto the delivery. Off: the shortfall is shown on the production queue but nothing is blocked. This one does NOT need the scheduled sweep."
          checked={form.stockAllocationEnforced}
          onChange={(v) => setForm({ ...form, stockAllocationEnforced: v })}
        />
      </Card>

      <Card>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
          Quotation expiry
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field
            label="Expire sent quotations after (days)"
            hint="0 = never expire. A sent quotation older than this is marked expired by the sweep, and the same number is printed as the validity date on quotations drafted automatically. Accepted and rejected quotations are never touched."
          >
            <Input
              type="number"
              value={form.quoteExpiryDays}
              onChange={(e) => setForm({ ...form, quoteExpiryDays: Number(e.target.value) || 0 })}
            />
          </Field>
        </div>
        {error && <div className="text-xs text-red-600 mt-2">{error}</div>}
        {saved && <div className="text-xs text-emerald-700 mt-2">✓ Saved</div>}
        <div className="mt-4">
          <Button onClick={submit} disabled={isPending} variant="primary">
            {isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </Card>
    </>
  );
}
