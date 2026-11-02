import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireArea } from "@/lib/auth";
import { can } from "@/lib/access";
import { Card, EmptyState, PageHeader, Pill } from "@/components/ui";
import { formatINR, formatLongDate, relativeTime } from "@/lib/format";
import { statusLabel, statusTone } from "@/lib/quote-review";
import { approveQuotation, requestQuotationChanges } from "../actions";
import { ReviewActions } from "./review-actions";

// The review queue: every quotation waiting for a human to confirm that the
// price and quantities match what the customer was actually told, with the
// exact PDF that was frozen at submission shown inline. Approving here is
// what makes that file the document of record — see lib/quote-document.ts.

export default async function QuotationReviewPage() {
  const session = await requireArea("quoteReview");
  // Money on screen is gated the same way the quotations list and the PDF
  // route gate it: a reviewer without `revenue` sees the queue, who
  // submitted and how long it has waited, but not the amount.
  const canRevenue = can(session, "revenue");

  const leadSelect = {
    select: { id: true, customerName: true, owner: { select: { name: true } } },
  } as const;

  const [settings, pending, bounced] = await Promise.all([
    prisma.settings.findUnique({ where: { id: "default" } }),
    prisma.quotation.findMany({
      where: { status: "in_review" },
      // Newest submission first. submittedAt is set by
      // submitQuotationForReview, but fall back to createdAt so a row
      // written before this feature shipped still sorts sensibly.
      orderBy: [{ submittedAt: "desc" }, { createdAt: "desc" }],
      take: 50,
      include: { submittedBy: { select: { name: true } }, lead: leadSelect },
    }),
    prisma.quotation.findMany({
      where: { status: "changes_requested" },
      orderBy: [{ reviewedAt: "desc" }, { createdAt: "desc" }],
      take: 25,
      include: { reviewedBy: { select: { name: true } }, lead: leadSelect },
    }),
  ]);

  const reviewRequired = settings?.quoteReviewRequired ?? false;

  return (
    <>
      <PageHeader
        title="Quotation review"
        sub="Approve the frozen PDF before it reaches the customer"
        back="/quotations"
        right={<Pill tone={pending.length > 0 ? "warning" : "slate"}>{pending.length} waiting</Pill>}
      />

      {!reviewRequired && (
        <Card className="mb-4 border-amber-200 bg-amber-50">
          <div className="text-[13px] font-semibold text-amber-900">The review gate is currently off</div>
          <div className="text-[12px] text-amber-900/80 mt-1">
            Settings &rarr; Quotations has <span className="font-semibold">review required</span> switched off, so a
            submitted quotation is approved straight away and nothing new will arrive in this queue. Anything listed
            below was submitted while the gate was on.
          </div>
        </Card>
      )}

      {pending.length === 0 ? (
        <EmptyState
          title="Nothing waiting for review"
          sub="A quotation appears here the moment someone submits it, with the PDF they submitted."
        />
      ) : (
        <div className="space-y-3">
          {pending.map((q) => (
            <Card key={q.id}>
              <div className="flex items-start gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link href={`/quotations/${q.id}`} className="mono text-[12px] font-bold text-ink hover:underline">
                      {q.number}
                    </Link>
                    <Pill tone={statusTone(q.status)}>{statusLabel(q.status)}</Pill>
                    {q.revision > 1 && <Pill tone="slate">Rev {q.revision}</Pill>}
                  </div>
                  <div className="text-[13px] font-semibold text-ink mt-1">{q.customerName || "—"}</div>
                  <div className="text-[12px] text-slate-500">
                    {q.place || "Place not captured"}
                    {q.validUntil ? ` · valid until ${formatLongDate(q.validUntil)}` : ""}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1.5">
                    Submitted by{" "}
                    <span className="font-semibold text-slate-700">{q.submittedBy?.name ?? "—"}</span>
                    {q.submittedAt ? ` · waiting ${relativeTime(q.submittedAt)}` : ""}
                    {" · owner "}
                    <span className="font-semibold text-slate-700">{q.lead?.owner?.name ?? "unassigned"}</span>
                  </div>
                  {q.reviewNote && (
                    <div className="text-[11px] text-slate-600 mt-1.5 bg-slate-50 rounded-xl px-2.5 py-1.5">
                      Note: {q.reviewNote}
                    </div>
                  )}
                </div>
                {canRevenue && (
                  <div className="num text-[15px] font-bold text-ink flex-shrink-0">{formatINR(q.total)}</div>
                )}
              </div>

              <div className="grid lg:grid-cols-[1fr_280px] gap-3 mt-3">
                {/* Always previewed, never gated on `revenue`. Holding
                    `quoteReview` IS the grant to read this document — the PDF
                    route accepts that area on its own for exactly this
                    reason. A reviewer who could not open the file would be
                    approving it blind, which would make the gate theatre.
                    The money COLUMN above stays behind `revenue`, because
                    that is about seeing totals across the business. */}
                <iframe
                  src={`/api/quote/${q.id}/pdf`}
                  title={`${q.number} PDF`}
                  className="w-full h-[420px] rounded-xl border border-slate-200 bg-slate-50"
                />

                <ReviewActions id={q.id} onApprove={approveQuotation} onRequestChanges={requestQuotationChanges} />
              </div>
            </Card>
          ))}
        </div>
      )}

      {bounced.length > 0 && (
        <div className="mt-6">
          <div className="text-base font-bold text-ink tracking-tight mb-1">Sent back for changes</div>
          <div className="text-[12px] text-slate-500 mb-3">
            Waiting on the person who prepared them. Listed here so a bounced quotation does not quietly disappear.
          </div>
          <div className="space-y-2">
            {bounced.map((q) => (
              <Link
                key={q.id}
                href={`/quotations/${q.id}`}
                className="block bg-white rounded-2xl p-3.5 border border-slate-200 hover:border-slate-400 transition"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="mono text-[12px] font-bold text-ink">{q.number}</span>
                  <Pill tone={statusTone(q.status)}>{statusLabel(q.status)}</Pill>
                  {canRevenue && <span className="num text-[12px] font-bold text-ink ml-auto">{formatINR(q.total)}</span>}
                </div>
                <div className="text-[12px] text-slate-500 mt-0.5">
                  {q.customerName || "—"}
                  {q.place ? ` · ${q.place}` : ""}
                  {" · owner "}
                  {q.lead?.owner?.name ?? "unassigned"}
                </div>
                <div className="text-[11px] text-slate-600 mt-1.5 bg-slate-50 rounded-xl px-2.5 py-1.5">
                  {q.reviewNote || "No reason recorded."}
                  {q.reviewedBy?.name ? ` — ${q.reviewedBy.name}` : ""}
                  {q.reviewedAt ? `, ${relativeTime(q.reviewedAt)} ago` : ""}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
