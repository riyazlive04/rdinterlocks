import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { MasterList } from "@/components/master-list";
import { createMason, updateMason, deleteMason } from "../actions";

export default async function MasonsPage() {
  const rows = await prisma.mason.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  return (
    <>
      <PageHeader title="Masons" sub="Site-laying workers (rate from price matrix per size × type)" back="/settings" />
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
          await createMason({ name: String(d.name), phone: String(d.phone || "") });
        }}
        onUpdate={async (id, d) => {
          "use server";
          await updateMason(id, { name: String(d.name), phone: String(d.phone || "") });
        }}
        onDelete={async (id) => {
          "use server";
          await deleteMason(id);
        }}
        addLabel="Add mason"
      />
    </>
  );
}
