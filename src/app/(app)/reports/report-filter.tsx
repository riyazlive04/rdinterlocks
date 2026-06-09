"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";

// Replaces the old <details> dropdown, which stayed open after a selection
// (client-side navigation doesn't reset native <details> state). This version
// closes on select and on outside click.
export function ReportFilter({
  label,
  hasValue,
  options,
}: {
  label: string;
  hasValue: boolean;
  options: Array<{ label: string; href: string; active: boolean }>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const pick = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="px-2.5 py-1.5 rounded-lg bg-slate-100 text-[11px] font-semibold flex items-center gap-1.5 hover:bg-slate-200"
      >
        {label}
        {hasValue && <span className="bg-brand-red text-white px-1.5 rounded-full text-[10px]">1</span>}
        <Icon.ChevronDown size={12} />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 bg-white rounded-xl border border-slate-200 shadow-cardLg max-h-72 overflow-y-auto min-w-[180px]">
          {options.map((o) => (
            <button
              key={o.href + o.label}
              type="button"
              onClick={() => pick(o.href)}
              className={`block w-full text-left px-3 py-2 text-[12px] hover:bg-slate-50 ${
                o.active ? "bg-brand-redLight text-brand-red font-semibold" : ""
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
