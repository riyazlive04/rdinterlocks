import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { MasterList } from "@/components/master-list";
import { createMachine, updateMachine, deleteMachine } from "../actions";

export default async function MachinesPage() {
  const rows = await prisma.machine.findMany({ where: { active: true }, orderBy: { order: "asc" } });
  return (
    <>
      <PageHeader title="Machines" sub="Production machines - rename or add lines" back="/settings" />
      <MasterList
        rows={rows.map((r) => ({ id: r.id, name: r.name, order: r.order }))}
        fields={[
          { type: "text", key: "name", label: "Name", required: true, placeholder: "Machine A" },
          { type: "number", key: "order", label: "Order" },
        ]}
        columns={[
          { key: "name", header: "Name", format: "bold" },
          { key: "order", header: "Order" },
        ]}
        onCreate={async (d) => {
          "use server";
          await createMachine({ name: String(d.name), order: Number(d.order || 0) });
        }}
        onUpdate={async (id, d) => {
          "use server";
          await updateMachine(id, { name: String(d.name), order: Number(d.order || 0) });
        }}
        onDelete={async (id) => {
          "use server";
          await deleteMachine(id);
        }}
        addLabel="Add machine"
      />
    </>
  );
}
