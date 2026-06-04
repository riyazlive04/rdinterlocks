import { prisma } from "@/lib/db";
import { PageHeader, Card } from "@/components/ui";
import { PriceMatrixEditor } from "./editor";
import { upsertPrice } from "../actions";

export default async function PriceMatrixPage() {
  const [sizes, ctypes, prices] = await Promise.all([
    prisma.brickSize.findMany({ orderBy: { order: "asc" } }),
    prisma.constructionType.findMany({ orderBy: { order: "asc" } }),
    prisma.brickPrice.findMany(),
  ]);

  const map: Record<string, { sellPrice: number; masonRate: number; productionCost: number }> = {};
  for (const p of prices) {
    map[`${p.brickSizeId}_${p.constructionTypeId}`] = {
      sellPrice: p.sellPrice,
      masonRate: p.masonRate,
      productionCost: p.productionCost,
    };
  }

  return (
    <>
      <PageHeader
        title="Price matrix"
        sub="Sell price + mason rate + production cost per brick, for each brick size × construction type"
        back="/settings"
      />
      {sizes.length === 0 || ctypes.length === 0 ? (
        <Card>
          <div className="text-center text-sm text-slate-500 py-6">
            Add at least one Brick size and one Construction type first.
          </div>
        </Card>
      ) : (
        <PriceMatrixEditor
          sizes={sizes.map((s) => ({ id: s.id, label: s.label }))}
          ctypes={ctypes.map((c) => ({ id: c.id, name: c.name }))}
          values={map}
          onSave={async (data) => {
            "use server";
            await upsertPrice(data);
          }}
        />
      )}
    </>
  );
}
