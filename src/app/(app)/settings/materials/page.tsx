import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { MasterList } from "@/components/master-list";
import { RecipeEditor } from "./recipe-editor";
import { createMaterial, updateMaterial, deleteMaterial, upsertRecipe } from "../actions";

export default async function MaterialsPage() {
  const [rows, sizes, recipes, settings] = await Promise.all([
    prisma.material.findMany({ orderBy: { name: "asc" } }),
    prisma.brickSize.findMany({ orderBy: { order: "asc" } }),
    prisma.materialRecipe.findMany(),
    prisma.settings.findUnique({ where: { id: "default" } }),
  ]);
  const basis = settings?.materialBasis ?? 1000;

  const recipeMap: Record<string, number> = {};
  for (const r of recipes) recipeMap[`${r.materialId}_${r.brickSizeId}`] = r.qtyPer1000;

  return (
    <>
      <PageHeader title="Raw materials" sub="Cement, flyash, powder, chips, admixer, sludge…" back="/settings" />
      <MasterList
        rows={rows.map((r) => ({ id: r.id, name: r.name, unit: r.unit }))}
        fields={[
          { type: "text", key: "name", label: "Name", required: true },
          { type: "text", key: "unit", label: "Unit", placeholder: "bag / kg / unit", required: true },
        ]}
        columns={[
          { key: "name", header: "Name", format: "bold" },
          { key: "unit", header: "Unit" },
        ]}
        onCreate={async (d) => {
          "use server";
          await createMaterial({ name: String(d.name), unit: String(d.unit) });
        }}
        onUpdate={async (id, d) => {
          "use server";
          await updateMaterial(id, { name: String(d.name), unit: String(d.unit) });
        }}
        onDelete={async (id) => {
          "use server";
          await deleteMaterial(id);
        }}
        addLabel="Add material"
      />

      <div className="mt-6">
        <div className="text-[13px] font-bold text-ink mb-1">
          Usage per {basis.toLocaleString("en-IN")} bricks
        </div>
        <div className="text-[11px] text-slate-500 mb-2.5">
          How much of each material a batch consumes, by brick size. Production
          decrements stock from these. Only cement can be adjusted per entry.
          Change the {basis.toLocaleString("en-IN")}-brick basis in Settings → Factory profile.
        </div>
        <RecipeEditor
          materials={rows.map((m) => ({ id: m.id, name: m.name, unit: m.unit }))}
          sizes={sizes.map((s) => ({ id: s.id, label: s.label }))}
          values={recipeMap}
          basis={basis}
          onSave={async (data) => {
            "use server";
            await upsertRecipe(data);
          }}
        />
      </div>
    </>
  );
}
