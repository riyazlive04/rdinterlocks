"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Avatar, Pill } from "@/components/ui";
import { formatINR } from "@/lib/format";

export type BoardStage = { id: string; name: string; colour: string; isWon: boolean; isLost: boolean };

export type BoardLead = {
  id: string;
  customerName: string;
  phoneNumber: string;
  phoneMasked: string;
  place: string;
  brickCount: number | null;
  costPerBrick: number | null;
  totalBudget: number | null;
  stageId: string | null;
  stageEnteredAt: string | null;
  callSequence: number;
  source: string;
  // Supplied when the board query selects the owner relation; optional so
  // a caller that has not been widened yet still typechecks.
  ownerName?: string | null;
};

function daysInStage(iso: string | null): number | null {
  if (!iso) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
}

export function Board({
  stages,
  leads,
  onMove,
}: {
  stages: BoardStage[];
  leads: BoardLead[];
  onMove: (input: { leadId: string; toStageId: string }) => Promise<void>;
}) {
  const router = useRouter();
  const [items, setItems] = useState(leads);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const byStage = (stageId: string) => items.filter((l) => l.stageId === stageId);

  const drop = (stageId: string) => {
    setOverStage(null);
    const id = dragId;
    setDragId(null);
    if (!id) return;
    const lead = items.find((l) => l.id === id);
    if (!lead || lead.stageId === stageId) return;

    const prevStageId = lead.stageId;
    // Optimistic move — snapped back on failure (e.g. a stage that was
    // deactivated by another admin between page load and this drop).
    setItems((cur) => cur.map((l) => (l.id === id ? { ...l, stageId } : l)));
    setError(null);
    startTransition(async () => {
      try {
        await onMove({ leadId: id, toStageId: stageId });
        router.refresh();
      } catch (e) {
        setItems((cur) => cur.map((l) => (l.id === id ? { ...l, stageId: prevStageId } : l)));
        setError(e instanceof Error ? e.message : "Could not move this lead");
      }
    });
  };

  return (
    <div>
      {error && (
        <div className="mb-3 text-[12px] text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
          {error}
        </div>
      )}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {stages.map((s) => {
          const stageLeads = byStage(s.id);
          return (
            <div
              key={s.id}
              onDragOver={(e) => {
                e.preventDefault();
                setOverStage(s.id);
              }}
              onDragLeave={() => setOverStage((cur) => (cur === s.id ? null : cur))}
              onDrop={(e) => {
                e.preventDefault();
                drop(s.id);
              }}
              className={`flex-shrink-0 w-72 rounded-2xl border p-2.5 transition-colors ${
                overStage === s.id ? "border-brand-red/50 bg-brand-redLight/30" : "border-slate-200 bg-slate-50"
              }`}
            >
              <div className="flex items-center gap-2 px-1.5 py-1 mb-2">
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: s.colour }} />
                <span className="text-[12px] font-bold text-ink uppercase tracking-wide truncate">{s.name}</span>
                <span className="ml-auto text-[11px] text-slate-400 num">{stageLeads.length}</span>
              </div>
              <div className="space-y-2 min-h-[48px]">
                {stageLeads.map((l) => {
                  const value =
                    l.totalBudget ?? (l.brickCount && l.costPerBrick ? l.brickCount * l.costPerBrick : null);
                  const days = daysInStage(l.stageEnteredAt);
                  return (
                    <div
                      key={l.id}
                      draggable
                      onDragStart={() => setDragId(l.id)}
                      onDragEnd={() => setDragId(null)}
                      className="bg-white rounded-xl border border-slate-200 p-2.5 shadow-sm cursor-grab active:cursor-grabbing"
                    >
                      <Link href={`/leads/${l.id}`} className="block">
                        <div className="flex items-center gap-2">
                          <Avatar name={l.customerName || "?"} size={24} />
                          <span className="text-[12.5px] font-semibold text-ink truncate">
                            {l.customerName || "Name not captured"}
                          </span>
                          {l.callSequence > 1 && <Pill tone="blue">Call {l.callSequence}</Pill>}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-1 truncate">
                          {l.phoneNumber || l.phoneMasked || "—"}
                          {l.place ? ` · ${l.place}` : ""}
                        </div>
                        <div className="flex items-center justify-between mt-1.5">
                          <span className="text-[10px] text-slate-400">
                            {days !== null ? `${days}d in stage` : ""}
                            {l.source === "meta" ? " · Meta" : ""}
                            {" · "}
                            {l.ownerName || "Unassigned"}
                          </span>
                          {value ? (
                            <span className="num text-[11px] font-bold text-ink">
                              {formatINR(value, { compact: true })}
                            </span>
                          ) : null}
                        </div>
                      </Link>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
