import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader, Card } from "@/components/ui";
import { ProductionForm } from "../../new/form";
import { updateProduction } from "../../actions";
import { formatISODate } from "@/lib/format";

export default async function EditProductionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [entry, sizes, operators, machines, settings, recipes] = await Promise.all([
    prisma.productionEntry.findUnique({ where: { id }, include: { shares: true } }),
    prisma.brickSize.findMany({ orderBy: { order: "asc" } }),
    prisma.operator.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.machine.findMany({ where: { active: true }, orderBy: { order: "asc" } }),
    prisma.settings.findUnique({ where: { id: "default" } }),
    prisma.materialRecipe.findMany({ include: { material: true, brickSize: true } }),
  ]);
  if (!entry) notFound();
  if (sizes.length === 0 || operators.length === 0) {
    return (
      <>
        <PageHeader title="Edit production" back="/production" />
        <Card>
          <div className="p-6 text-center text-sm text-slate-500">
            You need at least one brick size and one operator.
          </div>
        </Card>
      </>
    );
  }
  const recipeMap: Record<string, Array<{ name: string; unit: string; qtyPer1000: number }>> = {};
  for (const r of recipes) {
    (recipeMap[r.brickSizeId] ??= []).push({
      name: r.material.name,
      unit: r.material.unit,
      qtyPer1000: r.qtyPer1000,
    });
  }
  return (
    <>
      <PageHeader title="Edit production entry" back="/production" />
      <ProductionForm
        sizes={sizes.map((s) => ({ id: s.id, label: s.label, dayRate: s.dayRate, nightRate: s.nightRate }))}
        operators={operators.map((o) => ({ id: o.id, name: o.name }))}
        machines={machines.map((m) => ({ id: m.id, name: m.name }))}
        cementBagsPer1000={settings?.cementBagsPer1000 ?? 18}
        dayShiftRate={settings?.dayShiftRate ?? 2.5}
        nightShiftRate={settings?.nightShiftRate ?? 3.0}
        recipes={recipeMap}
        initial={{
          date: formatISODate(entry.date),
          shift: entry.shift as "day" | "night",
          machineId: entry.machineId ?? undefined,
          brickSizeId: entry.brickSizeId,
          brickCount: entry.brickCount,
          damagedCount: entry.damagedCount,
          cementBagsUsed: entry.cementBagsUsed,
          ratePerBrick: entry.ratePerBrick,
          operatorIds: entry.shares.map((s) => s.operatorId),
          notes: entry.notes ?? undefined,
        }}
        submitLabel="Save changes"
        onSubmit={async (d) => {
          "use server";
          await updateProduction(id, d);
        }}
      />
    </>
  );
}
