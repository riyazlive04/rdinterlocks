"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Textarea } from "@/components/ui";

/**
 * Approve / send-back controls for one queued quotation. The server actions
 * arrive as props, the way QuotationControls takes them — the page that
 * renders this is the only place that imports from quotations/actions.
 */
export function ReviewActions({
  id,
  onApprove,
  onRequestChanges,
}: {
  id: string;
  onApprove: (id: string, note?: string) => Promise<void>;
  onRequestChanges: (id: string, note: string) => Promise<void>;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const trimmed = note.trim();

  const approve = () => {
    setError(null);
    startTransition(async () => {
      try {
        await onApprove(id, trimmed || undefined);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not approve");
      }
    });
  };

  const sendBack = () => {
    // Guarded here as well as in the action: the button is disabled without a
    // note, so this only fires if someone gets past the disabled state.
    if (!trimmed) {
      setError("Write what needs to change first.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await onRequestChanges(id, trimmed);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not send back");
      }
    });
  };

  return (
    <div className="space-y-2">
      <Textarea
        rows={2}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note — optional when approving, required when sending back"
      />
      <div className="flex gap-2">
        <Button onClick={approve} disabled={isPending} variant="primary" size="sm" className="flex-1">
          Approve
        </Button>
        <Button
          onClick={sendBack}
          disabled={isPending || !trimmed}
          variant="secondary"
          size="sm"
          className="flex-1"
          title={trimmed ? undefined : "Add a note saying what needs to change"}
        >
          Request changes
        </Button>
      </div>
      {error && <div className="text-[11px] text-red-600">{error}</div>}
    </div>
  );
}
