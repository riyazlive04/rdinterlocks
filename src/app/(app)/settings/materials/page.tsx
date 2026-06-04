import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { MasterList } from "@/components/master-list";
import { createMaterial, updateMaterial, deleteMaterial } from "../actions";

export default async function MaterialsPage() {
  const rows = await prisma.material.findMany({ orderBy: { order: "asc" } });
  return (
    <>
      <PageHeader title="Raw materials" sub="Cement, flyash, powder, chips, admixer, sludge…" back="/settings" />
      <MasterList
        rows={rows.map((r) => ({ id: r.id, name: r.name, unit: r.unit, order: r.order }))}
        fields={[
          { type: "text", key: "name", label: "Name", required: true },
          { type: "text", key: "unit", label: "Unit", placeholder: "bag / kg / unit", required: true },
          { type: "number", key: "order", label: "Display order" },
        ]}
        columns={[
          { key: "name", header: "Name", format: "bold" },
          { key: "unit", header: "Unit" },
          { key: "order", header: "Order", format: "number" },
        ]}
        onCreate={async (d) => {
          "use server";
          await createMaterial({ name: String(d.name), unit: String(d.unit), order: Number(d.order || 0) });
        }}
        onUpdate={async (id, d) => {
          "use server";
          await updateMaterial(id, { name: String(d.name), unit: String(d.unit), order: Number(d.order || 0) });
        }}
        onDelete={async (id) => {
          "use server";
          await deleteMaterial(id);
        }}
        addLabel="Add material"
      />
    </>
  );
}
