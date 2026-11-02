"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Select } from "@/components/ui";
import { Icon } from "@/components/icons";

type Step = { id?: string; stepOrder: number; delayMinutes: number; templateId: string };

export function StepBuilder({
  sequenceId,
  steps,
  templates,
  activeEnrollments,
  onSave,
}: {
  sequenceId: string;
  steps: Step[];
  templates: Array<{ id: string; name: string; approved: boolean }>;
  activeEnrollments: number;
  onSave: (sequenceId: string, steps: Array<{ stepOrder: number; delayMinutes: number; templateId: string }>) => Promise<void>;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Step[]>(steps.length ? steps : []);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const locked = activeEnrollments > 0;

  const addStep = () => {
    setRows((r) => [
      ...r,
      { stepOrder: r.length + 1, delayMinutes: r.length === 0 ? 0 : 1440, templateId: templates[0]?.id ?? "" },
    ]);
  };
  const removeStep = (idx: number) => {
    setRows((r) => r.filter((_, i) => i !== idx).map((s, i) => ({ ...s, stepOrder: i + 1 })));
  };
  const move = (idx: number, dir: -1 | 1) => {
    setRows((r) => {
      const next = [...r];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return r;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next.map((s, i) => ({ ...s, stepOrder: i + 1 }));
    });
  };
  const update = (idx: number, patch: Partial<Step>) => {
    setRows((r) => r.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  const save = () => {
    if (rows.some((r) => !r.templateId)) {
      setError("Every step needs a template.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await onSave(
          sequenceId,
          rows.map((r) => ({ stepOrder: r.stepOrder, delayMinutes: r.delayMinutes, templateId: r.templateId }))
        );
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save steps");
      }
    });
  };

  return (
    <div className="space-y-3">
      {locked && (
        <Card className="border-amber-300 bg-amber-50">
          <div className="text-[12.5px] text-ink">
            {activeEnrollments} lead(s) are actively enrolled in this sequence — steps are locked until they
            finish, stop, or you stop them from the WhatsApp dashboard.
          </div>
        </Card>
      )}
      {templates.length === 0 && (
        <Card className="border-amber-300 bg-amber-50">
          <div className="text-[12.5px] text-ink">
            No active templates yet — add one under WhatsApp → Templates before building steps.
          </div>
        </Card>
      )}

      <Card>
        <div className="space-y-2">
          {rows.map((s, idx) => (
            <div key={s.id ?? idx} className="flex items-center gap-2 bg-slate-50 rounded-xl p-2.5">
              <span className="w-6 text-center text-[12px] font-bold text-slate-400 num">{idx + 1}</span>
              <Select
                value={s.templateId}
                onChange={(e) => update(idx, { templateId: e.target.value })}
                disabled={locked}
                className="flex-1"
              >
                <option value="">- template -</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {!t.approved ? " (not yet approved)" : ""}
                  </option>
                ))}
              </Select>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <input
                  type="number"
                  min={0}
                  value={s.delayMinutes}
                  disabled={locked}
                  onChange={(e) => update(idx, { delayMinutes: Math.max(0, Number(e.target.value) || 0) })}
                  className="w-20 px-2 py-2 rounded-lg border border-slate-200 text-[13px] text-right num disabled:bg-slate-100"
                />
                <span className="text-[11px] text-slate-500 whitespace-nowrap">
                  min {idx === 0 ? "after enroll" : "after prev."}
                </span>
              </div>
              {!locked && (
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  <button
                    onClick={() => move(idx, -1)}
                    disabled={idx === 0}
                    className="w-6 h-6 rounded hover:bg-slate-200 flex items-center justify-center disabled:opacity-30"
                    aria-label="Move up"
                  >
                    <Icon.ArrowUp size={13} />
                  </button>
                  <button
                    onClick={() => move(idx, 1)}
                    disabled={idx === rows.length - 1}
                    className="w-6 h-6 rounded hover:bg-slate-200 flex items-center justify-center disabled:opacity-30"
                    aria-label="Move down"
                  >
                    <Icon.ArrowDown size={13} />
                  </button>
                  <button
                    onClick={() => removeStep(idx)}
                    className="w-6 h-6 rounded hover:bg-red-100 flex items-center justify-center text-red-600"
                    aria-label="Remove step"
                  >
                    <Icon.Trash size={13} />
                  </button>
                </div>
              )}
            </div>
          ))}
          {rows.length === 0 && (
            <div className="text-center text-[13px] text-slate-500 py-6">No steps yet.</div>
          )}
        </div>

        {!locked && (
          <div className="mt-3">
            <Button onClick={addStep} variant="secondary" size="sm" disabled={templates.length === 0}>
              <Icon.Plus size={14} /> Add step
            </Button>
          </div>
        )}

        {error && <div className="text-xs text-red-600 mt-2">{error}</div>}

        {!locked && (
          <div className="mt-3">
            <Button onClick={save} disabled={isPending} variant="primary">
              {isPending ? "Saving…" : "Save steps"}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
