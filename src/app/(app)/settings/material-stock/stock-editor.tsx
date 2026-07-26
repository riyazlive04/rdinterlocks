"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, Input, Field, Button } from "@/components/ui";

type Row = {
  id: string;
  name: string;
  unit: string;
  quantity: number;
  reorderAt: number;
};

export function MaterialStockEditor({
  rows,
  onSet,
  onAdd,
}: {
  rows: Row[];
  onSet: (data: { materialId: string; quantity: number; reorderAt: number }) => Promise<void>;
  onAdd: (materialId: string, amount: number) => Promise<void>;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<{ id: string; kind: "set" | "add" } | null>(null);
  const [quantity, setQuantity] = useState(0);
  const [reorderAt, setReorderAt] = useState(0);
  const [amount, setAmount] = useState(0);
  const [isPending, startTransition] = useTransition();

  const openSet = (r: Row) => {
    setMode({ id: r.id, kind: "set" });
    setQuantity(r.quantity);
    setReorderAt(r.reorderAt);
  };
  const openAdd = (r: Row) => {
    setMode({ id: r.id, kind: "add" });
    setAmount(0);
  };

  const submit = () => {
    if (!mode) return;
    startTransition(async () => {
      if (mode.kind === "set") {
        await onSet({ materialId: mode.id, quantity: Number(quantity) || 0, reorderAt: Number(reorderAt) || 0 });
      } else {
        await onAdd(mode.id, Number(amount) || 0);
      }
      setMode(null);
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <Card padding="none">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-3 py-2.5 text-left font-semibold text-slate-600 uppercase tracking-wider text-[10px]">Material</th>
                <th className="px-3 py-2.5 text-right font-semibold text-slate-600 uppercase tracking-wider text-[10px]">On hand</th>
                <th className="px-3 py-2.5 text-right font-semibold text-slate-600 uppercase tracking-wider text-[10px]">Reorder at</th>
                <th className="px-3 py-2.5 text-right font-semibold text-slate-600 uppercase tracking-wider text-[10px]"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const low = r.reorderAt > 0 && r.quantity <= r.reorderAt;
                return (
                  <tr key={r.id} className="border-b border-slate-100">
                    <td className="px-3 py-2.5 font-bold text-ink">{r.name}</td>
                    <td className="px-3 py-2.5 text-right">
                      <span className={`num font-semibold ${low ? "text-red-600" : "text-ink"}`}>
                        {r.quantity.toLocaleString("en-IN", { maximumFractionDigits: 1 })}
                      </span>
                      <span className="text-[11px] text-slate-400"> {r.unit}</span>
                      {low && <span className="ml-1.5 text-[10px] font-semibold text-red-600 uppercase">Low</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right num text-slate-500">
                      {r.reorderAt ? r.reorderAt.toLocaleString("en-IN") : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      <button onClick={() => openAdd(r)} className="text-[12px] font-semibold text-brand-blue hover:underline mr-3">
                        + Add
                      </button>
                      <button onClick={() => openSet(r)} className="text-[12px] font-semibold text-slate-600 hover:underline">
                        Set
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {mode && (
        <Card className="border-2 border-brand-red/30">
          <div className="text-[12px] font-semibold text-slate-600 mb-3">
            {rows.find((r) => r.id === mode.id)?.name} ·{" "}
            {mode.kind === "set" ? "Set current stock" : "Add received stock"}
          </div>
          {mode.kind === "set" ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label={`On hand (${rows.find((r) => r.id === mode.id)?.unit})`}>
                <Input type="number" step="0.1" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} autoFocus />
              </Field>
              <Field label="Reorder at (0 = no alert)">
                <Input type="number" step="1" value={reorderAt} onChange={(e) => setReorderAt(Number(e.target.value))} />
              </Field>
            </div>
          ) : (
            <Field label={`Quantity received (${rows.find((r) => r.id === mode.id)?.unit})`}>
              <Input type="number" step="0.1" value={amount} onChange={(e) => setAmount(Number(e.target.value))} autoFocus />
            </Field>
          )}
          <div className="flex gap-2 mt-3">
            <Button onClick={submit} disabled={isPending} variant="primary">
              {isPending ? "Saving…" : "Save"}
            </Button>
            <Button onClick={() => setMode(null)} variant="ghost">
              Cancel
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
