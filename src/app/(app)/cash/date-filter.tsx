"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

// Date selector for the cashbook. Uses client-side router navigation (not a
// native GET form) so the (app) layout stays mounted — same approach as the
// reports range picker. Presets cover the common "evening check" needs; the
// custom inputs handle any specific day or range.
function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export function CashDateFilter({
  params,
  from,
  to,
}: {
  params: Record<string, string | undefined>;
  from: string;
  to: string;
}) {
  const router = useRouter();
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);

  const go = (nf: string, nt: string) => {
    const u = new URLSearchParams();
    const merged: Record<string, string | undefined> = { ...params, from: nf, to: nt };
    for (const [k, v] of Object.entries(merged)) if (v) u.set(k, v);
    router.push(`/cash?${u.toString()}`);
  };

  const today = new Date();
  const todayIso = iso(today);
  const monthStart = iso(new Date(today.getFullYear(), today.getMonth(), 1));
  const weekStart = (() => {
    const day = today.getDay(); // 0 Sun..6 Sat
    const back = day === 0 ? 6 : day - 1; // Monday start
    const d = new Date(today);
    d.setDate(today.getDate() - back);
    return iso(d);
  })();

  const presets = [
    { label: "Today", from: todayIso, to: todayIso },
    { label: "This week", from: weekStart, to: todayIso },
    { label: "This month", from: monthStart, to: todayIso },
    { label: "All", from: "2000-01-01", to: todayIso },
  ];
  const active = (p: { from: string; to: string }) => p.from === from && p.to === to;

  return (
    <div className="flex flex-wrap items-center gap-1.5 mb-3">
      {presets.map((p) => (
        <button
          key={p.label}
          type="button"
          onClick={() => go(p.from, p.to)}
          className={`px-3 py-1.5 rounded-full text-[12px] font-semibold whitespace-nowrap ${
            active(p) ? "bg-ink text-white" : "bg-white text-slate-700 border border-slate-200"
          }`}
        >
          {p.label}
        </button>
      ))}
      <span className="mx-1 h-5 w-px bg-slate-200" />
      <input
        type="date"
        value={f}
        max={t || undefined}
        onChange={(e) => setF(e.target.value)}
        className="px-2 py-1.5 rounded-lg border border-slate-200 text-[12px]"
      />
      <span className="text-slate-400">→</span>
      <input
        type="date"
        value={t}
        min={f || undefined}
        onChange={(e) => setT(e.target.value)}
        className="px-2 py-1.5 rounded-lg border border-slate-200 text-[12px]"
      />
      <button
        type="button"
        onClick={() => f && t && go(f, t)}
        className="px-3 py-1.5 rounded-lg bg-brand-red text-white text-[12px] font-semibold"
      >
        Apply
      </button>
    </div>
  );
}
