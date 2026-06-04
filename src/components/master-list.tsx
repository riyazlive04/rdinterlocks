"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Input, Select } from "./ui";
import { Icon } from "./icons";

export type MasterField =
  | { type: "text"; key: string; label: string; required?: boolean; placeholder?: string }
  | { type: "number"; key: string; label: string; required?: boolean; placeholder?: string; step?: string }
  | {
      type: "select";
      key: string;
      label: string;
      options: Array<{ value: string; label: string }>;
      required?: boolean;
    }
  | { type: "checkbox"; key: string; label: string };

export type MasterColumn = {
  key: string;
  header: string;
  format?: "text" | "bold" | "number" | "currency" | "mono" | "muted" | "capitalize";
};

export type MasterRow = { id: string; [key: string]: unknown };

export function MasterList<T extends MasterRow>({
  rows,
  fields,
  columns,
  onCreate,
  onUpdate,
  onDelete,
  emptyText,
  addLabel = "Add",
}: {
  rows: T[];
  fields: MasterField[];
  columns: MasterColumn[];
  onCreate: (data: Record<string, unknown>) => Promise<void>;
  onUpdate: (id: string, data: Record<string, unknown>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  emptyText?: string;
  addLabel?: string;
}) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const startAdd = () => {
    setAdding(true);
    setEditingId(null);
    setForm(Object.fromEntries(fields.map((f) => [f.key, f.type === "number" ? "" : ""])));
    setError(null);
  };

  const startEdit = (row: T) => {
    setEditingId(row.id);
    setAdding(false);
    setForm({ ...row });
    setError(null);
  };

  const submit = async () => {
    setError(null);
    for (const f of fields) {
      if (f.type !== "checkbox" && f.required && !form[f.key]) {
        setError(`${f.label} is required`);
        return;
      }
    }
    const cleaned: Record<string, unknown> = {};
    for (const f of fields) {
      const v = form[f.key];
      if (f.type === "number") cleaned[f.key] = v === "" || v == null ? null : Number(v);
      else if (f.type === "checkbox") cleaned[f.key] = !!v;
      else cleaned[f.key] = v ?? "";
    }
    startTransition(async () => {
      try {
        if (editingId) await onUpdate(editingId, cleaned);
        else await onCreate(cleaned);
        setEditingId(null);
        setAdding(false);
        setForm({});
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
      }
    });
  };

  const remove = (id: string) => {
    if (!confirm("Delete this entry?")) return;
    startTransition(async () => {
      try {
        await onDelete(id);
        router.refresh();
      } catch (e) {
        alert(e instanceof Error ? e.message : "Delete failed");
      }
    });
  };

  const renderForm = () => (
    <Card className="border-2 border-brand-red/30">
      <div className="grid sm:grid-cols-2 gap-3">
        {fields.map((f) => (
          <Field key={f.key} label={f.label}>
            {f.type === "text" || f.type === "number" ? (
              <Input
                type={f.type === "number" ? "number" : "text"}
                step={f.type === "number" ? f.step : undefined}
                value={(form[f.key] as string | number | undefined) ?? ""}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                placeholder={f.placeholder}
                autoFocus={f === fields[0]}
              />
            ) : f.type === "select" ? (
              <Select
                value={(form[f.key] as string | undefined) ?? ""}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
              >
                <option value="">— select —</option>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            ) : (
              <label className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={!!form[f.key]}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.checked })}
                />
                <span>Yes</span>
              </label>
            )}
          </Field>
        ))}
      </div>
      {error && <div className="text-xs text-red-600 mt-2">{error}</div>}
      <div className="flex gap-2 mt-3">
        <Button onClick={submit} disabled={isPending} variant="primary">
          {isPending ? "Saving…" : editingId ? "Update" : "Add"}
        </Button>
        <Button
          onClick={() => {
            setAdding(false);
            setEditingId(null);
            setError(null);
          }}
          variant="ghost"
        >
          Cancel
        </Button>
      </div>
    </Card>
  );

  const formatCell = (col: MasterColumn, val: unknown) => {
    if (val == null || val === "") return <span className="text-slate-400">—</span>;
    switch (col.format) {
      case "bold":
        return <span className="font-semibold text-ink">{String(val)}</span>;
      case "number":
        return <span className="num">{Number(val).toLocaleString("en-IN")}</span>;
      case "currency":
        return <span className="num font-semibold">₹{Number(val).toLocaleString("en-IN")}</span>;
      case "mono":
        return <span className="mono text-slate-700">{String(val)}</span>;
      case "muted":
        return <span className="text-slate-500">{String(val)}</span>;
      case "capitalize":
        return <span className="capitalize">{String(val)}</span>;
      default:
        return String(val);
    }
  };

  return (
    <div className="space-y-3">
      {(adding || editingId) && renderForm()}

      {!adding && !editingId && (
        <div className="flex justify-end">
          <Button onClick={startAdd} variant="primary" size="sm">
            <Icon.Plus size={14} stroke={2.4} /> {addLabel}
          </Button>
        </div>
      )}

      {rows.length === 0 ? (
        <Card>
          <div className="text-center text-sm text-slate-500 py-6">
            {emptyText ?? "No entries yet."}
          </div>
        </Card>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-900/[.06] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  {columns.map((c) => (
                    <th
                      key={c.key}
                      className="px-3 py-2.5 text-left font-semibold text-slate-600 uppercase tracking-wider text-[10px]"
                    >
                      {c.header}
                    </th>
                  ))}
                  <th className="px-3 py-2.5 text-right font-semibold text-slate-600 uppercase tracking-wider text-[10px] w-32">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50">
                    {columns.map((c) => (
                      <td key={c.key} className="px-3 py-2.5">
                        {formatCell(c, r[c.key])}
                      </td>
                    ))}
                    <td className="px-3 py-2.5 text-right">
                      <div className="inline-flex gap-1">
                        <button
                          onClick={() => startEdit(r)}
                          className="w-7 h-7 rounded-md hover:bg-slate-100 flex items-center justify-center text-slate-600"
                          aria-label="Edit"
                        >
                          <Icon.Pencil size={14} />
                        </button>
                        <button
                          onClick={() => remove(r.id)}
                          className="w-7 h-7 rounded-md hover:bg-red-50 flex items-center justify-center text-red-600"
                          aria-label="Delete"
                        >
                          <Icon.Trash size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
