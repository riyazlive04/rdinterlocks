"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";

export function DeliveryDoneToggle({
  id,
  done,
  onToggle,
}: {
  id: string;
  done: boolean;
  onToggle: (id: string, done: boolean) => Promise<void>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const toggle = () =>
    startTransition(async () => {
      await onToggle(id, !done);
      router.refresh();
    });

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={isPending}
      className={
        done
          ? "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 text-[12px] font-semibold border border-emerald-200"
          : "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white text-slate-600 text-[12px] font-semibold border border-slate-200 hover:border-slate-400"
      }
    >
      {done ? <Icon.Check size={14} stroke={2.4} /> : <Icon.Clock size={14} />}
      {isPending ? "…" : done ? "Done" : "Mark done"}
    </button>
  );
}
