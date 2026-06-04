"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { deleteTipperLoad } from "./actions";

export function DeleteTipperLoad({ id }: { id: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <button
      onClick={() => {
        if (!confirm("Delete this load? Linked cash entry will also be removed.")) return;
        startTransition(async () => {
          await deleteTipperLoad(id);
          router.refresh();
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
