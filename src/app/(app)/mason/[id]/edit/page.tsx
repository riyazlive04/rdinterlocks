import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader, Card } from "@/components/ui";
import { MasonWorkForm } from "../../new/form";
import { updateMasonWork } from "../../actions";
import { formatISODate } from "@/lib/format";

export default async function EditMasonWorkPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [work, masons, sizes, ctypes, prices] = await Promise.all([
    prisma.masonWork.findUnique({ where: { id } }),
    prisma.mason.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.brickSize.findMany({ orderBy: { order: "asc" } }),
    prisma.constructionType.findMany({ orderBy: { order: "asc" } }),
    prisma.brickPrice.findMany(),
  ]);
  if (!work) notFound();
  if (masons.length === 0 || sizes.length === 0 || ctypes.length === 0) {
    return (
      <>
        <PageHeader title="Edit mason work" back="/mason" />
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
      <PageHeader title="Edit mason work" back="/mason" />
      <MasonWorkForm
        masons={masons.map((m) => ({ id: m.id, name: m.name }))}
        sizes={sizes.map((s) => ({ id: s.id, label: s.label }))}
        ctypes={ctypes.map((c) => ({ id: c.id, name: c.name }))}
        priceMap={Object.fromEntries(
          prices.map((p) => [`${p.brickSizeId}_${p.constructionTypeId}`, p.masonRate])
        )}
        initial={{
          date: formatISODate(work.date),
          masonId: work.masonId,
          siteName: work.siteName,
          brickSizeId: work.brickSizeId,
          constructionTypeId: work.constructionTypeId,
          brickCount: work.brickCount,
          ratePerBrick: work.ratePerBrick,
        }}
        submitLabel="Save changes"
        onSubmit={async (d) => {
          "use server";
          await updateMasonWork(id, d);
        }}
      />
    </>
  );
}
