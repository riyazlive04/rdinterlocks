import Link from "next/link";
import { prisma } from "@/lib/db";
import { Card, PageHeader } from "@/components/ui";
import { requireArea } from "@/lib/auth";
import { Icon } from "@/components/icons";
import { formatINR } from "@/lib/format";
import { PayrollAdvanceForm } from "./advance-form";
import { createWorkerAdvance } from "./actions";

const monthNames = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function monthBounds(monthParam?: string) {
  let base = new Date();
  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    const [y, m] = monthParam.split("-").map(Number);
    base = new Date(y, m - 1, 1);
  }
  const start = new Date(base.getFullYear(), base.getMonth(), 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(base.getFullYear(), base.getMonth() + 1, 0);
  end.setHours(23, 59, 59, 999);
  const key = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}`;
  const prevD = new Date(base.getFullYear(), base.getMonth() - 1, 1);
  const nextD = new Date(base.getFullYear(), base.getMonth() + 1, 1);
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  return {
    start,
    end,
    key,
    label: `${monthNames[base.getMonth()]} ${base.getFullYear()}`,
    prev: fmt(prevD),
    next: fmt(nextD),
  };
}

type Row = { id: string; name: string; earned: number; advances: number; paid: number };

export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  await requireArea("payroll");
  const sp = await searchParams;
  const { start, end, label, prev, next } = monthBounds(sp?.month);
  const range = { gte: start, lte: end };

  const [operators, masons, loaders, employees, openAdvances, payouts] = await Promise.all([
    prisma.operator.findMany({
      where: { active: true },
      include: {
        productionShares: { where: { productionEntry: { date: range } } },
        loadingWorks: { where: { date: range } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.mason.findMany({
      where: { active: true },
      include: { works: { where: { date: range } } },
      orderBy: { name: "asc" },
    }),
    prisma.loader.findMany({
      where: { active: true },
      include: { works: { where: { date: range } } },
      orderBy: { name: "asc" },
    }),
    prisma.employee.findMany({
      where: { active: true },
      include: {
        attendance: { where: { date: range } },
        loadingWorks: { where: { date: range } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.advance.findMany({ where: { settled: false } }),
    prisma.employeePayout.findMany({ where: { date: range } }),
  ]);

  const advanceFor = (key: "operatorId" | "masonId" | "loaderId" | "employeeId", id: string) =>
    openAdvances.filter((a) => a[key] === id).reduce((s, a) => s + a.amount, 0);

  const operatorRows: Row[] = operators.map((o) => ({
    id: o.id,
    name: o.name,
    earned:
      o.productionShares.reduce((s, x) => s + x.amount, 0) +
      o.loadingWorks.reduce((s, w) => s + w.totalAmount, 0),
    advances: advanceFor("operatorId", o.id),
    paid: 0,
  }));
  const masonRows: Row[] = masons.map((m) => ({
    id: m.id,
    name: m.name,
    earned: m.works.reduce((s, w) => s + w.totalAmount, 0),
    advances: advanceFor("masonId", m.id),
    paid: 0,
  }));
  const loaderRows: Row[] = loaders.map((l) => ({
    id: l.id,
    name: l.name,
    earned: l.works.reduce((s, w) => s + w.totalAmount, 0),
    advances: advanceFor("loaderId", l.id),
    paid: 0,
  }));
  const employeeRows: Row[] = employees.map((e) => {
    const present = e.attendance.filter((a) => a.status === "present").length;
    const half = e.attendance.filter((a) => a.status === "half").length;
    const earned =
      e.payType === "monthly"
        ? e.payRate
        : e.payType === "daily"
          ? e.payRate * (present + half * 0.5)
          : 0;
    const loadingEarned = e.loadingWorks.reduce((s, w) => s + w.totalAmount, 0);
    const paid = payouts
      .filter((p) => p.employeeId === e.id)
      .reduce((s, p) => s + p.netPaid, 0);
    return {
      id: e.id,
      name: e.name,
      earned: earned + loadingEarned,
      advances: advanceFor("employeeId", e.id),
      paid,
    };
  });

  const sections = [
    { title: "Operators (production)", href: "/settings/operators", rows: operatorRows, linkBase: "" },
    { title: "Masons", href: "/mason", rows: masonRows, linkBase: "" },
    { title: "Loaders", href: "/loading", rows: loaderRows, linkBase: "" },
    { title: "Employees (salary)", href: "/employees", rows: employeeRows, linkBase: "/employees/" },
  ];

  const net = (r: Row) => Math.max(0, r.earned - r.advances - r.paid);
  const grand = {
    earned: [...operatorRows, ...masonRows, ...loaderRows, ...employeeRows].reduce((s, r) => s + r.earned, 0),
    advances: [...operatorRows, ...masonRows, ...loaderRows, ...employeeRows].reduce((s, r) => s + r.advances, 0),
    paid: [...operatorRows, ...masonRows, ...loaderRows, ...employeeRows].reduce((s, r) => s + r.paid, 0),
    net: [...operatorRows, ...masonRows, ...loaderRows, ...employeeRows].reduce((s, r) => s + net(r), 0),
  };

  const advanceGroups = [
    { type: "operator" as const, label: "Operators", people: operators.map((o) => ({ id: o.id, name: o.name })) },
    { type: "mason" as const, label: "Masons", people: masons.map((m) => ({ id: m.id, name: m.name })) },
    { type: "loader" as const, label: "Loaders", people: loaders.map((l) => ({ id: l.id, name: l.name })) },
    { type: "employee" as const, label: "Employees", people: employees.map((e) => ({ id: e.id, name: e.name })) },
  ];

  return (
    <>
      <PageHeader title="Payroll" sub="Everyone's wages & salary for the month, in one place" />

      <PayrollAdvanceForm
        groups={advanceGroups}
        onSubmit={async (d) => {
          "use server";
          await createWorkerAdvance(d);
        }}
      />

      <Card className="mb-4">
        <div className="flex items-center justify-between">
          <Link
            href={`/payroll?month=${prev}`}
            className="w-9 h-9 rounded-lg bg-slate-100 hover:bg-slate-200 inline-flex items-center justify-center"
          >
            <Icon.Chevron size={16} className="rotate-180" />
          </Link>
          <div className="text-center">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Period</div>
            <div className="text-lg font-bold text-ink">{label}</div>
          </div>
          <Link
            href={`/payroll?month=${next}`}
            className="w-9 h-9 rounded-lg bg-slate-100 hover:bg-slate-200 inline-flex items-center justify-center"
          >
            <Icon.Chevron size={16} />
          </Link>
        </div>
      </Card>

      <div className="grid sm:grid-cols-4 gap-3 mb-5">
        <Stat label="Total earned" value={formatINR(grand.earned)} />
        <Stat label="Open advances" value={formatINR(grand.advances)} color="text-amber-700" />
        <Stat label="Paid this month" value={formatINR(grand.paid)} color="text-emerald-700" />
        <Stat label="Net still payable" value={formatINR(grand.net)} color="text-brand-red" big />
      </div>

      <div className="space-y-5">
        {sections.map((sec) => {
          const subtotal = sec.rows.reduce((s, r) => s + net(r), 0);
          return (
            <div key={sec.title}>
              <div className="flex items-baseline justify-between mb-2">
                <h2 className="text-base font-bold text-ink">{sec.title}</h2>
                <span className="text-[12px] text-slate-500">
                  Net payable <span className="num font-bold text-ink">{formatINR(subtotal)}</span>
                </span>
              </div>
              {sec.rows.length === 0 ? (
                <Card>
                  <div className="text-center text-sm text-slate-500 py-4">No one in this group.</div>
                </Card>
              ) : (
                <div className="bg-white rounded-2xl border border-slate-900/[.06] overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-[13px]">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                          <Th>Name</Th>
                          <Th align="right">Earned</Th>
                          <Th align="right">Advances</Th>
                          {sec.linkBase ? <Th align="right">Paid</Th> : null}
                          <Th align="right">Net payable</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {sec.rows.map((r) => (
                          <tr key={r.id} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50">
                            <Td className="font-semibold">
                              {sec.linkBase ? (
                                <Link href={`${sec.linkBase}${r.id}`} className="text-brand-blue hover:underline">
                                  {r.name}
                                </Link>
                              ) : (
                                r.name
                              )}
                            </Td>
                            <Td align="right" className="num">{formatINR(r.earned)}</Td>
                            <Td align="right" className="num text-amber-700">
                              {r.advances > 0 ? `−${formatINR(r.advances)}` : "—"}
                            </Td>
                            {sec.linkBase ? (
                              <Td align="right" className="num text-emerald-700">
                                {r.paid > 0 ? formatINR(r.paid) : "—"}
                              </Td>
                            ) : null}
                            <Td align="right" className="num font-bold">{formatINR(net(r))}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="text-[11px] text-slate-500 mt-4">
        Net payable = earned − open advances − already paid this month. Operator wages come from
        production splits; mason/loader from their work logs; employee salary from pay type &
        attendance. Record actual payments from each person&apos;s page so the cash book stays in sync.
      </div>
    </>
  );
}

function Stat({ label, value, color, big }: { label: string; value: string; color?: string; big?: boolean }) {
  return (
    <Card padding="tight" className={big ? "border-2 border-brand-red/30" : ""}>
      <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">{label}</div>
      <div className={`num display text-xl font-bold mt-0.5 ${color ?? "text-ink"}`}>{value}</div>
    </Card>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "right" | "left" | "center" }) {
  return (
    <th
      className={`px-3 py-2.5 font-semibold text-slate-600 uppercase tracking-wider text-[10px] ${
        align === "right" ? "text-right" : "text-left"
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
    <td className={`px-3 py-2.5 ${align === "right" ? "text-right" : "text-left"} ${className ?? ""}`}>
      {children}
    </td>
  );
}
