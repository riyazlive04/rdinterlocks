import { prisma } from "@/lib/db";
import { PageHeader, Card } from "@/components/ui";
import { MasonWorkForm } from "./form";
import { createMasonWork } from "../actions";

export default async function NewMasonWorkPage() {
  const [masons, sizes, ctypes, prices] = await Promise.all([
    prisma.mason.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.brickSize.findMany({ orderBy: { order: "asc" } }),
    prisma.constructionType.findMany({ orderBy: { order: "asc" } }),
    prisma.brickPrice.findMany(),
  ]);
  if (masons.length === 0 || sizes.length === 0 || ctypes.length === 0) {
    return (
      <>
        <PageHeader title="New mason work" back="/mason" />
        <Card>
          <div className="p-6 text-center text-sm text-slate-500">
            Add at least one mason, brick size and construction type first.
          </div>
        </Card>
      </>
    );
  }
  return (
    <>
      <PageHeader title="Mason work - new entry" back="/mason" />
      <MasonWorkForm
        masons={masons.map((m) => ({ id: m.id, name: m.name }))}
        sizes={sizes.map((s) => ({ id: s.id, label: s.label }))}
        ctypes={ctypes.map((c) => ({ id: c.id, name: c.name }))}
        priceMap={Object.fromEntries(
          prices.map((p) => [`${p.brickSizeId}_${p.constructionTypeId}`, p.masonRate])
        )}
        onSubmit={async (d) => {
          "use server";
          await createMasonWork(d);
        }}
      />
    </>
  );
}
