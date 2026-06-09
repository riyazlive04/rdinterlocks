"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { deleteCashEntry } from "./actions";

export function DeleteCashEntry({ id, canDelete }: { id: string; canDelete: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  if (!canDelete)
    return (
      <span
        className="w-7 h-7 rounded-md flex items-center justify-center text-slate-300 cursor-not-allowed"
        title="Auto-generated - delete from its source page"
      >
        <Icon.Trash size={14} />
      </span>
    );
  return (
    <button
      onClick={() => {
        if (!confirm("Delete this manual cash entry?")) return;
        startTransition(async () => {
          try {
            await deleteCashEntry(id);
            router.refresh();
          } catch (e) {
            alert(e instanceof Error ? e.message : "Delete failed");
          }
        });
      }}
      disabled={isPending}
      className="w-7 h-7 rounded-md hover:bg-red-50 flex items-center justify-center text-red-600 disabled:opacity-50"
      aria-label="Delete"
    >
      <Icon.Trash size={14} />
    </button>
  );
}
