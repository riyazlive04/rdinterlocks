import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { MasterList } from "@/components/master-list";
import { createVendor, updateVendor, deleteVendor } from "../actions";

export default async function VendorsPage() {
  const rows = await prisma.vendor.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  return (
    <>
      <PageHeader title="Vendors" sub="Outside parties — AVM tipper, raw material suppliers, etc." back="/settings" />
      <MasterList
        rows={rows.map((r) => ({ id: r.id, name: r.name, phone: r.phone ?? "", notes: r.notes ?? "" }))}
        fields={[
          { type: "text", key: "name", label: "Name", required: true },
          { type: "text", key: "phone", label: "Phone" },
          { type: "text", key: "notes", label: "Notes" },
        ]}
        columns={[
          { key: "name", header: "Name", format: "bold" },
          { key: "phone", header: "Phone", format: "mono" },
          { key: "notes", header: "Notes", format: "muted" },
        ]}
        onCreate={async (d) => {
          "use server";
          await createVendor({
            name: String(d.name),
            phone: String(d.phone || ""),
            notes: String(d.notes || ""),
          });
        }}
        onUpdate={async (id, d) => {
          "use server";
          await updateVendor(id, {
            name: String(d.name),
            phone: String(d.phone || ""),
            notes: String(d.notes || ""),
          });
        }}
        onDelete={async (id) => {
          "use server";
          await deleteVendor(id);
        }}
        addLabel="Add vendor"
      />
    </>
  );
}
