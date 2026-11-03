import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { PageHeader, Card } from "@/components/ui";
import { PriceMatrixEditor } from "./editor";
import { upsertPrice } from "../actions";

export default async function PriceMatrixPage() {
  await requireAdmin();
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

  // Mason payouts and margin both multiply by these, so a row left at 0 does
  // not fail — it quietly computes a zero payout or a 100% margin. The rate
  // chart the matrix was seeded from is sell-side only, so every seeded row
  // starts with masonRate and productionCost at 0 and nothing said so
  // anywhere. Counted and named here, on the page that fixes it.
  const priced = prices.filter((p) => p.sellPrice > 0);
  const noMasonRate = priced.filter((p) => p.masonRate <= 0).length;
  const noProductionCost = priced.filter((p) => p.productionCost <= 0).length;

  const sizeLabel = new Map(sizes.map((x) => [x.id, x.label]));
  const typeName = new Map(ctypes.map((x) => [x.id, x.name]));
  const gapRows = priced
    .filter((p) => p.masonRate <= 0 || p.productionCost <= 0)
    .map((p) => `${sizeLabel.get(p.brickSizeId) ?? "?"} ${typeName.get(p.constructionTypeId) ?? "?"}`)
    .sort();

  return (
    <>
      <PageHeader
        title="Price matrix"
        sub="Sell price + mason rate + production cost per brick, for each brick size × construction type"
        back="/settings"
      />
      {(noMasonRate > 0 || noProductionCost > 0) && (
        <Card className="mb-4 border-amber-200 bg-amber-50">
          <div className="text-[12.5px] text-ink leading-relaxed">
            <span className="font-semibold">
              {gapRows.length} priced{" "}
              {gapRows.length === 1 ? "combination is" : "combinations are"} missing a
              cost figure.
            </span>{" "}
            {noMasonRate > 0 && (
              <>
                {noMasonRate} {noMasonRate === 1 ? "has" : "have"} no{" "}
                <span className="font-semibold">mason rate</span>, so mason payouts for{" "}
                {noMasonRate === 1 ? "it" : "them"} compute as{" "}
                <span className="font-semibold">zero</span>.{" "}
              </>
            )}
            {noProductionCost > 0 && (
              <>
                {noProductionCost} {noProductionCost === 1 ? "has" : "have"} no{" "}
                <span className="font-semibold">production cost</span>, so margin reads as
                the full sell price.{" "}
              </>
            )}
            The owner&apos;s rate chart is sell-side only, so seeded rows start at 0 — these
            are not errors, they are figures nobody has filled in yet. Fill them below
            before running payroll or reading a profit report.
            <div className="mt-1.5 text-[11.5px] text-slate-600">{gapRows.join(" · ")}</div>
          </div>
        </Card>
      )}
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
