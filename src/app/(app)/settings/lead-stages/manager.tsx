"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Input, Pill, Select } from "@/components/ui";
import { Icon } from "@/components/icons";

export type LeadStageRow = {
  id: string;
  name: string;
  slug: string;
  colour: string;
  isDefault: boolean;
  isWon: boolean;
  isLost: boolean;
  isActive: boolean;
  sortOrder: number;
  leadCount: number;
};

type StageInput = {
  name: string;
  colour: string;
  isDefault: boolean;
  isWon: boolean;
  isLost: boolean;
  sortOrder: number;
};

const emptyForm: StageInput = {
  name: "",
  colour: "#64748B",
  isDefault: false,
  isWon: false,
  isLost: false,
  sortOrder: 0,
};

export function LeadStageManager({
  stages,
  onCreate,
  onUpdate,
  onDeactivate,
  onReactivate,
}: {
  stages: LeadStageRow[];
  onCreate: (data: StageInput) => Promise<void>;
  onUpdate: (id: string, data: StageInput) => Promise<void>;
  onDeactivate: (id: string, destinationStageId?: string | null) => Promise<void>;
  onReactivate: (id: string) => Promise<void>;
}) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<StageInput>(emptyForm);
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);
  const [destinationId, setDestinationId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const startAdd = () => {
    setAdding(true);
    setEditingId(null);
    setDeactivatingId(null);
    setForm(emptyForm);
    setError(null);
  };

  const startEdit = (s: LeadStageRow) => {
    setEditingId(s.id);
    setAdding(false);
    setDeactivatingId(null);
    setForm({
      name: s.name,
      colour: s.colour,
      isDefault: s.isDefault,
      isWon: s.isWon,
      isLost: s.isLost,
      sortOrder: s.sortOrder,
    });
    setError(null);
  };

  const cancel = () => {
    setAdding(false);
    setEditingId(null);
    setDeactivatingId(null);
    setError(null);
  };

  const submit = () => {
    if (!form.name.trim()) {
      setError("Name is required");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        if (editingId) await onUpdate(editingId, form);
        else await onCreate(form);
        cancel();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
      }
    });
  };

  const startDeactivate = (s: LeadStageRow) => {
    setDeactivatingId(s.id);
    setAdding(false);
    setEditingId(null);
    setDestinationId("");
    setError(null);
  };

  const confirmDeactivate = (s: LeadStageRow) => {
    if (s.leadCount > 0 && !destinationId) {
      setError("Pick a destination stage for the existing leads first.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await onDeactivate(s.id, destinationId || null);
        setDeactivatingId(null);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not deactivate this stage");
      }
    });
  };

  const reactivate = (id: string) => {
    startTransition(async () => {
      try {
        await onReactivate(id);
        router.refresh();
      } catch (e) {
        alert(e instanceof Error ? e.message : "Could not reactivate this stage");
      }
    });
  };

  const renderForm = () => (
    <Card className="border-2 border-brand-red/30">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Name">
          <Input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Site visit scheduled"
            autoFocus
          />
        </Field>
        <Field label="Colour" hint="Used for the Kanban column header">
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={form.colour}
              onChange={(e) => setForm({ ...form, colour: e.target.value })}
              className="w-11 h-[42px] rounded-lg border border-slate-200 cursor-pointer"
            />
            <Input
              value={form.colour}
              onChange={(e) => setForm({ ...form, colour: e.target.value })}
              placeholder="#64748B"
            />
          </div>
        </Field>
        <Field label="Display order">
          <Input
            type="number"
            value={form.sortOrder}
            onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) || 0 })}
          />
        </Field>
        <Field label="Flags">
          <div className="flex flex-wrap gap-3 py-2.5">
            <label className="flex items-center gap-1.5 text-[13px]">
              <input
                type="checkbox"
                checked={form.isDefault}
                onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
              />
              Default stage
            </label>
            <label className="flex items-center gap-1.5 text-[13px]">
              <input
                type="checkbox"
                checked={form.isWon}
                onChange={(e) => setForm({ ...form, isWon: e.target.checked })}
              />
              Counts as won
            </label>
            <label className="flex items-center gap-1.5 text-[13px]">
              <input
                type="checkbox"
                checked={form.isLost}
                onChange={(e) => setForm({ ...form, isLost: e.target.checked })}
              />
              Counts as lost
            </label>
          </div>
        </Field>
      </div>
      {error && <div className="text-xs text-red-600 mt-2">{error}</div>}
      <div className="flex gap-2 mt-3">
        <Button onClick={submit} disabled={isPending} variant="primary">
          {isPending ? "Saving…" : editingId ? "Update" : "Add"}
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
            <Icon.Plus size={14} stroke={2.4} /> Add stage
          </Button>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-900/[.06] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-3 py-2.5 text-left font-semibold text-slate-600 uppercase tracking-wider text-[10px]">
                  Stage
                </th>
                <th className="px-3 py-2.5 text-left font-semibold text-slate-600 uppercase tracking-wider text-[10px]">
                  Flags
                </th>
                <th className="px-3 py-2.5 text-right font-semibold text-slate-600 uppercase tracking-wider text-[10px]">
                  Order
                </th>
                <th className="px-3 py-2.5 text-right font-semibold text-slate-600 uppercase tracking-wider text-[10px]">
                  Leads
                </th>
                <th className="px-3 py-2.5 text-right font-semibold text-slate-600 uppercase tracking-wider text-[10px] w-40">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {stages.map((s) => (
                <>
                  <tr key={s.id} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50">
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-3 h-3 rounded-full flex-shrink-0"
                          style={{ background: s.colour }}
                        />
                        <span className="font-semibold text-ink">{s.name}</span>
                        <span className="mono text-[10px] text-slate-400">{s.slug}</span>
                        {!s.isActive && <Pill tone="slate">Inactive</Pill>}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {s.isDefault && <Pill tone="blue">Default</Pill>}
                        {s.isWon && <Pill tone="success">Won</Pill>}
                        {s.isLost && <Pill tone="danger">Lost</Pill>}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right num">{s.sortOrder}</td>
                    <td className="px-3 py-2.5 text-right num">{s.leadCount}</td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="inline-flex gap-1">
                        <button
                          onClick={() => startEdit(s)}
                          className="w-7 h-7 rounded-md hover:bg-slate-100 flex items-center justify-center text-slate-600"
                          aria-label="Edit"
                        >
                          <Icon.Pencil size={14} />
                        </button>
                        {s.isActive ? (
                          <button
                            onClick={() => startDeactivate(s)}
                            className="w-7 h-7 rounded-md hover:bg-red-50 flex items-center justify-center text-red-600"
                            aria-label="Deactivate"
                          >
                            <Icon.Trash size={14} />
                          </button>
                        ) : (
                          <Button onClick={() => reactivate(s.id)} variant="secondary" size="sm" disabled={isPending}>
                            Reactivate
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {deactivatingId === s.id && (
                    <tr>
                      <td colSpan={5} className="px-3 pb-3 pt-0 bg-slate-50">
                        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 space-y-2">
                          {s.leadCount > 0 ? (
                            <>
                              <div className="text-[12px] text-ink">
                                {s.leadCount} lead(s) are currently on this stage. Pick where they should
                                move to before deactivating.
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <Select
                                  value={destinationId}
                                  onChange={(e) => setDestinationId(e.target.value)}
                                  className="max-w-xs"
                                >
                                  <option value="">- destination stage -</option>
                                  {stages
                                    .filter((o) => o.isActive && o.id !== s.id)
                                    .map((o) => (
                                      <option key={o.id} value={o.id}>
                                        {o.name}
                                      </option>
                                    ))}
                                </Select>
                                <Button
                                  onClick={() => confirmDeactivate(s)}
                                  variant="danger"
                                  size="sm"
                                  disabled={isPending}
                                >
                                  Move leads & deactivate
                                </Button>
                                <Button onClick={cancel} variant="ghost" size="sm">
                                  Cancel
                                </Button>
                              </div>
                            </>
                          ) : (
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-[12px] text-ink">
                                No leads are on this stage — it can be deactivated directly.
                              </div>
                              <Button
                                onClick={() => confirmDeactivate(s)}
                                variant="danger"
                                size="sm"
                                disabled={isPending}
                              >
                                Deactivate
                              </Button>
                              <Button onClick={cancel} variant="ghost" size="sm">
                                Cancel
                              </Button>
                            </div>
                          )}
                          {error && <div className="text-xs text-red-600">{error}</div>}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
