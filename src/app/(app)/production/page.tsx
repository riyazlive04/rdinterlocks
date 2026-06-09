import Link from "next/link";
import { prisma } from "@/lib/db";
import { Card, PageHeader, Pill, EmptyState } from "@/components/ui";
import { Icon } from "@/components/icons";
import { formatINR, formatNumber, formatShortDate, startOfDay } from "@/lib/format";
import { stageForAge, stageLabel } from "@/lib/stock";
import { DeleteButton } from "./delete-button";

export default async function ProductionPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const today = startOfDay();
  const from = sp?.from ? new Date(sp.from) : new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  const to = sp?.to ? new Date(sp.to) : today;
  to.setHours(23, 59, 59, 999);

  const [entries, settings] = await Promise.all([
    prisma.productionEntry.findMany({
      where: { date: { gte: from, lte: to } },
      include: {
        brickSize: true,
        machine: true,
        shares: { include: { operator: true } },
        batch: true,
      },
      orderBy: { date: "desc" },
    }),
    prisma.settings.findUnique({ where: { id: "default" } }),
  ]);
  const dryingDays = settings?.dryingDays ?? 3;
  const curingDays = settings?.curingDays ?? 10;

  const totals = entries.reduce(
    (a, e) => ({
      bricks: a.bricks + e.brickCount,
      wage: a.wage + e.totalWage,
      cement: a.cement + e.cementBagsUsed,
    }),
    { bricks: 0, wage: 0, cement: 0 }
  );

  return (
    <>
      <PageHeader
        title="Daily Production"
        sub="Each entry creates one stock batch + splits the salary among operators"
        right={
          <Link
            href="/production/new"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-brand-red text-white text-[13px] font-semibold shadow-red"
          >
            <Icon.Plus size={16} stroke={2.4} /> New entry
          </Link>
        }
      />

      <div className="grid sm:grid-cols-3 gap-3 mb-5">
        <Card padding="tight">
          <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
            Total bricks
          </div>
          <div className="num display text-xl font-bold mt-0.5">{formatNumber(totals.bricks)}</div>
        </Card>
        <Card padding="tight">
          <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
            Cement bags
          </div>
          <div className="num display text-xl font-bold mt-0.5">{totals.cement.toFixed(1)}</div>
        </Card>
        <Card padding="tight">
          <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
            Operator salary
          </div>
          <div className="num display text-xl font-bold mt-0.5">{formatINR(totals.wage)}</div>
        </Card>
      </div>

      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
        Recent entries
      </div>
      {entries.length === 0 ? (
        <EmptyState
          title="No production entries yet"
          sub="Start by recording today's production."
          action={
            <Link
              href="/production/new"
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-brand-red text-white text-[13px] font-semibold"
            >
              <Icon.Plus size={16} stroke={2.4} /> New entry
            </Link>
          }
        />
      ) : (
        <div className="bg-white rounded-2xl border border-slate-900/[.06] overflow-hidden mb-6">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-left">
                  <Th>Date</Th>
                  <Th>Shift</Th>
                  <Th>Machine</Th>
                  <Th>Size</Th>
                  <Th align="right">Bricks</Th>
                  <Th align="right">Damaged</Th>
                  <Th align="right">Cement</Th>
                  <Th>Operators</Th>
                  <Th align="right">Salary</Th>
                  <Th>Batch</Th>
                  <Th align="right">Action</Th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50">
                    <Td>{formatShortDate(e.date)}</Td>
                    <Td>
                      <Pill tone={e.shift === "day" ? "warning" : "dark"}>
                        {e.shift === "day" ? "Day" : "Night"}
                      </Pill>
                    </Td>
                    <Td className="text-slate-600">{e.machine?.name ?? "-"}</Td>
                    <Td>
                      <span className="mono font-semibold">{e.brickSize.label}</span>
                    </Td>
                    <Td align="right" className="num font-semibold">
                      {formatNumber(e.brickCount)}
                    </Td>
                    <Td align="right" className="num text-brand-red">
                      {e.damagedCount > 0 ? formatNumber(e.damagedCount) : "-"}
                    </Td>
                    <Td align="right" className="num">{e.cementBagsUsed.toFixed(1)}</Td>
                    <Td className="text-[12px] text-slate-600">
                      {e.shares.map((s) => s.operator.name.split(" ")[0]).join(", ")}
                    </Td>
                    <Td align="right" className="num font-semibold">
                      {formatINR(e.totalWage)}
                    </Td>
                    <Td>
                      {e.batch ? (
                        (() => {
                          const st = stageForAge(e.batch.producedAt, dryingDays, curingDays);
                          return (
                            <Pill tone={
                              st === "ready"
                                ? "success"
                                : st === "produced"
                                  ? "red"
                                  : st === "curing"
                                    ? "blue"
                                    : "warning"
                            }>
                              {e.batch.code} · {stageLabel[st]}
                            </Pill>
                          );
                        })()
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </Td>
                    <Td align="right">
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          href={`/production/${e.id}/edit`}
                          className="w-8 h-8 rounded-md hover:bg-slate-100 inline-flex items-center justify-center text-slate-500"
                          title="Edit"
                        >
                          <Icon.Pencil size={14} />
                        </Link>
                        <DeleteButton id={e.id} />
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "right" | "left" | "center" }) {
  return (
    <th
      className={`px-3 py-2.5 font-semibold text-slate-600 uppercase tracking-wider text-[10px] ${
        align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align,
  className,
}: {
  children: React.ReactNode;
  align?: "right" | "left" | "center";
  className?: string;
}) {
  return (
    <td
      className={`px-3 py-2.5 ${
        align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"
      } ${className ?? ""}`}
    >
      {children}
    </td>
  );
}
