import Link from "next/link";
import { prisma } from "@/lib/db";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { Icon } from "@/components/icons";
import { formatINR, formatNumber, formatShortDate, startOfDay } from "@/lib/format";
import { DeleteLoading } from "./delete-button";

export default async function LoadingPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; worker?: string }>;
}) {
  const sp = await searchParams;
  const today = startOfDay();
  const from = sp?.from ? new Date(sp.from) : new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  const to = sp?.to ? new Date(sp.to) : today;
  to.setHours(23, 59, 59, 999);

  // Filter param is "type:id" (e.g. "operator:abc"). Build the matching where.
  const [wType, wId] = (sp?.worker ?? "").split(":");
  const workerWhere =
    wType && wId
      ? wType === "loader"
        ? { loaderId: wId }
        : wType === "operator"
          ? { operatorId: wId }
          : { employeeId: wId }
      : {};

  const [works, loaders, operators, employees] = await Promise.all([
    prisma.loadingWork.findMany({
      where: { date: { gte: from, lte: to }, ...workerWhere },
      include: { loader: true, operator: true, employee: true, brickSize: true },
      orderBy: { date: "desc" },
    }),
    prisma.loader.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.operator.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.employee.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);

  const workerGroups = [
    { label: "Loaders", items: loaders.map((l) => ({ key: `loader:${l.id}`, name: l.name })) },
    { label: "Operators", items: operators.map((o) => ({ key: `operator:${o.id}`, name: o.name })) },
    { label: "Drivers & staff", items: employees.map((e) => ({ key: `employee:${e.id}`, name: e.name })) },
  ].filter((g) => g.items.length > 0);

  return (
    <>
      <PageHeader
        title="Loading work"
        sub="Loading salary - paid by piece rate"
        right={
          <Link
            href="/loading/new"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-brand-red text-white text-[13px] font-semibold shadow-red"
          >
            <Icon.Plus size={16} stroke={2.4} /> New entry
          </Link>
        }
      />

      <div className="grid sm:grid-cols-3 gap-3 mb-5">
        <Card padding="tight">
          <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
            Bricks loaded
          </div>
          <div className="num display text-xl font-bold mt-0.5">
            {formatNumber(works.reduce((s, w) => s + w.brickCount, 0))}
          </div>
        </Card>
        <Card padding="tight">
          <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
            Loading salary
          </div>
          <div className="num display text-xl font-bold mt-0.5 text-brand-red">
            {formatINR(works.reduce((s, w) => s + w.totalAmount, 0))}
          </div>
        </Card>
        <Card padding="tight">
          <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
            Entries
          </div>
          <div className="num display text-xl font-bold mt-0.5">{works.length}</div>
        </Card>
      </div>

      <div className="mb-4 space-y-2">
        <Link
          href="/loading"
          className={`inline-flex px-3 py-1.5 rounded-full text-[12px] font-semibold ${
            !sp?.worker ? "bg-ink text-white" : "bg-white text-slate-700 border border-slate-200"
          }`}
        >
          All workers
        </Link>
        {workerGroups.map((g) => (
          <div key={g.label} className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 w-24 shrink-0">
              {g.label}
            </span>
            {g.items.map((w) => (
              <Link
                key={w.key}
                href={`/loading?worker=${w.key}`}
                className={`px-3 py-1.5 rounded-full text-[12px] font-semibold ${
                  sp?.worker === w.key
                    ? "bg-ink text-white"
                    : "bg-white text-slate-700 border border-slate-200"
                }`}
              >
                {w.name}
              </Link>
            ))}
          </div>
        ))}
      </div>

      {works.length === 0 ? (
        <EmptyState title="No loading work logged" />
      ) : (
        <div className="bg-white rounded-2xl border border-slate-900/[.06] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <Th>Date</Th>
                  <Th>Worker</Th>
                  <Th>Size</Th>
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
                    <Td className="font-semibold">
                      {w.loader?.name ?? w.operator?.name ?? w.employee?.name ?? "-"}
                    </Td>
                    <Td>{w.brickSize?.label ?? "-"}</Td>
                    <Td align="right" className="num">{formatNumber(w.brickCount)}</Td>
                    <Td align="right" className="num">₹{w.ratePerBrick}</Td>
                    <Td align="right" className="num font-bold">{formatINR(w.totalAmount)}</Td>
                    <Td align="right">
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          href={`/loading/${w.id}/edit`}
                          className="w-8 h-8 rounded-md hover:bg-slate-100 inline-flex items-center justify-center text-slate-500"
                          title="Edit"
                        >
                          <Icon.Pencil size={14} />
                        </Link>
                        <DeleteLoading id={w.id} />
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
