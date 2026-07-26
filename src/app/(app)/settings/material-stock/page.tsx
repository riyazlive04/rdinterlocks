import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { MaterialStockEditor } from "./stock-editor";
import { setMaterialStock, addMaterialStock } from "../actions";

export default async function MaterialStockPage() {
  const materials = await prisma.material.findMany({
    orderBy: { name: "asc" },
    include: { stock: true },
  });

  return (
    <>
      <PageHeader
        title="Raw material stock"
        sub="Set what's on hand, add received stock. Production draws these down automatically."
        back="/settings"
      />
      <MaterialStockEditor
        rows={materials.map((m) => ({
          id: m.id,
          name: m.name,
          unit: m.unit,
          quantity: m.stock?.quantity ?? 0,
          reorderAt: m.stock?.reorderAt ?? 0,
        }))}
        onSet={async (data) => {
          "use server";
          await setMaterialStock(data);
        }}
        onAdd={async (materialId, amount) => {
          "use server";
          await addMaterialStock(materialId, amount);
        }}
      />
    </>
  );
}
