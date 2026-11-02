import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { effectiveQuotationStatus } from "@/lib/quote";
import { requireArea } from "@/lib/auth";
import { can } from "@/lib/access";
import { Card, PageHeader, Pill } from "@/components/ui";
import { formatINR, formatLongDate, formatNumber } from "@/lib/format";
import { statusLabel, statusTone } from "@/lib/quote-review";
import { quotationWhatsappText } from "../send/message";
import { QuotationControls } from "./controls";
import {
  markQuotationSent,
  acceptQuotation,
  rejectQuotation,
  submitQuotationForReview,
  queueQuotationForSend,
} from "../actions";

export default async function QuotationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireArea("quotations");
  const canRevenue = can(session, "revenue");
  const { id } = await params;

  const quotation = await prisma.quotation.findUnique({
    where: { id },
    include: {
      items: { include: { brickSize: true, constructionType: true } },
      lead: { select: { id: true, customerName: true } },
      client: { select: { id: true, name: true } },
      zone: { select: { id: true, name: true, distanceLabel: true } },
      previousRevision: { select: { id: true, number: true } },
      supersededBy: { select: { id: true, number: true } },
      submittedBy: { select: { name: true } },
      reviewedBy: { select: { name: true } },
      // Never the `pdf` bytes — the document is served by /api/quote/<id>/pdf;
      // this page only needs to say WHICH file is pinned.
      document: { select: { sha256: true, byteSize: true, renderedAt: true } },
    },
  });
  if (!quotation) notFound();

  const sentByUser = quotation.sentByUserId
    ? await prisma.user.findUnique({ where: { id: quotation.sentByUserId }, select: { name: true } })
    : null;

  // Same builder the send list uses, so the text the reviewer reads here is
  // the text the telecaller pastes from the queue.
  const whatsappText = quotationWhatsappText(quotation, canRevenue);

  const trail = [
    quotation.submittedAt,
    quotation.reviewedAt,
    quotation.reviewNote,
    quotation.document,
    quotation.sendQueuedAt,
    quotation.sentAt,
  ].some(Boolean);

  return (
    <>
      <PageHeader
        title={quotation.number}
        sub={`Revision ${quotation.revision}${quotation.supersededBy ? " · superseded" : ""}`}
        back="/quotations"
        right={
          <Pill tone={statusTone(effectiveQuotationStatus(quotation))}>
            {statusLabel(effectiveQuotationStatus(quotation))}
          </Pill>
        }
      />

      {quotation.supersededBy && (
        <Card className="mb-4 border-amber-200 bg-amber-50">
          <div className="text-[13px] text-amber-900">
            Superseded by{" "}
            <Link href={`/quotations/${quotation.supersededBy.id}`} className="font-semibold underline">
              {quotation.supersededBy.number}
            </Link>
            . This record is kept for history and can no longer be sent or accepted.
          </div>
        </Card>
      )}
      {quotation.previousRevision && (
        <div className="text-[12px] text-slate-500 mb-3">
          Revised from{" "}
          <Link href={`/quotations/${quotation.previousRevision.id}`} className="underline">
            {quotation.previousRevision.number}
          </Link>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <div className="text-base font-bold text-ink mb-3">Items</div>
          <div className="divide-y divide-slate-100">
            {quotation.items.map((it) => (
              <div key={it.id} className="py-2.5 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-ink">
                    {it.brickSize.label} · {it.constructionType.name}
                    {it.transportOnly && (
                      <Pill tone="blue" className="ml-2">
                        Transport only
                      </Pill>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {formatNumber(it.quantity)} bricks
                    {canRevenue ? ` × ${formatINR(it.unitPrice)}` : ""}
                    {it.manualOverride && (
                      <span className="text-amber-600"> · manual price</span>
                    )}
                  </div>
                </div>
                {canRevenue && (
                  <div className="num font-bold text-ink">{formatINR(it.total)}</div>
                )}
              </div>
            ))}
          </div>
          {canRevenue && (
            <div className="mt-3 pt-3 border-t border-slate-100 flex items-baseline justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Total</span>
              <span className="num text-[18px] font-bold text-ink">{formatINR(quotation.total)}</span>
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <div className="text-base font-bold text-ink mb-3">Customer</div>
            <dl className="space-y-2">
              <Row label="Name" value={quotation.customerName || "—"} />
              <Row label="Phone" value={quotation.customerPhone || "—"} />
              <Row label="Place" value={quotation.place || "—"} />
              {quotation.zone && (
                <Row
                  label="Delivery zone"
                  value={`${quotation.zone.name}${quotation.zone.distanceLabel ? ` (${quotation.zone.distanceLabel})` : ""}`}
                />
              )}
              <Row
                label="Linked to"
                value={
                  quotation.lead ? (
                    <Link href={`/leads/${quotation.lead.id}`} className="text-brand-blue underline">
                      Lead · {quotation.lead.customerName || "—"}
                    </Link>
                  ) : quotation.client ? (
                    <Link href={`/clients/${quotation.client.id}`} className="text-brand-blue underline">
                      Client · {quotation.client.name}
                    </Link>
                  ) : (
                    "—"
                  )
                }
              />
              {quotation.validUntil && <Row label="Valid until" value={formatLongDate(quotation.validUntil)} />}
              {quotation.sentAt && (
                <Row
                  label="Sent"
                  value={`${formatLongDate(quotation.sentAt)} · ${quotation.sentChannel ?? ""}${
                    sentByUser ? ` · ${sentByUser.name}` : ""
                  }`}
                />
              )}
            </dl>
          </Card>

          <QuotationControls
            id={quotation.id}
            status={quotation.status}
            superseded={!!quotation.supersededById}
            whatsappText={whatsappText}
            canRevenue={canRevenue}
            reviewNote={quotation.reviewNote}
            queued={!!quotation.sendQueuedAt}
            documentSha256={quotation.document?.sha256 ?? null}
            documentRenderedAtLabel={
              quotation.document ? formatLongDate(quotation.document.renderedAt) : null
            }
            onSubmitForReview={submitQuotationForReview}
            onQueueForSend={queueQuotationForSend}
            onMarkSent={markQuotationSent}
            onAccept={acceptQuotation}
            onReject={rejectQuotation}
          />

          {trail && (
            <Card>
              <div className="text-base font-bold text-ink mb-3">Review trail</div>
              <dl className="space-y-2">
                {quotation.submittedAt && (
                  <Row
                    label="Submitted"
                    value={`${formatLongDate(quotation.submittedAt)}${
                      quotation.submittedBy ? ` · ${quotation.submittedBy.name}` : ""
                    }`}
                  />
                )}
                {quotation.reviewedAt && (
                  <Row
                    label="Reviewed"
                    value={`${formatLongDate(quotation.reviewedAt)}${
                      quotation.reviewedBy ? ` · ${quotation.reviewedBy.name}` : ""
                    }`}
                  />
                )}
                {quotation.reviewNote && (
                  <Row
                    label="Review note"
                    value={<span className="whitespace-pre-wrap">{quotation.reviewNote}</span>}
                  />
                )}
                {quotation.document && (
                  <Row
                    label="Frozen PDF"
                    value={
                      <>
                        <span className="mono text-[12px]">{quotation.document.sha256.slice(0, 16)}</span>
                        <div className="text-[11px] text-slate-500 font-normal">
                          {Math.max(1, Math.round(quotation.document.byteSize / 1024))} KB · rendered{" "}
                          {formatLongDate(quotation.document.renderedAt)}
                        </div>
                      </>
                    }
                  />
                )}
                {quotation.sendQueuedAt && (
                  <Row
                    label="Added to send list"
                    value={`${formatLongDate(quotation.sendQueuedAt)}${
                      quotation.sendAttempts > 0
                        ? ` · ${quotation.sendAttempts} attempt${quotation.sendAttempts === 1 ? "" : "s"}`
                        : ""
                    }`}
                  />
                )}
                {quotation.sendError && (
                  <Row
                    label="Last send error"
                    value={<span className="text-red-700">{quotation.sendError}</span>}
                  />
                )}
                {quotation.sentAt && (
                  <Row
                    label="Sent"
                    value={`${formatLongDate(quotation.sentAt)}${
                      quotation.sentChannel ? ` · ${quotation.sentChannel}` : ""
                    }${sentByUser ? ` · ${sentByUser.name}` : ""}`}
                  />
                )}
                {quotation.sentMessageId && (
                  <Row
                    label="Provider message id"
                    value={<span className="mono text-[12px]">{quotation.sentMessageId}</span>}
                  />
                )}
              </dl>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className="text-[13px] text-ink font-medium">{value}</dd>
    </div>
  );
}
