"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Textarea } from "@/components/ui";
import { Icon } from "@/components/icons";

/**
 * Approve / reject controls for one recorded payment. The server actions
 * arrive as props, the way ReviewActions in quotations/review takes them —
 * the page that renders this is the only place that imports from
 * quotations/actions.
 *
 * Approve is the primary button because it is the one that creates the order,
 * and the label says so: a manager clicking it needs to know that bricks will
 * start being made.
 */
export function PaymentReviewActions({
  id,
  onApprove,
  onReject,
}: {
  id: string;
  onApprove: (paymentId: string, note?: string) => Promise<void>;
  onReject: (paymentId: string, note: string) => Promise<void>;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const trimmed = note.trim();

  const approve = () => {
    if (!confirm("Approve this payment? This creates the order and sends it to the production queue.")) return;
    setError(null);
    startTransition(async () => {
      try {
        await onApprove(id, trimmed || undefined);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not approve the payment");
      }
    });
  };

  const reject = () => {
    // Guarded here as well as in the action: the button is disabled without a
    // note, so this only fires if someone gets past the disabled state.
    if (!trimmed) {
      setError("Write why the payment is being rejected first.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await onReject(id, trimmed);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not reject the payment");
      }
    });
  };

  return (
    <div className="space-y-2">
      <Textarea
        rows={2}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note — optional when approving, required when rejecting"
      />
      <div className="flex gap-2">
        <Button onClick={approve} disabled={isPending} variant="primary" size="sm" className="flex-1">
          <Icon.Check size={14} /> Approve &rarr; create order
        </Button>
        <Button
          onClick={reject}
          disabled={isPending || !trimmed}
          variant="secondary"
          size="sm"
          className="flex-1"
          title={trimmed ? undefined : "Add a note saying why"}
        >
          Reject
        </Button>
      </div>
      {error && <div className="text-[11px] text-red-600">{error}</div>}
    </div>
  );
}
