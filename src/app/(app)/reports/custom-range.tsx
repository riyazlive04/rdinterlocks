"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Custom date-range picker for Reports.
 *
 * Uses client-side router navigation (router.push) instead of a native
 * `<form method="get">`. A native GET form triggers a FULL page reload,
 * which re-runs requireSession() in the (app) layout - and if the session
 * cookie can't be verified (e.g. SESSION_SECRET changed since login) the
 * user gets bounced to /login. Client-side navigation keeps the layout
 * mounted, matching how the preset range buttons behave.
 */
export function CustomRange({
  params,
  fromDefault,
  toDefault,
}: {
  params: Record<string, string | undefined>;
  fromDefault: string;
  toDefault: string;
}) {
  const router = useRouter();
  const [from, setFrom] = useState(fromDefault);
  const [to, setTo] = useState(toDefault);

  const apply = () => {
    if (!from || !to) return;
    const u = new URLSearchParams();
    const merged: Record<string, string | undefined> = {
      ...params,
      range: "custom",
      from,
      to,
    };
    for (const [k, v] of Object.entries(merged)) {
      if (v) u.set(k, v);
    }
    router.push(`/reports?${u.toString()}`);
  };

  return (
    <div className="flex items-center gap-2">
      <input
        type="date"
        value={from}
        max={to || undefined}
        onChange={(e) => setFrom(e.target.value)}
        className="px-2 py-1.5 rounded-lg border border-slate-200 text-[12px]"
      />
      <span className="text-slate-400">→</span>
      <input
        type="date"
        value={to}
        min={from || undefined}
        onChange={(e) => setTo(e.target.value)}
        className="px-2 py-1.5 rounded-lg border border-slate-200 text-[12px]"
      />
      <button
        type="button"
        onClick={apply}
        className="px-3 py-1.5 rounded-lg bg-ink text-white text-[12px] font-semibold"
      >
        Apply
      </button>
    </div>
  );
}
