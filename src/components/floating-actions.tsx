"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function FloatingActions() {
  const router = useRouter();
  const [showTop, setShowTop] = useState(false);
  const [refreshing, startTransition] = useTransition();

  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 300);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="fixed right-4 bottom-24 md:bottom-6 z-30 flex flex-col gap-2">
      <button
        onClick={() => startTransition(() => router.refresh())}
        disabled={refreshing}
        className="w-10 h-10 rounded-full bg-white shadow-cardLg border border-slate-200 flex items-center justify-center text-slate-700 hover:text-brand-red hover:border-brand-red transition disabled:opacity-50"
        aria-label="Refresh"
        title="Refresh"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={refreshing ? "animate-spin" : ""}
        >
          <path d="M3 12a9 9 0 019-9 9 9 0 016.2 2.5L21 8" />
          <path d="M21 3v5h-5" />
          <path d="M21 12a9 9 0 01-9 9 9 9 0 01-6.2-2.5L3 16" />
          <path d="M3 21v-5h5" />
        </svg>
      </button>
      {showTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="w-10 h-10 rounded-full bg-ink text-white shadow-cardLg flex items-center justify-center hover:bg-slate-800 transition"
          aria-label="Scroll to top"
          title="Top"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      )}
    </div>
  );
}
