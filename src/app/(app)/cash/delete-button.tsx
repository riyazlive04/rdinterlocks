"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { deleteCashEntry } from "./actions";

export function DeleteCashEntry({ id, source }: { id: string; source: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const confirmMsg =
    source === "manual"
      ? "Delete this cash entry?"
      : `This will remove the linked ${source} record too. Delete it?`;

  return (
    <button
      onClick={() => {
        if (!confirm(confirmMsg)) return;
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
      title="Delete entry"
    >
      <Icon.Trash size={14} />
    </button>
  );
}
