"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

// Reusable pagination control. Preserves all current query params and just
// updates the `page` param via client-side navigation.
export function Pagination({ page, totalPages }: { page: number; totalPages: number }) {
  const pathname = usePathname();
  const router = useRouter();
  const sp = useSearchParams();
  if (totalPages <= 1) return null;

  const go = (p: number) => {
    const params = new URLSearchParams(sp.toString());
    params.set("page", String(p));
    router.push(`${pathname}?${params.toString()}`);
  };

  const btn =
    "px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-white border border-slate-200 text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:border-slate-400";

  return (
    <div className="flex items-center justify-center gap-2 mt-4">
      <button type="button" disabled={page <= 1} onClick={() => go(page - 1)} className={btn}>
        ‹ Prev
      </button>
      <span className="text-[12px] text-slate-600">
        Page <span className="font-bold text-ink">{page}</span> of {totalPages}
      </span>
      <button type="button" disabled={page >= totalPages} onClick={() => go(page + 1)} className={btn}>
        Next ›
      </button>
    </div>
  );
}
