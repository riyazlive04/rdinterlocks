import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { MasterList } from "@/components/master-list";
import { createOperator, updateOperator, deleteOperator } from "../actions";

export default async function OperatorsPage() {
  const rows = await prisma.operator.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  return (
    <>
      <PageHeader title="Operators" sub="Production line workers (paid piece-rate, split per batch)" back="/settings" />
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
          await createOperator({ name: String(d.name), phone: String(d.phone || "") });
        }}
        onUpdate={async (id, d) => {
          "use server";
          await updateOperator(id, { name: String(d.name), phone: String(d.phone || "") });
        }}
        onDelete={async (id) => {
          "use server";
          await deleteOperator(id);
        }}
        addLabel="Add operator"
      />
    </>
  );
}
