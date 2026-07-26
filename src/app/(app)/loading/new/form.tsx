"use client";
import { useState, useTransition } from "react";
import clsx from "clsx";
import { Button, Card, Field, Input, Select } from "@/components/ui";
import { formatINR, formatISODate } from "@/lib/format";

type WorkerType = "loader" | "operator" | "employee";
type LoadType = "brick" | "lintel";

type Sub = {
  date: string;
  loadType: LoadType;
  workerType: WorkerType;
  workerId: string;
  brickSizeId?: string;
  brickCount: number;
  ratePerBrick: number;
};

export type WorkerOption = { type: WorkerType; id: string; name: string };

export function LoadingForm({
  workers,
  sizes,
  initial,
  submitLabel,
  onSubmit,
}: {
  workers: { loaders: WorkerOption[]; operators: WorkerOption[]; employees: WorkerOption[] };
  sizes: Array<{ id: string; label: string }>;
  initial?: Partial<Sub>;
  submitLabel?: string;
  onSubmit: (d: Sub) => Promise<void>;
}) {
  const all = [...workers.loaders, ...workers.operators, ...workers.employees];
  const initialWorker =
    initial?.workerType && initial?.workerId
      ? `${initial.workerType}:${initial.workerId}`
      : all[0]
        ? `${all[0].type}:${all[0].id}`
        : "";
  const [date, setDate] = useState(initial?.date ?? formatISODate(new Date()));
  const [loadType, setLoadType] = useState<LoadType>(initial?.loadType ?? "brick");
  const [worker, setWorker] = useState(initialWorker);
  const [brickSizeId, setBrickSizeId] = useState(initial?.brickSizeId ?? sizes[0]?.id ?? "");
  const [brickCount, setBrickCount] = useState<number>(initial?.brickCount ?? 1000);
  const [ratePerBrick, setRatePerBrick] = useState<number>(initial?.ratePerBrick ?? 0.5);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isLintel = loadType === "lintel";
  const unitOne = isLintel ? "slab" : "brick";
  const total = brickCount * ratePerBrick;

  const submit = () => {
    setError(null);
    if (!worker) return setError("Pick who did the loading");
    if (brickCount <= 0) return setError(`${isLintel ? "Slab" : "Brick"} count must be more than 0`);
    if (ratePerBrick <= 0) return setError("Rate must be more than 0");
    const [workerType, workerId] = worker.split(":") as [WorkerType, string];
    startTransition(async () => {
      try {
        await onSubmit({
          date,
          loadType,
          workerType,
          workerId,
          brickSizeId: isLintel ? undefined : brickSizeId || undefined,
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
        <Field label="Who loaded" hint="Loaders, operators or drivers can all be logged here.">
          <Select value={worker} onChange={(e) => setWorker(e.target.value)}>
            {workers.loaders.length > 0 && (
              <optgroup label="Loaders">
                {workers.loaders.map((w) => (
                  <option key={`loader:${w.id}`} value={`loader:${w.id}`}>
                    {w.name}
                  </option>
                ))}
              </optgroup>
            )}
            {workers.operators.length > 0 && (
              <optgroup label="Operators">
                {workers.operators.map((w) => (
                  <option key={`operator:${w.id}`} value={`operator:${w.id}`}>
                    {w.name}
                  </option>
                ))}
              </optgroup>
            )}
            {workers.employees.length > 0 && (
              <optgroup label="Drivers / staff">
                {workers.employees.map((w) => (
                  <option key={`employee:${w.id}`} value={`employee:${w.id}`}>
                    {w.name}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
        </Field>
        <Field label="What was handled">
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setLoadType("brick")}
              className={clsx(
                "flex-1 px-3 py-2 rounded-lg text-[12px] font-semibold transition",
                !isLintel ? "bg-ink text-white" : "bg-white text-slate-700 border border-slate-200"
              )}
            >
              Bricks
            </button>
            <button
              type="button"
              onClick={() => setLoadType("lintel")}
              className={clsx(
                "flex-1 px-3 py-2 rounded-lg text-[12px] font-semibold transition",
                isLintel ? "bg-ink text-white" : "bg-white text-slate-700 border border-slate-200"
              )}
            >
              Lintel slabs
            </button>
          </div>
        </Field>
        {!isLintel && (
          <Field label="Brick size (optional)">
            <Select value={brickSizeId} onChange={(e) => setBrickSizeId(e.target.value)}>
              <option value="">- mixed -</option>
              {sizes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label={`${isLintel ? "Slabs" : "Bricks"} loaded`}>
          <Input
            type="number"
            value={brickCount}
            onChange={(e) => setBrickCount(Number(e.target.value || 0))}
          />
        </Field>
        <Field label={`Rate (₹/${unitOne})`}>
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
          {isPending ? "Saving…" : submitLabel ?? "Save loading entry"}
        </Button>
      </div>
    </Card>
  );
}
