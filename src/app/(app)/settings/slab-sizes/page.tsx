import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { MasterList } from "@/components/master-list";
import { createSlabSize, updateSlabSize, deleteSlabSize } from "../actions";

export default async function SlabSizesPage() {
  const rows = await prisma.slabSize.findMany({ orderBy: { order: "asc" } });
  return (
    <>
      <PageHeader
        title="Lintel slab sizes"
        sub="Sizes offered for lintel slabs (e.g. 4, 5, 6) - used on client orders"
        back="/settings"
      />
      <MasterList
        rows={rows.map((r) => ({ id: r.id, label: r.label, order: r.order }))}
        fields={[
          { type: "text", key: "label", label: "Size", required: true, placeholder: "e.g. 6" },
          { type: "number", key: "order", label: "Display order", placeholder: "0" },
        ]}
        columns={[
          { key: "label", header: "Size", format: "bold" },
          { key: "order", header: "Order", format: "number" },
        ]}
        onCreate={async (d) => {
          "use server";
          await createSlabSize({ label: String(d.label), order: Number(d.order || 0) });
        }}
        onUpdate={async (id, d) => {
          "use server";
          await updateSlabSize(id, { label: String(d.label), order: Number(d.order || 0) });
        }}
        onDelete={async (id) => {
          "use server";
          await deleteSlabSize(id);
        }}
        addLabel="Add size"
        emptyText="No lintel slab sizes yet. Add 4, 5, 6 to get started."
      />
    </>
  );
}
