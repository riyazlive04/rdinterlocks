import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { TipperForm } from "../../new/form";
import { updateTipperLoad } from "../../actions";
import { formatISODate } from "@/lib/format";

export default async function EditTipperLoadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [load, tippers, sizes] = await Promise.all([
    prisma.tipperLoad.findUnique({ where: { id }, include: { cashEntry: true } }),
    prisma.tipper.findMany({
      where: { active: true },
      include: { vendor: true },
      orderBy: { name: "asc" },
    }),
    prisma.brickSize.findMany({ orderBy: { order: "asc" } }),
  ]);
  if (!load) notFound();

  const method = (load.cashEntry?.method ?? "cash") as
    | "cash"
    | "gpay"
    | "bank"
    | "upi"
    | "cheque";

  return (
    <>
      <PageHeader title="Edit tipper load" back="/tipper" />
      <TipperForm
        tippers={tippers.map((t) => ({
          id: t.id,
          name: t.name,
          ownership: t.ownership,
          vendorName: t.vendor?.name ?? null,
        }))}
        sizes={sizes.map((s) => ({ id: s.id, label: s.label }))}
        initial={{
          date: formatISODate(load.date),
          tipperId: load.tipperId,
          loadType: load.loadType === "material" ? "material" : "bricks",
          brickSizeId: load.brickSizeId ?? undefined,
          materialName: load.materialName ?? undefined,
          quantity: load.quantity,
          unit: load.unit,
          fromLocation: load.fromLocation ?? undefined,
          toLocation: load.toLocation ?? undefined,
          rentAmount: load.rentAmount,
          rentDirection: load.rentDirection === "out" ? "out" : "in",
          returnBricks: load.returnBricks,
          notes: load.notes ?? undefined,
          method,
        }}
        submitLabel="Save changes"
        onSubmit={async (d) => {
          "use server";
          await updateTipperLoad(id, d);
        }}
      />
    </>
  );
}
