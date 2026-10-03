"use client";

import { useState, useTransition } from "react";
import { Button, Card, EmptyState, Field, Input, inputClass } from "@/components/ui";
import { Icon } from "@/components/icons";
import { formatNumber } from "@/lib/format";
import { hideAllData, bringBackData } from "./actions";

type Batch = {
  id: string;
  label: string;
  createdAt: string;
  createdBy: string;
  totalRows: number;
  rowCounts: Record<string, number>;
  restoredAt: string | null;
  restoredBy: string | null;
};

// Prisma model names are PascalCase; show them as something an owner reads.
function pretty(model: string) {
  return model
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

function when(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ArchiveConsole({
  role,
  factoryName,
  live,
  batches,
}: {
  role: string;
  factoryName: string;
  live: { total: number; byModel: Record<string, number> };
  batches: Batch[];
}) {
  const [label, setLabel] = useState("");
  const [confirm, setConfirm] = useState("");
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const liveRows = Object.entries(live.byModel).sort((a, b) => b[1] - a[1]);
  const nothingLive = live.total === 0;

  const hide = () => {
    setError(null);
    setDone(null);
    startTransition(async () => {
      try {
        const r = await hideAllData({ label, confirm, expected: factoryName });
        setDone(`Hidden. ${formatNumber(r.totalRows)} entries saved to a backup.`);
        setArmed(false);
        setConfirm("");
        setLabel("");
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Could not hide the data";
        if (!msg.includes("NEXT_REDIRECT")) setError(msg);
      }
    });
  };

  const bringBack = (id: string, rows: number) => {
    setError(null);
    setDone(null);
    startTransition(async () => {
      try {
        await bringBackData({ id });
        setDone(`Brought back ${formatNumber(rows)} entries.`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Could not bring the backup back";
        if (!msg.includes("NEXT_REDIRECT")) setError(msg);
      }
    });
  };

  return (
    <div className="space-y-4">
      {done && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-[13px] text-emerald-800 font-semibold">
          {done}
        </div>
      )}
      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-[13px] text-red-700 font-semibold">
          {error}
        </div>
      )}

      {/* ── Hide ─────────────────────────────────────────────────────── */}
      <Card>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0">
            <Icon.Box size={18} color="#475569" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-bold text-ink">Hide all data</div>
            <div className="text-[12px] text-slate-500 mt-0.5">
              Saves everything to a backup, then empties the app so you can start fresh.
            </div>
            <div className="text-[11px] text-emerald-700 mt-1.5">
              <span className="font-semibold">Kept:</span> all logins and their access
              permissions, the factory profile, and every backup on this page.
            </div>
          </div>
        </div>

        {nothingLive ? (
          <div className="mt-3 rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 text-[12px] text-slate-500">
            The app is already empty — there is nothing to hide. Bring a backup back below to
            restore it.
          </div>
        ) : (
          <>
            <div className="mt-3 rounded-xl bg-slate-50 border border-slate-200 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
                {formatNumber(live.total)} entries will be hidden
              </div>
              <div className="flex flex-wrap gap-1.5">
                {liveRows.map(([model, n]) => (
                  <span
                    key={model}
                    className="inline-flex items-center gap-1 rounded-lg bg-white border border-slate-200 px-2 py-1 text-[11px] text-slate-600"
                  >
                    {pretty(model)}
                    <span className="num font-semibold text-ink">{formatNumber(n)}</span>
                  </span>
                ))}
              </div>
            </div>

            {!armed ? (
              <div className="mt-4">
                <Button variant="danger" size="lg" onClick={() => setArmed(true)}>
                  Hide all data & keep a backup
                </Button>
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50/60 p-3 space-y-3">
                <div className="text-[12px] text-red-800">
                  Every screen will read empty until a backup is brought back. Download the backup
                  file afterwards so you have a copy outside the app.
                </div>
                <Field label="Name this backup (optional)">
                  <Input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="e.g. Books up to Mar 2026"
                  />
                </Field>
                <Field
                  label="Type the factory name to confirm"
                  hint={`Exactly: ${factoryName}`}
                >
                  <input
                    className={inputClass}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder={factoryName}
                    autoComplete="off"
                  />
                </Field>
                <div className="flex gap-2">
                  <Button variant="danger" onClick={hide} disabled={isPending || !confirm.trim()}>
                    {isPending ? "Hiding…" : "Yes, hide everything"}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setArmed(false);
                      setConfirm("");
                      setError(null);
                    }}
                    disabled={isPending}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      {/* ── Backups ──────────────────────────────────────────────────── */}
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2 px-1">
          Backups
        </div>
        {batches.length === 0 ? (
          <EmptyState
            title="No backups yet"
            sub="Hiding the data creates one here, and you can bring it back any time."
          />
        ) : (
          <div className="space-y-2">
            {batches.map((b) => {
              const top = Object.entries(b.rowCounts)
                .sort((x, y) => y[1] - x[1])
                .slice(0, 6);
              return (
                <Card key={b.id} padding="tight">
                  <div className="flex items-start gap-3 flex-wrap">
                    <div className="flex-1 min-w-[200px]">
                      <div className="text-[13px] font-bold text-ink">
                        {b.label || when(b.createdAt)}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {formatNumber(b.totalRows)} entries · {when(b.createdAt)}
                        {b.createdBy ? ` · by ${b.createdBy}` : ""}
                      </div>
                      {b.restoredAt && (
                        <div className="text-[11px] text-emerald-700 font-semibold mt-0.5">
                          Brought back {when(b.restoredAt)}
                          {b.restoredBy ? ` by ${b.restoredBy}` : ""}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-1 mt-2">
                        {top.map(([model, n]) => (
                          <span
                            key={model}
                            className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600"
                          >
                            {pretty(model)} <span className="num font-semibold">{n}</span>
                          </span>
                        ))}
                        {Object.keys(b.rowCounts).length > top.length && (
                          <span className="text-[10px] text-slate-400 px-1 py-0.5">
                            +{Object.keys(b.rowCounts).length - top.length} more
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 items-center">
                      <a
                        href={`/api/archive/${b.id}/download`}
                        className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-semibold bg-white text-ink border border-slate-900/[.1] hover:bg-slate-50"
                      >
                        <Icon.Download size={14} /> Download
                      </a>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => bringBack(b.id, b.totalRows)}
                        disabled={isPending || live.total > 0}
                        title={
                          live.total > 0
                            ? "Hide the current data first, then bring this backup back"
                            : undefined
                        }
                      >
                        Bring back
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
        {live.total > 0 && batches.length > 0 && (
          <div className="text-[11px] text-slate-500 mt-2 px-1">
            A backup can only be brought back into an empty app — hide the current data first so
            nothing gets doubled up.
          </div>
        )}
      </div>

      {role === "manager" && (
        <div className="text-[11px] text-slate-500 px-1">
          You are signed in as a manager. Hiding and bringing back data is logged against your
          name.
        </div>
      )}
    </div>
  );
}
