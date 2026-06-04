import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { MasterList } from "@/components/master-list";
import { createTipper, updateTipper, deleteTipper } from "../actions";

export default async function TippersPage() {
  const [rows, vendors] = await Promise.all([
    prisma.tipper.findMany({ where: { active: true }, include: { vendor: true } }),
    prisma.vendor.findMany({ where: { active: true } }),
  ]);
  return (
    <>
      <PageHeader title="Tippers" sub="Own RD trucks + vendor-owned trucks (e.g. AVM)" back="/settings" />
      <MasterList
        rows={rows.map((r) => ({
          id: r.id,
          name: r.name,
          plate: r.plate ?? "",
          ownership: r.ownership === "own" ? "RD" : r.vendor?.name ?? "Vendor",
          ownershipKey: r.ownership,
          vendorId: r.vendorId ?? "",
          emiAmount: r.emiAmount,
        }))}
        fields={[
          { type: "text", key: "name", label: "Name", required: true, placeholder: "RD Tipper" },
          { type: "text", key: "plate", label: "Plate" },
          {
            type: "select",
            key: "ownershipKey",
            label: "Ownership",
            required: true,
            options: [
              { value: "own", label: "Own (RD)" },
              { value: "vendor", label: "Vendor" },
            ],
          },
          {
            type: "select",
            key: "vendorId",
            label: "Vendor (if vendor-owned)",
            options: vendors.map((v) => ({ value: v.id, label: v.name })),
          },
          { type: "number", key: "emiAmount", label: "EMI (own only)" },
        ]}
        columns={[
          { key: "name", header: "Name", format: "bold" },
          { key: "plate", header: "Plate", format: "mono" },
          { key: "ownership", header: "Owner" },
          { key: "emiAmount", header: "EMI/mo", format: "currency" },
        ]}
        onCreate={async (d) => {
          "use server";
          await createTipper({
            name: String(d.name),
            plate: String(d.plate || ""),
            ownership: d.ownershipKey as "own" | "vendor",
            vendorId: d.vendorId ? String(d.vendorId) : undefined,
            emiAmount: Number(d.emiAmount || 0),
          });
        }}
        onUpdate={async (id, d) => {
          "use server";
          await updateTipper(id, {
            name: String(d.name),
            plate: String(d.plate || ""),
            ownership: d.ownershipKey as "own" | "vendor",
            vendorId: d.vendorId ? String(d.vendorId) : undefined,
            emiAmount: Number(d.emiAmount || 0),
          });
        }}
        onDelete={async (id) => {
          "use server";
          await deleteTipper(id);
        }}
        addLabel="Add tipper"
      />
    </>
  );
}
