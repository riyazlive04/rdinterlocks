import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader, Card } from "@/components/ui";
import { DaySheet } from "./sheet";
import { createDailyProduction } from "../production/actions";

export default async function DaySheetPage() {
  const [sizes, operators, machines, settings] = await Promise.all([
    prisma.brickSize.findMany({ orderBy: { order: "asc" } }),
    prisma.operator.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.machine.findMany({ where: { active: true }, orderBy: { order: "asc" } }),
    prisma.settings.findUnique({ where: { id: "default" } }),
  ]);

  if (sizes.length === 0 || operators.length === 0) {
    return (
      <>
        <PageHeader title="Daily entry" back="/production" />
        <Card>
          <div className="p-6 text-center text-sm text-slate-500">
            Add at least one brick size and one operator first.
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Daily entry sheet"
        sub="Quick diary-style entry — set the day once, add a row per brick size"
        right={
          <Link
            href="/production/new"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 text-[13px] font-semibold hover:border-slate-400"
          >
            Detailed form
          </Link>
        }
      />
      <DaySheet
        sizes={sizes.map((s) => ({ id: s.id, label: s.label, dayRate: s.dayRate, nightRate: s.nightRate }))}
        operators={operators.map((o) => ({ id: o.id, name: o.name }))}
        machines={machines.map((m) => ({ id: m.id, name: m.name }))}
        cementBagsPer1000={settings?.cementBagsPer1000 ?? 18}
        dayShiftRate={settings?.dayShiftRate ?? 2.5}
        nightShiftRate={settings?.nightShiftRate ?? 3.0}
        onSubmit={async (d) => {
          "use server";
          await createDailyProduction(d);
        }}
      />
    </>
  );
}
