import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireArea } from "@/lib/auth";
import { can } from "@/lib/access";
import { Card, EmptyState, PageHeader, Pill, StatCard } from "@/components/ui";
import { Icon } from "@/components/icons";
import { formatINR, formatNumber, formatShortDate } from "@/lib/format";
import { displayPhone, orDash } from "@/lib/leads";
import { toWhatsAppRecipient } from "@/lib/whatsapp-send";
import { markQuotationSent } from "../actions";
import { quotationWhatsappText, waMeLink } from "./message";
import { SendRowActions } from "./row-actions";

const SENT_WINDOW_DAYS = 7;

// What the row needs for the message and the deep link, in one include so the
// list is a single query rather than one per row.
const ROW_INCLUDE = {
  items: { include: { brickSize: true, constructionType: true } },
  lead: { select: { id: true, customerName: true, phoneNumber: true, phoneMasked: true } },
  client: { select: { id: true, name: true } },
  reviewedBy: { select: { name: true } },
} as const;

/**
 * The dispatch queue. Everything a telecaller needs to actually put an
 * approved quotation in front of the customer is on one row — number, name,
 * phone, the frozen PDF, the message text, and the wa.me link — so sending
 * does not mean opening three screens per quotation.
 *
 * Gated on `quoteSend`, not `quotations`: moving a status and pasting a
 * message writes no amounts, so a telecaller can hold this without `revenue`.
 * Money is therefore rendered only when they do.
 */
export default async function QuotationSendPage() {
  const session = await requireArea("quoteSend");
  const canRevenue = can(session, "revenue");

  const sentSince = new Date(Date.now() - SENT_WINDOW_DAYS * 86400000);

  const [approved, recentlySent] = await Promise.all([
    prisma.quotation.findMany({
      where: { status: "approved", supersededById: null },
      // Queued first (the desk explicitly pushed those into the list), then
      // everything else approved — and within each group oldest first, so the
      // quotation that has been waiting longest is the next one to go out.
      orderBy: [
        { sendQueuedAt: { sort: "asc", nulls: "last" } },
        { reviewedAt: { sort: "asc", nulls: "last" } },
        { createdAt: "asc" },
      ],
      take: 100,
      include: ROW_INCLUDE,
    }),
    prisma.quotation.findMany({
      where: { status: "sent", sentAt: { gte: sentSince } },
      orderBy: { sentAt: "desc" },
      take: 50,
      include: { lead: { select: { customerName: true } }, client: { select: { name: true } } },
    }),
  ]);

  // Quotation.sentByUserId is a plain column with no relation (a user can be
  // deleted without rewriting history), so the names are resolved in one
  // extra query rather than an include.
  const senderIds = [...new Set(recentlySent.map((q) => q.sentByUserId).filter((v): v is string => !!v))];
  const senders = senderIds.length
    ? await prisma.user.findMany({ where: { id: { in: senderIds } }, select: { id: true, name: true } })
    : [];
  const senderName = new Map(senders.map((u) => [u.id, u.name]));

  const queuedCount = approved.filter((q) => q.sendQueuedAt).length;
  const erroredCount = approved.filter((q) => q.sendError).length;

  return (
    <>
      <PageHeader
        title="Send list"
        sub="Approved quotations waiting to go to the customer"
        back="/quotations"
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatCard label="Waiting to send" value={formatNumber(approved.length)} tone="ink" />
        <StatCard label="In the queue" value={formatNumber(queuedCount)} sub="Added to send list" tone="blue" />
        <StatCard
          label="Send errors"
          value={formatNumber(erroredCount)}
          sub="Last attempt failed"
          tone={erroredCount > 0 ? "red" : "default"}
        />
        <StatCard
          label={`Sent (${SENT_WINDOW_DAYS}d)`}
          value={formatNumber(recentlySent.length)}
          tone="success"
        />
      </div>

      {approved.length === 0 ? (
        <EmptyState
          title="Nothing waiting to send"
          sub="A quotation reaches this list once it is approved in Quote review. Until then it sits with the reviewer."
          action={
            <Link
              href="/quotations"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-[13px] font-semibold text-ink hover:border-slate-400"
            >
              <Icon.FileText size={16} /> All quotations
            </Link>
          }
        />
      ) : (
        <div className="space-y-2">
          {approved.map((q) => {
            // The lead's captured number is the live one; the quotation's
            // snapshot is the fallback for a client-linked quote (or a lead
            // whose number was never captured).
            const phone = (q.lead ? displayPhone(q.lead) : "") || q.customerPhone;
            const whatsappText = quotationWhatsappText(q, canRevenue);
            const waHref = waMeLink(toWhatsAppRecipient(phone), whatsappText);
            const approvedAt = q.reviewedAt ?? q.createdAt;

            return (
              <Card key={q.id}>
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link href={`/quotations/${q.id}`} className="mono text-[12px] font-bold text-ink underline">
                        {q.number}
                      </Link>
                      {q.sendQueuedAt ? (
                        <Pill tone="blue">Queued {waitingLabel(q.sendQueuedAt)} ago</Pill>
                      ) : (
                        <Pill tone="slate">Not queued</Pill>
                      )}
                      {q.revision > 1 && <Pill tone="slate">Rev {q.revision}</Pill>}
                      {q.sendAttempts > 0 && (
                        <Pill tone="warning">
                          {q.sendAttempts} attempt{q.sendAttempts === 1 ? "" : "s"}
                        </Pill>
                      )}
                    </div>
                    <div className="text-[14px] font-bold text-ink mt-1 truncate">
                      {q.customerName || <span className="text-slate-400">Name not captured</span>}
                    </div>
                    <div className="text-[12px] text-slate-500 truncate">
                      {orDash(phone)}
                      {q.place ? ` · ${q.place}` : ""}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1">
                      Approved {waitingLabel(approvedAt)} ago
                      {q.reviewedBy ? ` by ${q.reviewedBy.name}` : ""}
                      {q.lead ? " · lead" : q.client ? " · client" : ""}
                    </div>
                  </div>
                  {canRevenue && (
                    <div className="num text-[15px] font-bold text-ink flex-shrink-0">{formatINR(q.total)}</div>
                  )}
                </div>

                {q.sendError && (
                  <div className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800">
                    <span className="font-semibold">Last send failed:</span> {q.sendError}
                  </div>
                )}

                <SendRowActions
                  id={q.id}
                  whatsappText={whatsappText}
                  waHref={waHref}
                  onMarkSent={markQuotationSent}
                />
              </Card>
            );
          })}
        </div>
      )}

      {recentlySent.length > 0 && (
        <>
          <div className="text-base font-bold text-ink mt-6 mb-2">
            Sent in the last {SENT_WINDOW_DAYS} days
          </div>
          <div className="space-y-2">
            {recentlySent.map((q) => (
              <Link
                key={q.id}
                href={`/quotations/${q.id}`}
                className="bg-white rounded-2xl p-3.5 border border-slate-200 hover:border-slate-400 transition flex items-center gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="mono text-[12px] font-bold text-ink">{q.number}</span>
                    {q.sentChannel && <Pill tone="blue">{q.sentChannel}</Pill>}
                  </div>
                  <div className="text-[12px] text-slate-500 truncate mt-0.5">
                    {q.customerName || "—"}
                    {q.sentAt ? ` · ${formatShortDate(q.sentAt)}` : ""}
                    {q.sentByUserId && senderName.get(q.sentByUserId)
                      ? ` · by ${senderName.get(q.sentByUserId)}`
                      : ""}
                  </div>
                </div>
                {canRevenue && (
                  <div className="num text-[13px] font-bold text-ink flex-shrink-0">{formatINR(q.total)}</div>
                )}
                <Icon.Chevron size={16} color="#94A3B8" />
              </Link>
            ))}
          </div>
        </>
      )}
    </>
  );
}

// How long this quotation has been waiting, phrased to sit in front of "ago".
// The shared relativeTime() switches to a calendar date past a week ("12
// Oct"), which reads as nonsense in that sentence, so days keep counting here
// — "approved 11d ago" is exactly the number this queue exists to surface.
function waitingLabel(since: Date): string {
  const mins = Math.max(0, Math.floor((Date.now() - since.getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
