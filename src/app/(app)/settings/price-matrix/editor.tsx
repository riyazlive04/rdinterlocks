"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, Input, Field, Button } from "@/components/ui";

type PriceData = { sellPrice: number; masonRate: number; productionCost: number };

export function PriceMatrixEditor({
  sizes,
  ctypes,
  values,
  onSave,
}: {
  sizes: Array<{ id: string; label: string }>;
  ctypes: Array<{ id: string; name: string }>;
  values: Record<string, PriceData>;
  onSave: (data: {
    brickSizeId: string;
    constructionTypeId: string;
    sellPrice: number;
    masonRate: number;
    productionCost: number;
  }) => Promise<void>;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<{ sId: string; cId: string } | null>(null);
  const [form, setForm] = useState<PriceData>({ sellPrice: 0, masonRate: 0, productionCost: 0 });
  const [isPending, startTransition] = useTransition();

  const save = () => {
    if (!editing) return;
    startTransition(async () => {
      await onSave({
        brickSizeId: editing.sId,
        constructionTypeId: editing.cId,
        sellPrice: Number(form.sellPrice),
        masonRate: Number(form.masonRate),
        productionCost: Number(form.productionCost),
      });
      setEditing(null);
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
                <th className="px-3 py-2.5 text-left font-semibold text-slate-600 uppercase tracking-wider text-[10px] sticky left-0 bg-slate-50">
                  Size ↓ / Type →
                </th>
                {ctypes.map((c) => (
                  <th key={c.id} className="px-3 py-2.5 text-center font-semibold text-slate-600 uppercase tracking-wider text-[10px]">
                    {c.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sizes.map((s) => (
                <tr key={s.id} className="border-b border-slate-100">
                  <td className="px-3 py-2.5 font-bold text-ink mono sticky left-0 bg-white">{s.label}</td>
                  {ctypes.map((c) => {
                    const key = `${s.id}_${c.id}`;
                    const v = values[key];
                    return (
                      <td key={c.id} className="px-3 py-2.5">
                        <button
                          onClick={() => {
                            setEditing({ sId: s.id, cId: c.id });
                            setForm({
                              sellPrice: v?.sellPrice ?? 0,
                              masonRate: v?.masonRate ?? 0,
                              productionCost: v?.productionCost ?? 0,
                            });
                          }}
                          className="w-full text-center hover:bg-slate-50 rounded-md px-2 py-1.5 transition"
                        >
                          {v ? (
                            <div>
                              <div className="num font-semibold text-ink">₹{v.sellPrice}</div>
                              <div className="text-[10px] text-slate-500">
                                Mason ₹{v.masonRate} · Cost ₹{v.productionCost}
                              </div>
                            </div>
                          ) : (
                            <span className="text-[12px] text-slate-400 italic">Set price</span>
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {editing && (
        <Card className="border-2 border-brand-red/30">
          <div className="text-[12px] font-semibold text-slate-600 mb-3">
            {sizes.find((s) => s.id === editing.sId)?.label} ·{" "}
            {ctypes.find((c) => c.id === editing.cId)?.name}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Sell price (₹/brick)">
              <Input
                type="number"
                step="0.5"
                value={form.sellPrice}
                onChange={(e) => setForm({ ...form, sellPrice: Number(e.target.value) })}
                autoFocus
              />
            </Field>
            <Field label="Mason rate (₹/brick)">
              <Input
                type="number"
                step="0.5"
                value={form.masonRate}
                onChange={(e) => setForm({ ...form, masonRate: Number(e.target.value) })}
              />
            </Field>
            <Field label="Production cost (₹/brick)">
              <Input
                type="number"
                step="0.5"
                value={form.productionCost}
                onChange={(e) => setForm({ ...form, productionCost: Number(e.target.value) })}
              />
            </Field>
          </div>
          <div className="flex gap-2 mt-3">
            <Button onClick={save} disabled={isPending} variant="primary">
              {isPending ? "Saving…" : "Save"}
            </Button>
            <Button onClick={() => setEditing(null)} variant="ghost">
              Cancel
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
