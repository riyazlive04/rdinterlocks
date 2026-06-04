import Link from "next/link";
import { prisma } from "@/lib/db";
import { Card, PageHeader, Pill, EmptyState } from "@/components/ui";
import { Icon } from "@/components/icons";
import { formatINR, formatNumber, formatShortDate, startOfDay, startOfWeek } from "@/lib/format";
import { DeleteMason } from "./delete-button";

export default async function MasonPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; mason?: string }>;
}) {
  const sp = await searchParams;
  const today = startOfDay();
  const from = sp?.from ? new Date(sp.from) : new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  const to = sp?.to ? new Date(sp.to) : today;
  to.setHours(23, 59, 59, 999);

  const [works, masons, advances] = await Promise.all([
    prisma.masonWork.findMany({
      where: {
        date: { gte: from, lte: to },
        ...(sp?.mason ? { masonId: sp.mason } : {}),
      },
      include: { mason: true, brickSize: true, constructionType: true },
      orderBy: { date: "desc" },
    }),
    prisma.mason.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.advance.findMany({
      where: {
        personType: "mason",
        date: { gte: startOfWeek() },
        ...(sp?.mason ? { masonId: sp.mason } : {}),
      },
      include: { mason: true },
      orderBy: { date: "desc" },
    }),
  ]);

  const totalEarned = works.reduce((s, w) => s + w.totalAmount, 0);
  const totalAdvance = advances.reduce((s, a) => s + a.amount, 0);

  return (
    <>
      <PageHeader
        title="Mason work"
        sub="Site-by-site brick laying — rate by brick size × construction type"
        right={
          <Link
            href="/mason/new"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-brand-red text-white text-[13px] font-semibold shadow-red"
          >
            <Icon.Plus size={16} stroke={2.4} /> New work
          </Link>
        }
      />

      <div className="grid sm:grid-cols-3 gap-3 mb-5">
        <Card padding="tight">
          <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
            Bricks laid
          </div>
          <div className="num display text-xl font-bold mt-0.5">
            {formatNumber(works.reduce((s, w) => s + w.brickCount, 0))}
          </div>
        </Card>
        <Card padding="tight">
          <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
            Wages owed
          </div>
          <div className="num display text-xl font-bold mt-0.5 text-brand-red">
            {formatINR(totalEarned)}
          </div>
        </Card>
        <Card padding="tight">
          <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
            Advances this week
          </div>
          <div className="num display text-xl font-bold mt-0.5">{formatINR(totalAdvance)}</div>
        </Card>
      </div>

      <div className="flex gap-1.5 overflow-x-auto no-scrollbar mb-4">
        <Link
          href="/mason"
          className={`px-3 py-1.5 rounded-full text-[12px] font-semibold whitespace-nowrap ${
            !sp?.mason ? "bg-ink text-white" : "bg-white text-slate-700 border border-slate-200"
          }`}
        >
          All masons
        </Link>
        {masons.map((m) => (
          <Link
            key={m.id}
            href={`/mason?mason=${m.id}`}
            className={`px-3 py-1.5 rounded-full text-[12px] font-semibold whitespace-nowrap ${
              sp?.mason === m.id
                ? "bg-ink text-white"
                : "bg-white text-slate-700 border border-slate-200"
            }`}
          >
            {m.name}
          </Link>
        ))}
      </div>

      {works.length === 0 ? (
        <EmptyState title="No mason work logged" sub="Record laid bricks per mason per site." />
      ) : (
        <div className="bg-white rounded-2xl border border-slate-900/[.06] overflow-hidden mb-5">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <Th>Date</Th>
                  <Th>Mason</Th>
                  <Th>Site</Th>
                  <Th>Size · Type</Th>
                  <Th align="right">Bricks</Th>
                  <Th align="right">Rate</Th>
                  <Th align="right">Total</Th>
                  <Th align="right">Action</Th>
                </tr>
              </thead>
              <tbody>
                {works.map((w) => (
                  <tr key={w.id} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50">
                    <Td>{formatShortDate(w.date)}</Td>
                    <Td className="font-semibold">{w.mason.name}</Td>
                    <Td>{w.siteName}</Td>
                    <Td>
                      <Pill tone="slate">
                        {w.brickSize.label} · {w.constructionType.name}
                      </Pill>
                    </Td>
                    <Td align="right" className="num">{formatNumber(w.brickCount)}</Td>
                    <Td align="right" className="num">₹{w.ratePerBrick}</Td>
                    <Td align="right" className="num font-bold">{formatINR(w.totalAmount)}</Td>
                    <Td align="right">
                      <DeleteMason id={w.id} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {advances.length > 0 && (
        <>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
            Advances this week
          </div>
          <div className="bg-white rounded-2xl border border-slate-900/[.06] divide-y divide-slate-100">
            {advances.map((a) => (
              <div key={a.id} className="flex items-center gap-3 p-3">
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-ink">{a.mason?.name}</div>
                  <div className="text-[11px] text-slate-500">
                    {formatShortDate(a.date)} {a.notes ? `· ${a.notes}` : ""}
                  </div>
                </div>
                <div className="num text-sm font-bold text-brand-red">−{formatINR(a.amount)}</div>
              </div>
            ))}
          </div>
        </>
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
