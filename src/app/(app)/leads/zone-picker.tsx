"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pill, Select } from "@/components/ui";
import { setLeadZone } from "./actions";

// The delivery zone for this lead, set by the person who spoke to the
// customer and established where the site actually is.
//
// Why this control has to exist: zone pricing is the whole rate chart — ₹43
// a brick at 20km, ₹58 beyond 160km — and the schema deliberately refuses to
// infer a zone from the free-text `place`, because the zones' area lists
// overlap ("Ammapettai" and "Thoppur" each appear in two bands) and a wrong
// guess is a ₹4-6/brick error on a priced document. So a human has to say
// it, and until they can, auto-drafting skips every lead and every manual
// quotation starts from the flat matrix.
//
// Same one-field, one-click shape as OwnerPicker and StagePicker.

export function ZonePicker({
  id,
  zoneId,
  zoneName,
  zones,
  locked,
}: {
  id: string;
  zoneId: string | null;
  zoneName: string | null;
  zones: { id: string; name: string; distanceLabel: string }[];
  locked: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [current, setCurrent] = useState(zoneId ?? "");
  const [error, setError] = useState<string | null>(null);

  const selected = zones.find((z) => z.id === current);
  const selectedLabel = selected
    ? `${selected.name}${selected.distanceLabel ? ` (${selected.distanceLabel})` : ""}`
    : zoneName;

  if (locked) {
    return selectedLabel ? (
      <div className="text-[13px] font-semibold text-ink">{selectedLabel}</div>
    ) : (
      <Pill tone="slate">No zone set</Pill>
    );
  }

  const save = (next: string) => {
    const prev = current;
    setCurrent(next);
    setError(null);
    startTransition(async () => {
      try {
        await setLeadZone(id, next || null);
        router.refresh();
      } catch (e) {
        // Snap back — e.g. the zone was deactivated between load and now.
        setCurrent(prev);
        setError(e instanceof Error ? e.message : "Could not set the delivery zone");
      }
    });
  };

  return (
    <div>
      <Select
        value={current}
        disabled={isPending}
        onChange={(e) => save(e.target.value)}
        className="py-1.5 text-[13px] w-full"
      >
        <option value="">No zone set</option>
        {zones.map((z) => (
          <option key={z.id} value={z.id}>
            {z.name}
            {z.distanceLabel ? ` — ${z.distanceLabel}` : ""}
          </option>
        ))}
      </Select>
      {!current && (
        <div className="text-[11px] text-slate-500 mt-1">
          Quotations price from the flat matrix until a zone is set.
        </div>
      )}
      {error && <div className="text-[11px] text-red-600 mt-1">{error}</div>}
    </div>
  );
}
