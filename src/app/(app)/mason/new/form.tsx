"use client";
import { useEffect, useState, useTransition } from "react";
import { Button, Card, Field, Input, Select } from "@/components/ui";
import { formatINR, formatISODate } from "@/lib/format";

type Sub = {
  date: string;
  masonId: string;
  siteName: string;
  brickSizeId: string;
  constructionTypeId: string;
  brickCount: number;
  ratePerBrick: number;
};

export function MasonWorkForm({
  masons,
  sizes,
  ctypes,
  priceMap,
  initial,
  submitLabel,
  onSubmit,
}: {
  masons: Array<{ id: string; name: string }>;
  sizes: Array<{ id: string; label: string }>;
  ctypes: Array<{ id: string; name: string }>;
  priceMap: Record<string, number>;
  initial?: Partial<Sub>;
  submitLabel?: string;
  onSubmit: (d: Sub) => Promise<void>;
}) {
  const isEdit = !!initial;
  const [date, setDate] = useState(initial?.date ?? formatISODate(new Date()));
  const [masonId, setMasonId] = useState(initial?.masonId ?? masons[0]?.id ?? "");
  const [siteName, setSiteName] = useState(initial?.siteName ?? "");
  const [brickSizeId, setBrickSizeId] = useState(initial?.brickSizeId ?? sizes[0]?.id ?? "");
  const [constructionTypeId, setConstructionTypeId] = useState(
    initial?.constructionTypeId ?? ctypes[0]?.id ?? ""
  );
  const [brickCount, setBrickCount] = useState<number>(initial?.brickCount ?? 1000);
  const [ratePerBrick, setRatePerBrick] = useState<number>(initial?.ratePerBrick ?? 0);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Only auto-fill the rate from the price matrix on a fresh entry; when
  // editing, preserve the saved rate unless the user changes size/type.
  useEffect(() => {
    if (isEdit) return;
    const r = priceMap[`${brickSizeId}_${constructionTypeId}`];
    if (r != null) setRatePerBrick(r);
  }, [brickSizeId, constructionTypeId, priceMap, isEdit]);

  const total = brickCount * ratePerBrick;

  const submit = () => {
    setError(null);
    if (!siteName.trim()) return setError("Enter site name");
    if (brickCount <= 0) return setError("Brick count must be more than 0");
    if (ratePerBrick <= 0) return setError("Rate must be more than 0");
    startTransition(async () => {
      try {
        await onSubmit({
          date,
          masonId,
          siteName: siteName.trim(),
          brickSizeId,
          constructionTypeId,
          brickCount,
          ratePerBrick,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Save failed";
        if (!msg.includes("NEXT_REDIRECT")) setError(msg);
      }
    });
  };

  return (
    <Card>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Mason">
          <Select value={masonId} onChange={(e) => setMasonId(e.target.value)}>
            {masons.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Site name">
          <Input
            value={siteName}
            onChange={(e) => setSiteName(e.target.value)}
            placeholder="e.g. Salem (Raja)"
            autoFocus
          />
        </Field>
        <Field label="Brick size">
          <Select value={brickSizeId} onChange={(e) => setBrickSizeId(e.target.value)}>
            {sizes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Construction type">
          <Select
            value={constructionTypeId}
            onChange={(e) => setConstructionTypeId(e.target.value)}
          >
            {ctypes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Bricks laid">
          <Input
            type="number"
            value={brickCount}
            onChange={(e) => setBrickCount(Number(e.target.value || 0))}
          />
        </Field>
        <Field label="Rate (₹/brick)" hint="Auto-filled from price matrix; you can override.">
          <Input
            type="number"
            step="0.5"
            value={ratePerBrick}
            onChange={(e) => setRatePerBrick(Number(e.target.value || 0))}
          />
        </Field>
        <Field label="Total">
          <div className="num display text-2xl font-bold py-2">{formatINR(total)}</div>
        </Field>
      </div>
      {error && <div className="text-xs text-red-600 mt-2">{error}</div>}
      <div className="mt-4">
        <Button onClick={submit} disabled={isPending} variant="primary" size="lg">
          {isPending ? "Saving…" : submitLabel ?? "Save mason work"}
        </Button>
      </div>
    </Card>
  );
}
