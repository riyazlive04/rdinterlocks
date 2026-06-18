"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { deleteLeave } from "./actions";

export function DeleteLeave({ id }: { id: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <button
      onClick={() => {
        if (!confirm("Remove this leave?")) return;
        startTransition(async () => {
          try {
            await deleteLeave(id);
            router.refresh();
          } catch (e) {
            alert(e instanceof Error ? e.message : "Failed");
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
