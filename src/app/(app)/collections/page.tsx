import Link from "next/link";
import { requireArea } from "@/lib/auth";
import { Card, EmptyState, PageHeader, Pill, StatCard } from "@/components/ui";
import { Icon } from "@/components/icons";
import { formatINR, formatShortDate } from "@/lib/format";
import { AGE_BUCKETS, collectionsQueue } from "@/lib/outstanding";

/**
 * Step 10 of the order-to-cash spine: who owes money, and for how long.
 *
 * Gated on `revenue` rather than a new access area, because `revenue` already
 * means "may see money totals" and that is exactly what this is. Owner and
 * manager hold it through isAdmin; the owner can grant it to anyone who
 * should be chasing payments.
 *
 * Read-only. No action on this page writes anything — recording a payment
 * stays where it already lives, on the client and the quotation.
 */
export default async function CollectionsPage() {
  await requireArea("revenue");
  const { rows, totals, credits } = await collectionsQueue();

  return (
    <>
      <PageHeader
        title="Collections"
        sub="Outstanding balances, longest overdue first"
        right={
          <Link
            href="/clients"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-[13px] font-semibold text-ink hover:border-slate-400"
          >
            <Icon.Receipt size={16} />
            <span className="hidden sm:inline">Clients</span>
          </Link>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatCard
          label="Total outstanding"
          value={formatINR(totals.debt, { compact: true })}
          sub={`${totals.clients} client${totals.clients === 1 ? "" : "s"}`}
          tone={totals.debt > 0 ? "red" : "default"}
        />
        {AGE_BUCKETS.map((b) => (
          <StatCard
            key={b.key}
            label={b.label}
            value={formatINR(totals.buckets[b.key], { compact: true })}
            sub={b.key === "d60plus" ? "Chase these first" : "By order date"}
            tone={b.key === "d60plus" && totals.buckets[b.key] > 0 ? "red" : "default"}
          />
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="Nothing outstanding"
          sub="Every order that has been billed has been paid for."
        />
      ) : (
        <Card padding="none">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <caption className="sr-only">
                Clients with an outstanding balance, aged by order date, longest
                overdue first
              </caption>
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/60">
                  <th scope="col" className="text-left font-semibold text-slate-600 px-4 py-2.5">
                    Client
                  </th>
                  <th scope="col" className="text-left font-semibold text-slate-600 px-4 py-2.5">
                    Oldest unpaid
                  </th>
                  {AGE_BUCKETS.map((b) => (
                    <th
                      key={b.key}
                      scope="col"
                      className="text-right font-semibold text-slate-600 px-4 py-2.5 whitespace-nowrap"
                    >
                      {b.label}
                    </th>
                  ))}
                  <th scope="col" className="text-right font-semibold text-slate-600 px-4 py-2.5">
                    Outstanding
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.clientId} className="border-b border-slate-100 last:border-0">
                    <th scope="row" className="text-left px-4 py-3 font-normal">
                      <Link
                        href={`/clients/${r.clientId}`}
                        className="text-[13px] font-bold text-ink hover:text-brand-red"
                      >
                        {r.name}
                      </Link>
                      <div className="text-[11px] text-slate-500">
                        {r.location ?? "-"}
                        {r.phone ? ` · ${r.phone}` : ""}
                      </div>
                    </th>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {r.oldestUnpaidAt ? (
                        <>
                          <div className="text-slate-700">{formatShortDate(r.oldestUnpaidAt)}</div>
                          {/* The age is spelled out in text, never colour
                              alone — the whole point of the column. */}
                          <div className="text-[11px] text-slate-500">
                            {r.oldestUnpaidDays} day{r.oldestUnpaidDays === 1 ? "" : "s"}
                          </div>
                        </>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                    {AGE_BUCKETS.map((b) => (
                      <td
                        key={b.key}
                        className={
                          "px-4 py-3 text-right mono " +
                          (b.key === "d60plus" && r.buckets[b.key] > 0
                            ? "text-brand-red font-semibold"
                            : "text-slate-600")
                        }
                      >
                        {r.buckets[b.key] > 0 ? formatINR(r.buckets[b.key]) : "-"}
                      </td>
                    ))}
                    <td className="px-4 py-3 text-right mono font-bold text-ink whitespace-nowrap">
                      {formatINR(r.debt)}
                      <div className="text-[11px] font-normal text-slate-500">
                        of {formatINR(r.billed, { compact: true })} billed
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50/60 border-t-2 border-slate-200">
                  <th scope="row" className="text-left px-4 py-3 font-bold text-ink">
                    Total
                  </th>
                  <td className="px-4 py-3 text-slate-500 text-[11px]">
                    {totals.clients} client{totals.clients === 1 ? "" : "s"}
                  </td>
                  {AGE_BUCKETS.map((b) => (
                    <td key={b.key} className="px-4 py-3 text-right mono font-semibold text-ink">
                      {formatINR(totals.buckets[b.key])}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-right mono font-bold text-ink">
                    {formatINR(totals.debt)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}

      {/* Overpayments are shown, not clamped away: the client detail page used
          to hide them behind Math.max(0, balance), which kept a genuine
          overpayment from the only people who could refund it. */}
      {credits.length > 0 && (
        <section className="mt-6" aria-labelledby="credits-head">
          <h2
            id="credits-head"
            className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2 px-1"
          >
            In credit
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {credits.map((c) => (
              <Link
                key={c.clientId}
                href={`/clients/${c.clientId}`}
                className="bg-white rounded-2xl border border-slate-200 hover:border-slate-400 p-4 flex items-center gap-3 transition"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-bold text-ink truncate">{c.name}</div>
                  <div className="text-[11px] text-slate-500">
                    Paid {formatINR(c.paid, { compact: true })} against{" "}
                    {formatINR(c.billed, { compact: true })} billed
                  </div>
                </div>
                <Pill tone="blue">{formatINR(c.credit)} credit</Pill>
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
