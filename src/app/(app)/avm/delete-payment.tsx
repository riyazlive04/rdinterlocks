"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";

export function DeleteVendorPayment({
  id,
  onDelete,
}: {
  id: string;
  onDelete: (id: string) => Promise<void>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <button
      onClick={() => {
        if (!confirm("Delete this payment and its cash entry?")) return;
        startTransition(async () => {
          await onDelete(id);
          router.refresh();
        });
      }}
      disabled={isPending}
      className="w-8 h-8 rounded-md hover:bg-red-50 inline-flex items-center justify-center text-red-600"
      aria-label="Delete payment"
    >
      <Icon.Trash size={14} />
    </button>
  );
}
