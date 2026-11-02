"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Select } from "@/components/ui";
import { Icon } from "@/components/icons";

type SentChannel = "whatsapp" | "print" | "email" | "other";

/**
 * The per-row dispatch controls on the send list: copy the text, open the
 * chat, then record the channel it went out on. Mirrors the quotation detail
 * page's QuotationControls deliberately (same copy-then-mark flow, same
 * useTransition + router.refresh() + inline-error shape) so a telecaller who
 * learned one screen already knows the other.
 *
 * Nothing here sends a message. `waHref` only OPENS WhatsApp with the text
 * prefilled; the human still presses send, and `markQuotationSent` is what
 * records that they did.
 */
export function SendRowActions({
  id,
  whatsappText,
  waHref,
  onMarkSent,
}: {
  id: string;
  whatsappText: string;
  waHref: string | null;
  onMarkSent: (id: string, input: { channel: SentChannel }) => Promise<void>;
}) {
  const router = useRouter();
  const [channel, setChannel] = useState<SentChannel>("whatsapp");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(whatsappText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy — open the quotation and copy the text manually.");
    }
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

  return (
    <div className="mt-3 pt-3 border-t border-slate-100">
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={`/api/quote/${id}/pdf`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-[12px] font-semibold text-ink hover:border-slate-400"
        >
          <Icon.Download size={14} /> PDF
        </a>

        <button
          onClick={copy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-[12px] font-semibold text-ink hover:border-slate-400"
        >
          <Icon.Chat size={14} /> {copied ? "Copied!" : "Copy message"}
        </button>

        {waHref ? (
          <a
            href={waHref}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-[12px] font-semibold hover:bg-emerald-700"
          >
            <Icon.Chat size={14} /> Open WhatsApp chat
          </a>
        ) : (
          <span className="text-[11px] text-slate-400">No usable phone number — copy and send manually.</span>
        )}

        <span className="flex-1" />

        <Select
          value={channel}
          onChange={(e) => setChannel(e.target.value as SentChannel)}
          className="w-auto py-1.5 text-[12px]"
        >
          <option value="whatsapp">WhatsApp</option>
          <option value="print">Printed</option>
          <option value="email">Email</option>
          <option value="other">Other</option>
        </Select>
        <Button onClick={markSent} disabled={isPending} variant="secondary" size="sm">
          <Icon.Check size={14} /> Mark as sent
        </Button>
      </div>
      <div className="text-[10px] text-slate-400 mt-1.5">
        No message is sent automatically — send it yourself, then mark it here.
      </div>
      {error && <div className="text-xs text-red-600 mt-2">{error}</div>}
    </div>
  );
}
