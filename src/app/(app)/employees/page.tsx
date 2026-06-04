import Link from "next/link";
import { prisma } from "@/lib/db";
import { Avatar, Card, PageHeader, Pill, EmptyState } from "@/components/ui";
import { Icon } from "@/components/icons";
import { formatINR, startOfDay, endOfDay } from "@/lib/format";

export default async function EmployeesPage() {
  const today = startOfDay();
  const [employees, attendance, advances] = await Promise.all([
    prisma.employee.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.employeeAttendance.findMany({ where: { date: { gte: today, lte: endOfDay() } } }),
    prisma.advance.findMany({ where: { personType: "employee", settled: false } }),
  ]);

  const attMap = new Map(attendance.map((a) => [a.employeeId, a.status]));
  const advMap: Record<string, number> = {};
  for (const a of advances) {
    if (a.employeeId) advMap[a.employeeId] = (advMap[a.employeeId] ?? 0) + a.amount;
  }

  return (
    <>
      <PageHeader
        title="Employees"
        sub="Drivers, watchmen, and other staff — attendance + salary"
        right={
          <Link
            href="/settings/employees"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 text-slate-700 text-[13px] font-semibold hover:bg-slate-200"
          >
            <Icon.Settings size={16} /> Manage
          </Link>
        }
      />

      {employees.length === 0 ? (
        <EmptyState
          title="No employees yet"
          sub="Add staff in Settings to start tracking attendance and salary."
          action={
            <Link
              href="/settings/employees"
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-brand-red text-white text-[13px] font-semibold"
            >
              <Icon.Plus size={16} /> Add employee
            </Link>
          }
        />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {employees.map((e) => {
            const status = attMap.get(e.id) ?? "—";
            const advance = advMap[e.id] ?? 0;
            const dot =
              status === "present"
                ? "#10B981"
                : status === "absent"
                  ? "#DC2626"
                  : status === "leave"
                    ? "#F59E0B"
                    : "#CBD5E1";
            return (
              <Link
                key={e.id}
                href={`/employees/${e.id}`}
                className="bg-white rounded-2xl p-4 border border-slate-200 hover:border-slate-400 transition flex items-center gap-3"
              >
                <div className="relative">
                  <Avatar name={e.name} size={44} />
                  <div
                    className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white"
                    style={{ background: dot }}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-bold text-ink">{e.name}</div>
                  <div className="text-[11px] text-slate-500">
                    {e.role} · {e.payType} ₹{e.payRate.toLocaleString("en-IN")}
                  </div>
                  <div className="flex gap-1.5 mt-1">
                    <Pill tone="slate">{status}</Pill>
                    {advance > 0 && (
                      <Pill tone="red">{formatINR(advance, { compact: true })} advance</Pill>
                    )}
                  </div>
                </div>
                <Icon.Chevron size={16} color="#94A3B8" />
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
