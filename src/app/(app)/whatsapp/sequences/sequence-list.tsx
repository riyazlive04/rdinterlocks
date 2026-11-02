"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, Card, Field, Input, Pill, Select } from "@/components/ui";
import { Icon } from "@/components/icons";

export type SequenceRow = {
  id: string;
  name: string;
  active: boolean;
  triggerStageId: string | null;
  triggerStageName: string | null;
  stepCount: number;
  activeEnrollments: number;
};

type SequenceInput = { name: string; triggerStageId?: string; active: boolean };

export function SequenceList({
  sequences,
  stages,
  onCreate,
  onUpdate,
  onDeactivate,
}: {
  sequences: SequenceRow[];
  stages: Array<{ id: string; name: string }>;
  onCreate: (data: SequenceInput) => Promise<string>;
  onUpdate: (id: string, data: SequenceInput) => Promise<void>;
  onDeactivate: (id: string) => Promise<void>;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<SequenceInput>({ name: "", triggerStageId: "", active: true });
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const startAdd = () => {
    setAdding(true);
    setEditingId(null);
    setForm({ name: "", triggerStageId: "", active: true });
    setError(null);
  };
  const startEdit = (s: SequenceRow) => {
    setEditingId(s.id);
    setAdding(false);
    setForm({ name: s.name, triggerStageId: s.triggerStageId ?? "", active: s.active });
    setError(null);
  };
  const cancel = () => {
    setAdding(false);
    setEditingId(null);
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
        if (editingId) {
          await onUpdate(editingId, form);
          cancel();
          router.refresh();
        } else {
          const id = await onCreate(form);
          router.push(`/whatsapp/sequences/${id}`);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
      }
    });
  };

  const deactivate = (s: SequenceRow) => {
    if (!confirm(`Deactivate "${s.name}"? Active enrollments will stop.`)) return;
    startTransition(async () => {
      try {
        await onDeactivate(s.id);
        router.refresh();
      } catch (e) {
        alert(e instanceof Error ? e.message : "Could not deactivate");
      }
    });
  };

  return (
    <div className="space-y-3">
      {(adding || editingId) && (
        <Card className="border-2 border-brand-red/30">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Name">
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. New enquiry follow-up"
                autoFocus
              />
            </Field>
            <Field label="Auto-trigger stage" hint="Optional — leave blank for manual enrollment only">
              <Select
                value={form.triggerStageId}
                onChange={(e) => setForm({ ...form, triggerStageId: e.target.value })}
              >
                <option value="">- manual only -</option>
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Status">
              <label className="flex items-center gap-2 text-[13px] py-2.5">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm({ ...form, active: e.target.checked })}
                />
                Active
              </label>
            </Field>
          </div>
          {error && <div className="text-xs text-red-600 mt-2">{error}</div>}
          <div className="flex gap-2 mt-3">
            <Button onClick={submit} disabled={isPending} variant="primary">
              {isPending ? "Saving…" : editingId ? "Update" : "Create & add steps"}
            </Button>
            <Button onClick={cancel} variant="ghost">
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {!adding && !editingId && (
        <div className="flex justify-end">
          <Button onClick={startAdd} variant="primary" size="sm">
            <Icon.Plus size={14} stroke={2.4} /> New sequence
          </Button>
        </div>
      )}

      {sequences.length === 0 ? (
        <Card>
          <div className="text-center text-sm text-slate-500 py-6">No sequences yet.</div>
        </Card>
      ) : (
        <div className="space-y-2">
          {sequences.map((s) => (
            <Card key={s.id} padding="tight">
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Link href={`/whatsapp/sequences/${s.id}`} className="font-semibold text-ink hover:underline">
                      {s.name}
                    </Link>
                    {!s.active && <Pill tone="slate">Inactive</Pill>}
                    {s.activeEnrollments > 0 && <Pill tone="blue">{s.activeEnrollments} active</Pill>}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {s.stepCount} step{s.stepCount === 1 ? "" : "s"} ·{" "}
                    {s.triggerStageName ? `auto on "${s.triggerStageName}"` : "manual enrollment only"}
                  </div>
                </div>
                <div className="inline-flex gap-1">
                  <button
                    onClick={() => startEdit(s)}
                    className="w-7 h-7 rounded-md hover:bg-slate-100 flex items-center justify-center text-slate-600"
                    aria-label="Edit"
                  >
                    <Icon.Pencil size={14} />
                  </button>
                  {s.active && (
                    <button
                      onClick={() => deactivate(s)}
                      className="w-7 h-7 rounded-md hover:bg-red-50 flex items-center justify-center text-red-600"
                      aria-label="Deactivate"
                    >
                      <Icon.Trash size={14} />
                    </button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
