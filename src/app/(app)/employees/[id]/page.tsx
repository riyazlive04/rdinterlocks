import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { Avatar, Card, PageHeader, Pill } from "@/components/ui";
import { Icon } from "@/components/icons";
import {
  formatINR,
  formatLongDate,
  formatShortDate,
  startOfDay,
  startOfMonth,
} from "@/lib/format";
import { AttendanceControls } from "./attendance-controls";
import { AdvanceForm } from "./advance-form";
import { PayoutForm } from "./payout-form";
import { setAttendance, giveEmployeeAdvance, recordPayout } from "../actions";

export default async function EmployeeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const employee = await prisma.employee.findUnique({ where: { id } });
  if (!employee) notFound();

  const today = startOfDay();
  const monthStart = startOfMonth();

  const [attToday, attMonth, advances, payouts] = await Promise.all([
    prisma.employeeAttendance.findUnique({
      where: { date_employeeId: { date: today, employeeId: id } },
    }),
    prisma.employeeAttendance.findMany({
      where: { employeeId: id, date: { gte: monthStart } },
    }),
    prisma.advance.findMany({
      where: { employeeId: id },
      orderBy: { date: "desc" },
      take: 10,
    }),
    prisma.employeePayout.findMany({
      where: { employeeId: id },
      orderBy: { date: "desc" },
      take: 6,
    }),
  ]);

  const present = attMonth.filter((a) => a.status === "present").length;
  const absent = attMonth.filter((a) => a.status === "absent").length;
  const leave = attMonth.filter((a) => a.status === "leave").length;
  const halfDay = attMonth.filter((a) => a.status === "half").length;
  const openAdvances = advances
    .filter((a) => !a.settled)
    .reduce((s, a) => s + a.amount, 0);

  // Prefill payout for current period
  const payoutBase =
    employee.payType === "monthly"
      ? employee.payRate
      : employee.payType === "daily"
        ? employee.payRate * (present + halfDay * 0.5)
        : 0;

  return (
    <>
      <PageHeader
        title={employee.name}
        sub={`${employee.role} · ${employee.payType} · ₹${employee.payRate.toLocaleString("en-IN")}`}
        back="/employees"
      />

      <div className="grid sm:grid-cols-4 gap-3 mb-5">
        <Card padding="tight">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
            Present
          </div>
          <div className="num display text-xl font-bold text-emerald-700 mt-0.5">{present}</div>
        </Card>
        <Card padding="tight">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
            Absent
          </div>
          <div className="num display text-xl font-bold text-brand-red mt-0.5">{absent}</div>
        </Card>
        <Card padding="tight">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
            Leave / Half
          </div>
          <div className="num display text-xl font-bold mt-0.5">
            {leave} / {halfDay}
          </div>
        </Card>
        <Card padding="tight" className={openAdvances > 0 ? "border-2 border-brand-red/30" : ""}>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
            Open advances
          </div>
          <div className="num display text-xl font-bold text-brand-red mt-0.5">
            {formatINR(openAdvances)}
          </div>
        </Card>
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <Card>
            <div className="flex items-baseline justify-between mb-3">
              <h3 className="text-base font-bold">Today&apos;s attendance</h3>
              <span className="text-[11px] text-slate-500">{formatLongDate(new Date())}</span>
            </div>
            <AttendanceControls
              employeeId={id}
              current={attToday?.status ?? null}
              onSet={async (status) => {
                "use server";
                await setAttendance(id, today.toISOString(), status);
              }}
            />
          </Card>

          <Card>
            <h3 className="text-base font-bold mb-3">Salary payout</h3>
            <PayoutForm
              employeeId={id}
              defaultBase={payoutBase}
              defaultPeriodStart={monthStart.toISOString().slice(0, 10)}
              defaultPeriodEnd={new Date().toISOString().slice(0, 10)}
              defaultAdvanceTotal={openAdvances}
              onSubmit={async (d) => {
                "use server";
                await recordPayout(d);
              }}
            />
          </Card>

          <Card>
            <h3 className="text-base font-bold mb-3">Recent payouts</h3>
            {payouts.length === 0 ? (
              <div className="text-center text-sm text-slate-500 py-4">No payouts yet.</div>
            ) : (
              <div className="bg-white rounded-xl border border-slate-100 divide-y divide-slate-100">
                {payouts.map((p) => (
                  <div key={p.id} className="flex justify-between items-center p-2.5">
                    <div>
                      <div className="text-[13px] font-semibold">
                        {formatShortDate(p.periodStart)} → {formatShortDate(p.periodEnd)}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Base ₹{p.baseAmount} {p.bonus > 0 ? `· bonus ₹${p.bonus}` : ""}
                        {p.advancesSettled > 0 ? ` · advances ₹${p.advancesSettled}` : ""}
                      </div>
                    </div>
                    <div className="num text-sm font-bold text-emerald-700">
                      {formatINR(p.netPaid)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <h3 className="text-base font-bold mb-3">Give advance</h3>
            <AdvanceForm
              employeeId={id}
              onSubmit={async (d) => {
                "use server";
                await giveEmployeeAdvance(d);
              }}
            />
          </Card>

          {advances.length > 0 && (
            <Card>
              <h3 className="text-base font-bold mb-3">Advance history</h3>
              <div className="divide-y divide-slate-100">
                {advances.map((a) => (
                  <div key={a.id} className="flex justify-between items-center py-2">
                    <div>
                      <div className="text-[12px] font-semibold">
                        {a.notes ?? "Advance"}
                      </div>
                      <div className="text-[10px] text-slate-500">{formatShortDate(a.date)}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Pill tone={a.settled ? "success" : "warning"}>
                        {a.settled ? "Settled" : "Open"}
                      </Pill>
                      <span className="num text-[13px] font-bold text-brand-red">
                        −{formatINR(a.amount)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
