import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { MasterList } from "@/components/master-list";
import { createBrickSize, updateBrickSize, deleteBrickSize } from "../actions";

export default async function BrickSizesPage() {
  const rows = await prisma.brickSize.findMany({ orderBy: { order: "asc" } });
  return (
    <>
      <PageHeader title="Brick sizes" sub='Add the brick sizes your factory makes (e.g. 6", 6"H, 8")' back="/settings" />
      <MasterList
        rows={rows.map((r) => ({ id: r.id, label: r.label, order: r.order }))}
        fields={[
          { type: "text", key: "label", label: "Label", required: true, placeholder: 'e.g. 6"' },
          { type: "number", key: "order", label: "Display order", placeholder: "0" },
        ]}
        columns={[
          { key: "label", header: "Label", format: "bold" },
          { key: "order", header: "Order", format: "number" },
        ]}
        onCreate={async (d) => {
          "use server";
          await createBrickSize({ label: String(d.label), order: Number(d.order || 0) });
        }}
        onUpdate={async (id, d) => {
          "use server";
          await updateBrickSize(id, { label: String(d.label), order: Number(d.order || 0) });
        }}
        onDelete={async (id) => {
          "use server";
          await deleteBrickSize(id);
        }}
        addLabel="Add size"
        emptyText="No brick sizes yet. Add one to get started."
      />
    </>
  );
}
