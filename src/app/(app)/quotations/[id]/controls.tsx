"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, Card, Pill, Select } from "@/components/ui";
import { Icon } from "@/components/icons";
import { canEditDraft, isLockedStatus } from "@/lib/quote-review";

type SentChannel = "whatsapp" | "print" | "email" | "other";

/**
 * The action panel, driven by the review state machine rather than by literal
 * status strings. Each status offers exactly the one move that belongs to the
 * person on this screen — approve/reject deliberately do NOT appear here, they
 * live in the review queue, because the point of the gate is that the author
 * is not the approver.
 */
export function QuotationControls({
  id,
  status,
  superseded,
  whatsappText,
  canRevenue,
  reviewNote,
  queued,
  documentSha256,
  documentRenderedAtLabel,
  onSubmitForReview,
  onQueueForSend,
  onMarkSent,
  onAccept,
  onReject,
}: {
  id: string;
  status: string;
  superseded: boolean;
  whatsappText: string;
  canRevenue: boolean;
  /** The reviewer's note. The whole point of a `changes_requested` bounce. */
  reviewNote: string;
  /** Already in the send list — the queue button becomes a link instead. */
  queued: boolean;
  documentSha256: string | null;
  /** Pre-formatted on the server; a client component must not format dates. */
  documentRenderedAtLabel: string | null;
  onSubmitForReview: (id: string, note?: string) => Promise<void>;
  onQueueForSend: (id: string) => Promise<void>;
  onMarkSent: (id: string, input: { channel: SentChannel }) => Promise<void>;
  onAccept: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
}) {
  const router = useRouter();
  const [channel, setChannel] = useState<SentChannel>("whatsapp");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const editable = canEditDraft(status);
  const locked = isLockedStatus(status);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(whatsappText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy — select and copy the text manually.");
    }
  };

  const submitForReview = () => {
    setError(null);
    startTransition(async () => {
      try {
        await onSubmitForReview(id);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not submit for review");
      }
    });
  };

  const queueForSend = () => {
    setError(null);
    startTransition(async () => {
      try {
        await onQueueForSend(id);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not add to the send list");
      }
    });
  };

  const markSent = () => {
    setError(null);
    startTransition(async () => {
      try {
        await onMarkSent(id, { channel });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not mark as sent");
      }
    });
  };

  const accept = () => {
    if (!confirm("Convert this quotation into an order?")) return;
    setError(null);
    startTransition(async () => {
      try {
        await onAccept(id);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Could not accept";
        if (!msg.includes("NEXT_REDIRECT")) setError(msg);
      }
    });
  };

  const reject = () => {
    if (!confirm("Mark this quotation as rejected?")) return;
    setError(null);
    startTransition(async () => {
      try {
        await onReject(id);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not reject");
      }
    });
  };

  return (
    <Card>
      <div className="text-base font-bold text-ink mb-3">Actions</div>

      {/* The bounce note comes first: it is the instruction the author has to
          act on before anything else on this panel is useful. */}
      {status === "changes_requested" && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-700">
            Changes requested
          </div>
          <div className="text-[13px] text-amber-900 mt-1 whitespace-pre-wrap">
            {reviewNote || "The reviewer did not leave a note."}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <a
          href={`/api/quote/${id}/pdf`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-[13px] font-semibold text-ink hover:border-slate-400"
        >
          <Icon.Download size={15} /> Download PDF
        </a>

        {documentSha256 && (
          <div className="flex items-center gap-2 px-1 text-[10px] text-slate-400">
            <Pill tone="slate">PDF frozen{documentRenderedAtLabel ? ` ${documentRenderedAtLabel}` : ""}</Pill>
            <span className="mono">{documentSha256.slice(0, 12)}</span>
          </div>
        )}

        <button
          onClick={copy}
          className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-[13px] font-semibold text-ink hover:border-slate-400"
        >
          <Icon.Chat size={15} /> {copied ? "Copied!" : "Copy WhatsApp message text"}
        </button>
        <div className="text-[10px] text-slate-400 px-1">
          No message is sent automatically — paste this into WhatsApp yourself.
        </div>

        {(status === "draft" || status === "changes_requested") && (
          <div className="pt-1">
            <Button onClick={submitForReview} disabled={isPending} variant="primary" className="w-full">
              <Icon.ArrowRight size={15} />{" "}
              {status === "changes_requested" ? "Resubmit for review" : "Submit for review"}
            </Button>
            <div className="text-[10px] text-slate-400 px-1 mt-1">
              The PDF is frozen on submission and reviewed before it can be sent.
            </div>
          </div>
        )}

        {status === "in_review" && (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-blue-200 bg-brand-blueLight text-[13px] font-semibold text-brand-blue">
            <Icon.Clock size={15} /> Waiting for review
          </div>
        )}
        {status === "in_review" && (
          <div className="text-[10px] text-slate-400 px-1">
            Approve or send back from Quote review — not from here.
          </div>
        )}

        {status === "approved" && (
          <div className="pt-1">
            {queued ? (
              <Link
                href="/quotations/send"
                className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-[13px] font-semibold text-ink hover:border-slate-400"
              >
                <Icon.Check size={15} /> In the send list — open it
              </Link>
            ) : (
              <Button onClick={queueForSend} disabled={isPending} variant="blue" className="w-full">
                <Icon.ArrowRight size={15} /> Add to send list
              </Button>
            )}
          </div>
        )}

        {status === "approved" && (
          <div className="flex items-center gap-2 pt-1">
            <Select value={channel} onChange={(e) => setChannel(e.target.value as SentChannel)} className="flex-1">
              <option value="whatsapp">WhatsApp</option>
              <option value="print">Printed</option>
              <option value="email">Email</option>
              <option value="other">Other</option>
            </Select>
            <Button onClick={markSent} disabled={isPending} variant="secondary" size="sm">
              Mark as sent
            </Button>
          </div>
        )}

        {editable && canRevenue && (
          <Link
            href={`/quotations/${id}/edit`}
            className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-[13px] font-semibold text-ink hover:border-slate-400"
          >
            <Icon.Pencil size={15} /> Edit draft
          </Link>
        )}

        {locked && !superseded && canRevenue && (
          <Link
            href={`/quotations/${id}/revise`}
            className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-[13px] font-semibold text-ink hover:border-slate-400"
          >
            <Icon.Pencil size={15} /> Revise (new linked quotation)
          </Link>
        )}

        {status === "sent" && (
          <div className="flex gap-2 pt-1">
            <Button onClick={accept} disabled={isPending} variant="primary" className="flex-1">
              <Icon.Check size={15} /> Accept → convert to order
            </Button>
            <Button onClick={reject} disabled={isPending} variant="ghost">
              Reject
            </Button>
          </div>
        )}
      </div>
      {error && <div className="text-xs text-red-600 mt-2">{error}</div>}
    </Card>
  );
}
