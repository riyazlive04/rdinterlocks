"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Input, Pill, Textarea } from "@/components/ui";
import { Icon } from "@/components/icons";

export type DeliveryZoneRow = {
  id: string;
  name: string;
  distanceLabel: string;
  areas: string;
  order: number;
  active: boolean;
  quotationCount: number;
  rules: Array<{ brickSizeId: string; minBricks: number; transportOnly: number | null }>;
  prices: Array<{ brickSizeId: string; constructionTypeId: string; sellPrice: number }>;
};

type ZoneInput = {
  name: string;
  distanceLabel: string;
  areas: string;
  order: number;
  rules: Array<{ brickSizeId: string; minBricks: number; transportOnly: number | null }>;
  prices: Array<{ brickSizeId: string; constructionTypeId: string; sellPrice: number }>;
};

type FormState = {
  name: string;
  distanceLabel: string;
  areas: string;
  order: number;
  rules: Record<string, { minBricks: number; transportOnly: string }>; // transportOnly: "" = not offered
  prices: Record<string, number>; // key: `${brickSizeId}_${constructionTypeId}`
};

function emptyForm(sizes: Array<{ id: string }>): FormState {
  return {
    name: "",
    distanceLabel: "",
    areas: "",
    order: 0,
    rules: Object.fromEntries(sizes.map((s) => [s.id, { minBricks: 0, transportOnly: "" }])),
    prices: {},
  };
}

function formFromZone(z: DeliveryZoneRow, sizes: Array<{ id: string }>): FormState {
  const rules: FormState["rules"] = Object.fromEntries(
    sizes.map((s) => [s.id, { minBricks: 0, transportOnly: "" }])
  );
  for (const r of z.rules) {
    rules[r.brickSizeId] = { minBricks: r.minBricks, transportOnly: r.transportOnly != null ? String(r.transportOnly) : "" };
  }
  const prices: FormState["prices"] = {};
  for (const p of z.prices) prices[`${p.brickSizeId}_${p.constructionTypeId}`] = p.sellPrice;
  return { name: z.name, distanceLabel: z.distanceLabel, areas: z.areas, order: z.order, rules, prices };
}

function toInput(sizes: Array<{ id: string }>, ctypes: Array<{ id: string }>, f: FormState): ZoneInput {
  return {
    name: f.name.trim(),
    distanceLabel: f.distanceLabel.trim(),
    areas: f.areas.trim(),
    order: Number(f.order) || 0,
    rules: sizes.map((s) => ({
      brickSizeId: s.id,
      minBricks: Number(f.rules[s.id]?.minBricks) || 0,
      transportOnly: f.rules[s.id]?.transportOnly?.trim() ? Number(f.rules[s.id].transportOnly) : null,
    })),
    prices: sizes.flatMap((s) =>
      ctypes.map((c) => ({
        brickSizeId: s.id,
        constructionTypeId: c.id,
        sellPrice: Number(f.prices[`${s.id}_${c.id}`]) || 0,
      }))
    ),
  };
}

export function DeliveryZoneManager({
  zones,
  sizes,
  ctypes,
  onCreate,
  onUpdate,
  onDeactivate,
  onReactivate,
}: {
  zones: DeliveryZoneRow[];
  sizes: Array<{ id: string; label: string }>;
  ctypes: Array<{ id: string; name: string }>;
  onCreate: (data: ZoneInput) => Promise<void>;
  onUpdate: (id: string, data: ZoneInput) => Promise<void>;
  onDeactivate: (id: string) => Promise<void>;
  onReactivate: (id: string) => Promise<void>;
}) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm(sizes));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const startAdd = () => {
    setAdding(true);
    setEditingId(null);
    setForm(emptyForm(sizes));
    setError(null);
  };
  const startEdit = (z: DeliveryZoneRow) => {
    setEditingId(z.id);
    setAdding(false);
    setForm(formFromZone(z, sizes));
    setError(null);
  };
  const cancel = () => {
    setAdding(false);
    setEditingId(null);
    setError(null);
  };

  const submit = () => {
    if (!form.name.trim()) return setError("Name is required");
    setError(null);
    const data = toInput(sizes, ctypes, form);
    startTransition(async () => {
      try {
        if (editingId) await onUpdate(editingId, data);
        else await onCreate(data);
        cancel();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
      }
    });
  };

  const setActive = (z: DeliveryZoneRow, active: boolean) => {
    startTransition(async () => {
      try {
        if (active) await onReactivate(z.id);
        else await onDeactivate(z.id);
        router.refresh();
      } catch (e) {
        alert(e instanceof Error ? e.message : "Could not update this zone");
      }
    });
  };

  const renderForm = () => (
    <Card className="border-2 border-brand-red/30">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Field label="Zone name">
          <Input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Salem, Erode, Sankagiri…"
            autoFocus
          />
        </Field>
        <Field label="Distance" hint="Shown next to the name when picking a zone">
          <Input
            value={form.distanceLabel}
            onChange={(e) => setForm({ ...form, distanceLabel: e.target.value })}
            placeholder="e.g. 60-90 km"
          />
        </Field>
        <Field label="Display order">
          <Input
            type="number"
            value={form.order}
            onChange={(e) => setForm({ ...form, order: Number(e.target.value) || 0 })}
          />
        </Field>
      </div>
      <div className="mt-3">
        <Field label="Towns / areas in this zone" hint="Reference text only, shown to help pick the right zone">
          <Textarea
            value={form.areas}
            onChange={(e) => setForm({ ...form, areas: e.target.value })}
            placeholder="Salem, Erode, Sankagiri, Veppadi, …"
            rows={2}
          />
        </Field>
      </div>

      <div className="mt-4">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
          Minimum order &amp; transport-only rate (per brick size)
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-3 py-2 text-left font-semibold text-slate-600 uppercase tracking-wider text-[10px]">
                  Size
                </th>
                <th className="px-3 py-2 text-left font-semibold text-slate-600 uppercase tracking-wider text-[10px]">
                  Minimum bricks
                </th>
                <th className="px-3 py-2 text-left font-semibold text-slate-600 uppercase tracking-wider text-[10px]">
                  Transport only (₹/brick)
                </th>
              </tr>
            </thead>
            <tbody>
              {sizes.map((s) => (
                <tr key={s.id} className="border-b border-slate-100 last:border-b-0">
                  <td className="px-3 py-2 font-bold text-ink">{s.label}</td>
                  <td className="px-3 py-2">
                    <Input
                      type="number"
                      value={form.rules[s.id]?.minBricks ?? 0}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          rules: {
                            ...form.rules,
                            [s.id]: { ...form.rules[s.id], minBricks: Number(e.target.value) || 0 },
                          },
                        })
                      }
                      className="max-w-[140px]"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      type="number"
                      step="0.5"
                      value={form.rules[s.id]?.transportOnly ?? ""}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          rules: {
                            ...form.rules,
                            [s.id]: { ...form.rules[s.id], transportOnly: e.target.value },
                          },
                        })
                      }
                      placeholder="not offered"
                      className="max-w-[140px]"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
          Sell price (₹/brick) by construction type
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-3 py-2 text-left font-semibold text-slate-600 uppercase tracking-wider text-[10px]">
                  Size ↓ / Type →
                </th>
                {ctypes.map((c) => (
                  <th key={c.id} className="px-3 py-2 text-left font-semibold text-slate-600 uppercase tracking-wider text-[10px]">
                    {c.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sizes.map((s) => (
                <tr key={s.id} className="border-b border-slate-100 last:border-b-0">
                  <td className="px-3 py-2 font-bold text-ink">{s.label}</td>
                  {ctypes.map((c) => {
                    const key = `${s.id}_${c.id}`;
                    return (
                      <td key={c.id} className="px-3 py-2">
                        <Input
                          type="number"
                          step="0.5"
                          value={form.prices[key] ?? 0}
                          onChange={(e) =>
                            setForm({ ...form, prices: { ...form.prices, [key]: Number(e.target.value) || 0 } })
                          }
                          className="max-w-[120px]"
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {error && <div className="text-xs text-red-600 mt-3">{error}</div>}
      <div className="flex gap-2 mt-4">
        <Button onClick={submit} disabled={isPending} variant="primary">
          {isPending ? "Saving…" : editingId ? "Update zone" : "Add zone"}
        </Button>
        <Button onClick={cancel} variant="ghost">
          Cancel
        </Button>
      </div>
    </Card>
  );

  return (
    <div className="space-y-3">
      {(adding || editingId) && renderForm()}

      {!adding && !editingId && (
        <div className="flex justify-end">
          <Button onClick={startAdd} variant="primary" size="sm">
            <Icon.Plus size={14} stroke={2.4} /> Add zone
          </Button>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-900/[.06] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-3 py-2.5 text-left font-semibold text-slate-600 uppercase tracking-wider text-[10px]">
                  Zone
                </th>
                <th className="px-3 py-2.5 text-left font-semibold text-slate-600 uppercase tracking-wider text-[10px]">
                  Areas
                </th>
                <th className="px-3 py-2.5 text-right font-semibold text-slate-600 uppercase tracking-wider text-[10px]">
                  Quotes
                </th>
                <th className="px-3 py-2.5 text-right font-semibold text-slate-600 uppercase tracking-wider text-[10px] w-40">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {zones.map((z) => (
                <tr key={z.id} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50">
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-ink">{z.name}</span>
                      {z.distanceLabel && <span className="text-[11px] text-slate-500">{z.distanceLabel}</span>}
                      {!z.active && <Pill tone="slate">Inactive</Pill>}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-[12px] text-slate-500 max-w-xs truncate">{z.areas || "—"}</td>
                  <td className="px-3 py-2.5 text-right num">{z.quotationCount}</td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="inline-flex gap-1">
                      <button
                        onClick={() => startEdit(z)}
                        className="w-7 h-7 rounded-md hover:bg-slate-100 flex items-center justify-center text-slate-600"
                        aria-label="Edit"
                      >
                        <Icon.Pencil size={14} />
                      </button>
                      {z.active ? (
                        <button
                          onClick={() => setActive(z, false)}
                          disabled={isPending}
                          className="w-7 h-7 rounded-md hover:bg-red-50 flex items-center justify-center text-red-600"
                          aria-label="Deactivate"
                        >
                          <Icon.Trash size={14} />
                        </button>
                      ) : (
                        <Button onClick={() => setActive(z, true)} variant="secondary" size="sm" disabled={isPending}>
                          Reactivate
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {zones.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-[13px] text-slate-500">
                    No delivery zones yet — add one to start pricing quotations by location.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
