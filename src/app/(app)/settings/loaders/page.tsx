import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { MasterList } from "@/components/master-list";
import { createLoader, updateLoader, deleteLoader } from "../actions";

export default async function LoadersPage() {
  const rows = await prisma.loader.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  return (
    <>
      <PageHeader title="Loaders" sub="Truck loading workers (piece-rate)" back="/settings" />
      <MasterList
        rows={rows.map((r) => ({ id: r.id, name: r.name, phone: r.phone ?? "" }))}
        fields={[
          { type: "text", key: "name", label: "Name", required: true },
          { type: "text", key: "phone", label: "Phone" },
        ]}
        columns={[
          { key: "name", header: "Name", format: "bold" },
          { key: "phone", header: "Phone", format: "mono" },
        ]}
        onCreate={async (d) => {
          "use server";
          await createLoader({ name: String(d.name), phone: String(d.phone || "") });
        }}
        onUpdate={async (id, d) => {
          "use server";
          await updateLoader(id, { name: String(d.name), phone: String(d.phone || "") });
        }}
        onDelete={async (id) => {
          "use server";
          await deleteLoader(id);
        }}
        addLabel="Add loader"
      />
    </>
  );
}
