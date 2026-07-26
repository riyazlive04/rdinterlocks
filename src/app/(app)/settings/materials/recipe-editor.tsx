"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, Input, Field, Button } from "@/components/ui";

// Grid editor: rows = materials, columns = brick sizes, each cell is the
// quantity of that material used per `basis` bricks of that size.
export function RecipeEditor({
  materials,
  sizes,
  values,
  basis,
  onSave,
}: {
  materials: Array<{ id: string; name: string; unit: string }>;
  sizes: Array<{ id: string; label: string }>;
  values: Record<string, number>; // `${materialId}_${sizeId}` -> qty
  basis: number;
  onSave: (data: { materialId: string; brickSizeId: string; qtyPerBasis: number }) => Promise<void>;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<{ mId: string; sId: string } | null>(null);
  const [qty, setQty] = useState<number>(0);
  const [isPending, startTransition] = useTransition();

  const save = () => {
    if (!editing) return;
    startTransition(async () => {
      await onSave({
        materialId: editing.mId,
        brickSizeId: editing.sId,
        qtyPerBasis: Number(qty) || 0,
      });
      setEditing(null);
      router.refresh();
    });
  };

  if (materials.length === 0 || sizes.length === 0) {
    return (
      <Card>
        <div className="text-center text-sm text-slate-500 py-6">
          Add at least one material and one brick size first.
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <Card padding="none">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-3 py-2.5 text-left font-semibold text-slate-600 uppercase tracking-wider text-[10px] sticky left-0 bg-slate-50">
                  Material ↓ / Size →
                </th>
                {sizes.map((s) => (
                  <th key={s.id} className="px-3 py-2.5 text-center font-semibold text-slate-600 uppercase tracking-wider text-[10px]">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {materials.map((m) => (
                <tr key={m.id} className="border-b border-slate-100">
                  <td className="px-3 py-2.5 font-bold text-ink sticky left-0 bg-white">
                    {m.name}
                    <span className="text-[10px] font-normal text-slate-400"> ({m.unit})</span>
                  </td>
                  {sizes.map((s) => {
                    const key = `${m.id}_${s.id}`;
                    const v = values[key];
                    return (
                      <td key={s.id} className="px-3 py-2.5">
                        <button
                          onClick={() => {
                            setEditing({ mId: m.id, sId: s.id });
                            setQty(v ?? 0);
                          }}
                          className="w-full text-center hover:bg-slate-50 rounded-md px-2 py-1.5 transition"
                        >
                          {v != null ? (
                            <span className="num font-semibold text-ink">{v}</span>
                          ) : (
                            <span className="text-[12px] text-slate-400 italic">Set</span>
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
            {materials.find((m) => m.id === editing.mId)?.name} ·{" "}
            {sizes.find((s) => s.id === editing.sId)?.label}
          </div>
          <Field
            label={`Quantity per ${basis.toLocaleString("en-IN")} bricks (${
              materials.find((m) => m.id === editing.mId)?.unit
            })`}
          >
            <Input
              type="number"
              step="0.1"
              value={qty}
              onChange={(e) => setQty(Number(e.target.value))}
              autoFocus
            />
          </Field>
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
