"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { deleteLoadingCharge } from "../../loading/actions";

// Remove a loading add-on charge (and its cash entry) straight from the
// client's page — the "zero it out" control.
export function DeleteCharge({ id }: { id: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <button
      onClick={() => {
        if (!confirm("Remove this charge? Its cash-book entry is deleted too.")) return;
        startTransition(async () => {
          await deleteLoadingCharge(id);
          router.refresh();
        });
      }}
      disabled={isPending}
      className="w-6 h-6 rounded-md hover:bg-red-50 flex items-center justify-center text-red-600 disabled:opacity-50"
      aria-label="Remove charge"
    >
      <Icon.Trash size={13} />
    </button>
  );
}
