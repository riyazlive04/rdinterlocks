import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireArea } from "@/lib/auth";
import { can } from "@/lib/access";
import { EmptyState, PageHeader, Pill, StatCard } from "@/components/ui";
import { Icon } from "@/components/icons";
import { formatINR, formatNumber } from "@/lib/format";
import { effectiveQuotationStatus } from "@/lib/quote";
import { QUOTE_STATUSES, statusLabel, statusTone } from "@/lib/quote-review";

export default async function QuotationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await requireArea("quotations");
  const canRevenue = can(session, "revenue");
  const sp = await searchParams;
  const status = sp?.status ?? "";

  const now = new Date();
  // `expired` is DERIVED (lib/quote: a sent quotation past its validUntil) and
  // never written to the column, so it cannot be filtered as a stored value —
  // and for the same reason the "Sent" chip has to exclude the rows the list
  // is about to label "expired", or the two chips would disagree with the
  // pills next to them.
  const expiredWhere = { status: "sent", validUntil: { lt: now } };
  const statusWhere =
    status === "expired"
      ? expiredWhere
      : status === "sent"
        ? { status: "sent", OR: [{ validUntil: null }, { validUntil: { gte: now } }] }
        : status
          ? { status }
          : {};

  const [quotations, statusCounts, expiredCount] = await Promise.all([
    prisma.quotation.findMany({
      where: statusWhere,
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { lead: { select: { id: true, customerName: true } }, client: { select: { id: true, name: true } } },
    }),
    prisma.quotation.groupBy({ by: ["status"], _count: true }),
    prisma.quotation.count({ where: expiredWhere }),
  ]);

  const countFor = (s: string) => statusCounts.find((c) => c.status === s)?._count ?? 0;
  const totalCount = statusCounts.reduce((s, c) => s + c._count, 0);
  const chipCount = (s: string) =>
    s === "expired" ? expiredCount : s === "sent" ? countFor("sent") - expiredCount : countFor(s);
  // "Sent" for this stat means it left draft — sent, accepted, or rejected
  // all started as a genuine send, only the pre-send statuses never reached
  // the customer.
  const sentCount =
    totalCount -
    countFor("draft") -
    countFor("in_review") -
    countFor("changes_requested") -
    countFor("approved");

  const qs = (over: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { status, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const s = params.toString();
    return s ? `/quotations?${s}` : "/quotations";
  };

  return (
    <>
      <PageHeader
        title="Quotations"
        sub="Generated from a lead or client, priced from the matrix, frozen once issued"
        right={
          canRevenue ? (
            <Link
              href="/quotations/new"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-brand-red text-white text-[13px] font-semibold shadow-red hover:bg-brand-redDark"
            >
              <Icon.Plus size={16} /> New quotation
            </Link>
          ) : undefined
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-5">
        <StatCard label="Total quotations" value={formatNumber(totalCount)} tone="ink" />
        {/* The two numbers that say whether work is piling up on a desk. */}
        <StatCard
          label="Awaiting review"
          value={formatNumber(countFor("in_review"))}
          sub="Submitted, not yet approved"
          tone={countFor("in_review") > 0 ? "red" : "default"}
        />
        <StatCard
          label="Awaiting send"
          value={formatNumber(countFor("approved"))}
          sub="Approved, not yet sent"
          tone={countFor("approved") > 0 ? "blue" : "default"}
        />
        <StatCard label="Sent" value={formatNumber(sentCount)} sub="Reached the customer" tone="default" />
        <StatCard label="Accepted" value={formatNumber(countFor("accepted"))} tone="success" />
        <StatCard label="Draft" value={formatNumber(countFor("draft"))} sub="Not submitted yet" tone="default" />
      </div>

      {/* Filters. Plain links, so the whole view is shareable as a URL. */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        <FilterChip href={qs({ status: "" })} active={!status} label={`All ${totalCount}`} />
        {QUOTE_STATUSES.map((s) => (
          <FilterChip
            key={s}
            href={qs({ status: s })}
            active={status === s}
            label={`${statusLabel(s)} ${chipCount(s)}`}
          />
        ))}
      </div>

      {quotations.length === 0 ? (
        <EmptyState
          title={status ? `No ${statusLabel(status)} quotations` : "No quotations yet"}
          sub={status ? "Clear the filter to see the rest." : "Generate one from a lead or client."}
        />
      ) : (
        <div className="space-y-2">
          {quotations.map((q) => (
            <Link
              key={q.id}
              href={`/quotations/${q.id}`}
              className="bg-white rounded-2xl p-3.5 border border-slate-200 hover:border-slate-400 transition flex items-center gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="mono text-[12px] font-bold text-ink">{q.number}</span>
                  <Pill tone={statusTone(effectiveQuotationStatus(q))}>
                    {statusLabel(effectiveQuotationStatus(q))}
                  </Pill>
                  {q.revision > 1 && <Pill tone="slate">Rev {q.revision}</Pill>}
                  {q.supersededById && <Pill tone="warning">Superseded</Pill>}
                  {q.sendQueuedAt && q.status === "approved" && <Pill tone="blue">In send list</Pill>}
                </div>
                <div className="text-[12px] text-slate-500 mt-0.5">
                  {q.customerName || "—"}
                  {q.lead ? " · lead" : q.client ? " · client" : ""}
                </div>
              </div>
              {canRevenue && (
                <div className="num text-[13px] font-bold text-ink flex-shrink-0">{formatINR(q.total)}</div>
              )}
              <Icon.Chevron size={16} color="#94A3B8" />
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

function FilterChip({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={`px-2.5 py-1.5 rounded-lg text-[12px] font-semibold transition ${
        active
          ? "bg-ink text-white"
          : "bg-white text-slate-600 border border-slate-200 hover:border-slate-400"
      }`}
    >
      {label}
    </Link>
  );
}
