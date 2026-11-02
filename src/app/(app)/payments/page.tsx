import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { isFullAccess, roleLabel } from "@/lib/roles";
import { Card, EmptyState, PageHeader, Pill } from "@/components/ui";
import { formatINR, formatLongDate, relativeTime } from "@/lib/format";
import { paymentMethodLabel, paymentStatusLabel, paymentStatusTone, paymentTotals } from "@/lib/quote-payment";
import type { PaymentTotals } from "@/lib/quote-payment";
import { approvePaymentAction, rejectPaymentAction } from "../quotations/actions";
import { PaymentReviewActions } from "./review-actions";

// The manager's approval queue — the gate between a closed sale and the
// factory floor. Every row here is a telecaller's claim that a customer paid;
// approving one is what creates the Order and puts the job in the
// supervisor's production queue (see lib/quote-payment.ts). Nothing reaches
// production unpaid and unchecked.

export default async function PaymentApprovalsPage() {
  const session = await requireSession();
  // Role, not an area. Approving a payment is a manager/owner act, and the
  // point of the gate is that the person who closed the sale is not the
  // person who confirms the money arrived — so no granted area opens this
  // screen. (Every full-access role passes can(session, "revenue") by
  // definition, which is why the amounts below are not separately gated.)
  if (!isFullAccess(session.role)) redirect("/");

  const quotationSelect = {
    select: { id: true, number: true, customerName: true, place: true, total: true, status: true, orderId: true },
  } as const;

  const [pending, reviewed] = await Promise.all([
    prisma.quotationPayment.findMany({
      where: { status: "pending" },
      orderBy: [{ recordedAt: "desc" }, { paidAt: "desc" }],
      take: 50,
      include: { quotation: quotationSelect, recordedBy: { select: { name: true, role: true } } },
    }),
    prisma.quotationPayment.findMany({
      where: { status: { in: ["approved", "rejected"] } },
      orderBy: [{ reviewedAt: "desc" }],
      take: 25,
      include: {
        quotation: quotationSelect,
        recordedBy: { select: { name: true } },
        reviewedBy: { select: { name: true, role: true } },
      },
    }),
  ]);

  // One totals read per QUOTATION, not per payment: two part payments against
  // the same quote share a balance, and the row has to show that balance
  // rather than pretending each payment stands alone.
  const quotationIds = [...new Set(pending.map((p) => p.quotationId))];
  const totals = new Map<string, PaymentTotals>(
    await Promise.all(quotationIds.map(async (id) => [id, await paymentTotals(id)] as const))
  );

  const pendingSum = pending.reduce((s, p) => s + p.amount, 0);

  return (
    <>
      <PageHeader
        title="Payment approvals"
        sub="Approving a payment is what creates the order"
        right={<Pill tone={pending.length > 0 ? "warning" : "slate"}>{pending.length} waiting</Pill>}
      />

      {pending.length === 0 ? (
        <EmptyState
          title="No payments waiting for approval"
          sub="A payment appears here the moment someone records it against an accepted quotation. Until it is approved, no order exists and nothing reaches production."
        />
      ) : (
        <>
          <Card className="mb-4 border-amber-200 bg-amber-50">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <div className="text-[13px] text-amber-900">
                <span className="font-semibold">{pending.length}</span> payment
                {pending.length === 1 ? "" : "s"} waiting. None of these has created an order yet — approving one
                creates it and sends the job to production.
              </div>
              <div className="num text-[15px] font-bold text-amber-900">{formatINR(pendingSum)}</div>
            </div>
          </Card>

          <div className="space-y-3">
            {pending.map((p) => {
              const t = totals.get(p.quotationId);
              return (
                <Card key={p.id}>
                  <div className="grid lg:grid-cols-[1fr_300px] gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link
                          href={`/quotations/${p.quotation.id}`}
                          className="mono text-[12px] font-bold text-ink hover:underline"
                        >
                          {p.quotation.number}
                        </Link>
                        <Pill tone={paymentStatusTone(p.status)}>{paymentStatusLabel(p.status)}</Pill>
                        <Pill tone="slate">{paymentMethodLabel(p.method)}</Pill>
                      </div>

                      <div className="text-[13px] font-semibold text-ink mt-1">
                        {p.quotation.customerName || "—"}
                      </div>
                      <div className="text-[12px] text-slate-500">
                        {p.quotation.place || "Place not captured"} · paid {formatLongDate(p.paidAt)}
                      </div>

                      <div className="flex items-baseline gap-2 mt-2">
                        <span className="num text-[20px] font-bold text-ink">{formatINR(p.amount)}</span>
                        <span className="text-[11px] text-slate-500">
                          of {formatINR(p.quotation.total)} quoted
                        </span>
                      </div>

                      {t && (
                        <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                          <Figure label="Approved" value={formatINR(t.approved)} />
                          <Figure label="Pending" value={formatINR(t.pending)} tone="amber" />
                          <Figure
                            label={t.balance < 0 ? "Overpaid" : "Balance"}
                            value={formatINR(Math.abs(t.balance))}
                            tone={t.balance > 0 ? "amber" : "default"}
                          />
                        </div>
                      )}
                      {t && t.balance > 0 && (
                        <div className="text-[11px] text-slate-500 mt-1.5">
                          Part payment — {formatINR(t.balance)} would still be outstanding after this is approved.
                        </div>
                      )}

                      <div className="text-[11px] text-slate-500 mt-2">
                        Recorded by{" "}
                        <span className="font-semibold text-slate-700">{p.recordedBy?.name ?? "—"}</span>
                        {p.recordedBy?.role ? ` (${roleLabel(p.recordedBy.role)})` : ""}
                        {` · ${relativeTime(p.recordedAt)} ago`}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Reference:{" "}
                        {p.reference ? (
                          <span className="mono text-slate-700">{p.reference}</span>
                        ) : (
                          <span className="text-amber-700">none given</span>
                        )}
                      </div>
                      {p.notes && (
                        <div className="text-[11px] text-slate-600 mt-1.5 bg-slate-50 rounded-xl px-2.5 py-1.5 whitespace-pre-wrap">
                          {p.notes}
                        </div>
                      )}
                      {p.quotation.orderId && (
                        <div className="text-[11px] text-amber-700 mt-1.5">
                          An order already exists for this quotation — approving this payment will be refused. Record
                          it against the order from the client&rsquo;s page instead.
                        </div>
                      )}
                    </div>

                    <PaymentReviewActions
                      id={p.id}
                      onApprove={approvePaymentAction}
                      onReject={rejectPaymentAction}
                    />
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}

      {reviewed.length > 0 && (
        <div className="mt-6">
          <div className="text-base font-bold text-ink tracking-tight mb-1">Recently reviewed</div>
          <div className="text-[12px] text-slate-500 mb-3">
            Who decided, and when. An approved payment has created its order; a rejected one never did.
          </div>
          <div className="space-y-2">
            {reviewed.map((p) => (
              <Link
                key={p.id}
                href={`/quotations/${p.quotation.id}`}
                className="block bg-white rounded-2xl p-3.5 border border-slate-200 hover:border-slate-400 transition"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="mono text-[12px] font-bold text-ink">{p.quotation.number}</span>
                  <Pill tone={paymentStatusTone(p.status)}>{paymentStatusLabel(p.status)}</Pill>
                  <Pill tone="slate">{paymentMethodLabel(p.method)}</Pill>
                  <span className="num text-[13px] font-bold text-ink ml-auto">{formatINR(p.amount)}</span>
                </div>
                <div className="text-[12px] text-slate-500 mt-0.5">
                  {p.quotation.customerName || "—"}
                  {p.quotation.place ? ` · ${p.quotation.place}` : ""}
                  {` · recorded by ${p.recordedBy?.name ?? "—"}`}
                </div>
                <div className="text-[11px] text-slate-600 mt-1.5 bg-slate-50 rounded-xl px-2.5 py-1.5">
                  {p.status === "approved" ? "Approved" : "Rejected"} by{" "}
                  <span className="font-semibold">{p.reviewedBy?.name ?? "—"}</span>
                  {p.reviewedBy?.role ? ` (${roleLabel(p.reviewedBy.role)})` : ""}
                  {p.reviewedAt ? ` · ${relativeTime(p.reviewedAt)} ago` : ""}
                  {p.reviewNote ? ` — ${p.reviewNote}` : p.status === "rejected" ? " — no reason recorded." : ""}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function Figure({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "amber";
}) {
  return (
    <div className="rounded-xl bg-slate-50 px-2 py-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`num text-[13px] font-bold ${tone === "amber" ? "text-amber-700" : "text-ink"}`}>{value}</div>
    </div>
  );
}
