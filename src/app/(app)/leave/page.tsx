import { prisma } from "@/lib/db";
import { PageHeader, Card, EmptyState, Pill } from "@/components/ui";
import { requireArea } from "@/lib/auth";
import { formatShortDate, startOfDay } from "@/lib/format";
import { MarkLeaveForm } from "./mark-form";
import { DeleteLeave } from "./delete-button";
import { createLeaves } from "./actions";

export default async function LeavePage() {
  await requireArea("leave");
  const since = new Date(startOfDay().getTime() - 30 * 86400000);

  const [operators, loaders, masons, employees, leaves] = await Promise.all([
    prisma.operator.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.loader.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.mason.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.employee.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.leave.findMany({
      where: { date: { gte: since } },
      include: { operator: true, loader: true, mason: true, employee: true },
      orderBy: { date: "desc" },
    }),
  ]);

  const workers = {
    operators: operators.map((o) => ({ type: "operator" as const, id: o.id, name: o.name })),
    loaders: loaders.map((l) => ({ type: "loader" as const, id: l.id, name: l.name })),
    masons: masons.map((m) => ({ type: "mason" as const, id: m.id, name: m.name })),
    employees: employees.map((e) => ({ type: "employee" as const, id: e.id, name: e.name })),
  };

  // Group recent leaves by day.
  const groups: Array<{ key: string; date: Date; rows: typeof leaves }> = [];
  for (const l of leaves) {
    const key = l.date.toDateString();
    let g = groups.find((x) => x.key === key);
    if (!g) {
      g = { key, date: l.date, rows: [] };
      groups.push(g);
    }
    g.rows.push(l);
  }

  return (
    <>
      <PageHeader
        title="Leave"
        sub="Mark days off for anyone. A person not marked is treated as working that day."
      />

      <MarkLeaveForm
        workers={workers}
        onSubmit={async (d) => {
          "use server";
          await createLeaves(d);
        }}
      />

      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
        Recent leave (last 30 days)
      </div>
      {leaves.length === 0 ? (
        <EmptyState title="No leave marked" sub="Mark a leave above and it will show here." />
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.key}>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2 px-1">
                {formatShortDate(g.date)} · {g.rows.length} on leave
              </div>
              <div className="bg-white rounded-2xl border border-slate-900/[.06] divide-y divide-slate-100">
                {g.rows.map((l) => {
                  const name =
                    l.operator?.name ?? l.loader?.name ?? l.mason?.name ?? l.employee?.name ?? "-";
                  return (
                    <div key={l.id} className="flex items-center gap-3 p-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-semibold text-ink">{name}</div>
                        {l.reason && <div className="text-[11px] text-slate-500">{l.reason}</div>}
                      </div>
                      <Pill tone="slate">{l.personType}</Pill>
                      <DeleteLeave id={l.id} />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
