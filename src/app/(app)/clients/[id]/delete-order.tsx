"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteOrder } from "../actions";

// Deleting a duplicate order is usually harmless (no deliveries, no money),
// but the same button can remove a real one — so the confirmation spells out
// exactly what else goes with it.
export function DeleteOrder({
  id,
  deliveries,
  payments,
  paid,
}: {
  id: string;
  deliveries: number;
  payments: number;
  paid: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const message = () => {
    const extras: string[] = [];
    if (deliveries > 0) {
      extras.push(`${deliveries} ${deliveries === 1 ? "delivery" : "deliveries"}`);
    }
    if (payments > 0) {
      extras.push(
        `${payments} ${payments === 1 ? "payment" : "payments"} totalling ₹${paid.toLocaleString(
          "en-IN"
        )} — also removed from the cashbook`
      );
    }
    if (extras.length === 0) {
      return "Delete this order? Its items will be removed too.\n\nThis cannot be undone.";
    }
    return `Delete this order?\n\nThis also deletes:\n• ${extras.join(
      "\n• "
    )}\n\nThis cannot be undone.`;
  };

  return (
    <button
      type="button"
      onClick={() => {
        if (!confirm(message())) return;
        startTransition(async () => {
          await deleteOrder(id);
          router.refresh();
        });
      }}
      disabled={isPending}
      className="text-[12px] font-semibold text-red-600 hover:text-red-700 disabled:opacity-50"
    >
      {isPending ? "Deleting…" : "Delete order"}
    </button>
  );
}
