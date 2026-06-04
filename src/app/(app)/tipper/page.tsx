import Link from "next/link";
import { prisma } from "@/lib/db";
import { Card, PageHeader, Pill, EmptyState } from "@/components/ui";
import { Icon } from "@/components/icons";
import { formatINR, formatNumber, formatShortDate, startOfDay } from "@/lib/format";
import { DeleteTipperLoad } from "./delete-load";

export default async function TipperPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; tipper?: string }>;
}) {
  const sp = await searchParams;
  const today = startOfDay();
  const from = sp?.from ? new Date(sp.from) : new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  const to = sp?.to ? new Date(sp.to) : today;
  to.setHours(23, 59, 59, 999);

  const [loads, tippers] = await Promise.all([
    prisma.tipperLoad.findMany({
      where: {
        date: { gte: from, lte: to },
        ...(sp?.tipper ? { tipperId: sp.tipper } : {}),
      },
      include: { tipper: true, vendor: true, brickSize: true },
      orderBy: { date: "desc" },
    }),
    prisma.tipper.findMany({ where: { active: true }, include: { vendor: true } }),
  ]);

  const rentIn = loads
    .filter((l) => l.rentDirection === "in" && l.rentAmount > 0)
    .reduce((s, l) => s + l.rentAmount, 0);
  const rentOut = loads
    .filter((l) => l.rentDirection === "out" && l.rentAmount > 0)
    .reduce((s, l) => s + l.rentAmount, 0);

  return (
    <>
      <PageHeader
        title="Tipper loads"
        sub="Own RD trucks + vendor (AVM) trucks — bricks and raw materials"
        right={
          <Link
            href="/tipper/new"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-brand-red text-white text-[13px] font-semibold shadow-red"
          >
            <Icon.Plus size={16} stroke={2.4} /> New load
          </Link>
        }
      />

      <div className="grid sm:grid-cols-3 gap-3 mb-5">
        <Card padding="tight">
          <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
            Total loads
          </div>
          <div className="num display text-xl font-bold mt-0.5">{loads.length}</div>
        </Card>
        <Card padding="tight">
          <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
            Rent received
          </div>
          <div className="num display text-xl font-bold mt-0.5 text-emerald-700">
            {formatINR(rentIn)}
          </div>
        </Card>
        <Card padding="tight">
          <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
            Rent paid (vendors)
          </div>
          <div className="num display text-xl font-bold mt-0.5 text-brand-red">
            {formatINR(rentOut)}
          </div>
        </Card>
      </div>

      <div className="flex gap-1.5 overflow-x-auto no-scrollbar mb-4">
        <Link
          href="/tipper"
          className={`px-3 py-1.5 rounded-full text-[12px] font-semibold whitespace-nowrap ${
            !sp?.tipper ? "bg-ink text-white" : "bg-white text-slate-700 border border-slate-200"
          }`}
        >
          All tippers
        </Link>
        {tippers.map((t) => (
          <Link
            key={t.id}
            href={`/tipper?tipper=${t.id}`}
            className={`px-3 py-1.5 rounded-full text-[12px] font-semibold whitespace-nowrap ${
              sp?.tipper === t.id
                ? "bg-ink text-white"
                : "bg-white text-slate-700 border border-slate-200"
            }`}
          >
            {t.name}
            <span className="opacity-70 ml-1.5 mono text-[10px]">
              {t.ownership === "own" ? "RD" : t.vendor?.name ?? "vendor"}
            </span>
          </Link>
        ))}
      </div>

      {loads.length === 0 ? (
        <EmptyState
          title="No tipper loads"
          sub="Record a delivery (bricks or raw material) to start tracking transport."
        />
      ) : (
        <div className="bg-white rounded-2xl border border-slate-900/[.06] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <Th>Date</Th>
                  <Th>Tipper</Th>
                  <Th>Load</Th>
                  <Th align="right">Qty</Th>
                  <Th>From → To</Th>
                  <Th align="right">Rent</Th>
                  <Th align="right">Action</Th>
                </tr>
              </thead>
              <tbody>
                {loads.map((l) => (
                  <tr key={l.id} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50">
                    <Td>{formatShortDate(l.date)}</Td>
                    <Td>
                      <div className="font-semibold">{l.tipper.name}</div>
                      <div className="text-[11px] text-slate-500">
                        {l.tipper.ownership === "own" ? "RD-own" : l.vendor?.name ?? "vendor"}
                      </div>
                    </Td>
                    <Td>
                      {l.loadType === "bricks" ? (
                        <Pill tone="red">
                          {l.brickSize?.label ?? "—"} bricks
                        </Pill>
                      ) : (
                        <Pill tone="blue">{l.materialName ?? "Material"}</Pill>
                      )}
                    </Td>
                    <Td align="right" className="num">
                      {formatNumber(l.quantity)} <span className="text-[11px] text-slate-500">{l.unit}</span>
                    </Td>
                    <Td className="text-slate-600">
                      <span className="text-[12px]">
                        {l.fromLocation ?? "—"} → {l.toLocation ?? "—"}
                      </span>
                    </Td>
                    <Td align="right">
                      {l.rentAmount > 0 ? (
                        <span
                          className={`num font-bold ${
                            l.rentDirection === "in" ? "text-emerald-700" : "text-brand-red"
                          }`}
                        >
                          {l.rentDirection === "in" ? "+" : "−"}
                          {formatINR(l.rentAmount)}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </Td>
                    <Td align="right">
                      <DeleteTipperLoad id={l.id} />
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
