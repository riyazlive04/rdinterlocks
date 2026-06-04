import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { MasterList } from "@/components/master-list";
import { createConstructionType, updateConstructionType, deleteConstructionType } from "../actions";

export default async function ConstructionTypesPage() {
  const rows = await prisma.constructionType.findMany({ orderBy: { order: "asc" } });
  return (
    <>
      <PageHeader
        title="Construction types"
        sub="Where the bricks get used — e.g. Room, Compound, Godown, Foundation"
        back="/settings"
      />
      <MasterList
        rows={rows.map((r) => ({ id: r.id, name: r.name, order: r.order }))}
        fields={[
          { type: "text", key: "name", label: "Name", required: true, placeholder: "e.g. Room" },
          { type: "number", key: "order", label: "Display order" },
        ]}
        columns={[
          { key: "name", header: "Name", format: "bold" },
          { key: "order", header: "Order", format: "number" },
        ]}
        onCreate={async (d) => {
          "use server";
          await createConstructionType({ name: String(d.name), order: Number(d.order || 0) });
        }}
        onUpdate={async (id, d) => {
          "use server";
          await updateConstructionType(id, { name: String(d.name), order: Number(d.order || 0) });
        }}
        onDelete={async (id) => {
          "use server";
          await deleteConstructionType(id);
        }}
        addLabel="Add type"
      />
    </>
  );
}
