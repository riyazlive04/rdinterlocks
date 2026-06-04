"use client";
import { useState, useTransition } from "react";
import { Button, Card, Field, Input, Select } from "@/components/ui";
import { formatINR, formatISODate } from "@/lib/format";

type Sub = {
  date: string;
  loaderId: string;
  brickSizeId?: string;
  brickCount: number;
  ratePerBrick: number;
};

export function LoadingForm({
  loaders,
  sizes,
  onSubmit,
}: {
  loaders: Array<{ id: string; name: string }>;
  sizes: Array<{ id: string; label: string }>;
  onSubmit: (d: Sub) => Promise<void>;
}) {
  const [date, setDate] = useState(formatISODate(new Date()));
  const [loaderId, setLoaderId] = useState(loaders[0]?.id ?? "");
  const [brickSizeId, setBrickSizeId] = useState(sizes[0]?.id ?? "");
  const [brickCount, setBrickCount] = useState<number>(1000);
  const [ratePerBrick, setRatePerBrick] = useState<number>(0.5);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const total = brickCount * ratePerBrick;

  const submit = () => {
    setError(null);
    if (brickCount <= 0) return setError("Brick count must be more than 0");
    if (ratePerBrick <= 0) return setError("Rate must be more than 0");
    startTransition(async () => {
      try {
        await onSubmit({
          date,
          loaderId,
          brickSizeId: brickSizeId || undefined,
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
        <Field label="Loader">
          <Select value={loaderId} onChange={(e) => setLoaderId(e.target.value)}>
            {loaders.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Brick size (optional)">
          <Select value={brickSizeId} onChange={(e) => setBrickSizeId(e.target.value)}>
            <option value="">— mixed —</option>
            {sizes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Bricks loaded">
          <Input
            type="number"
            value={brickCount}
            onChange={(e) => setBrickCount(Number(e.target.value || 0))}
          />
        </Field>
        <Field label="Rate (₹/brick)">
          <Input
            type="number"
            step="0.1"
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
          {isPending ? "Saving…" : "Save loading entry"}
        </Button>
      </div>
    </Card>
  );
}
