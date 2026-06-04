import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { FactoryForm } from "./form";
import { updateSettings } from "../actions";

export default async function FactorySettingsPage() {
  const s = await prisma.settings.findUnique({ where: { id: "default" } });
  return (
    <>
      <PageHeader title="Factory profile" sub="Used on PDF letterhead and reports" back="/settings" />
      <FactoryForm
        initial={{
          factoryName: s?.factoryName ?? "RD Interlock Bricks",
          ownerName: s?.ownerName ?? "Admin",
          address: s?.address ?? "",
          phone: s?.phone ?? "",
          gstin: s?.gstin ?? "",
          cementBagsPer1000: s?.cementBagsPer1000 ?? 18,
          cashOpening: s?.cashOpening ?? 0,
        }}
        onSave={async (data) => {
          "use server";
          await updateSettings(data);
        }}
      />
    </>
  );
}
