import { prisma } from "@/lib/db";
import { PageHeader, Card } from "@/components/ui";
import { ProductionForm } from "./form";
import { createProduction } from "../actions";

export default async function NewProductionPage() {
  const [sizes, operators, machines, settings, recipes] = await Promise.all([
    prisma.brickSize.findMany({ orderBy: { order: "asc" } }),
    prisma.operator.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.machine.findMany({ where: { active: true }, orderBy: { order: "asc" } }),
    prisma.settings.findUnique({ where: { id: "default" } }),
    prisma.materialRecipe.findMany({
      include: { material: true, brickSize: true },
    }),
  ]);
  if (sizes.length === 0 || operators.length === 0) {
    return (
      <>
        <PageHeader title="New production" back="/production" />
        <Card>
          <div className="p-6 text-center text-sm text-slate-500">
            <p>You need at least one brick size and one operator before recording production.</p>
            <p className="mt-2">
              <a href="/settings/brick-sizes" className="text-brand-blue underline">Add brick sizes</a> ·{" "}
              <a href="/settings/operators" className="text-brand-blue underline">Add operators</a>
            </p>
          </div>
        </Card>
      </>
    );
  }
  // Build a recipe map: brickSizeId -> [{ name, unit, qtyPer1000 }]
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
      <PageHeader title="New production entry" back="/production" />
      <ProductionForm
        sizes={sizes.map((s) => ({ id: s.id, label: s.label }))}
        operators={operators.map((o) => ({ id: o.id, name: o.name }))}
        machines={machines.map((m) => ({ id: m.id, name: m.name }))}
        cementBagsPer1000={settings?.cementBagsPer1000 ?? 18}
        dayShiftRate={settings?.dayShiftRate ?? 2.5}
        nightShiftRate={settings?.nightShiftRate ?? 3.0}
        recipes={recipeMap}
        onSubmit={async (d) => {
          "use server";
          await createProduction(d);
        }}
      />
    </>
  );
}
