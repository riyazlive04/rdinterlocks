import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { DeliveryForm } from "../../new/form";
import { updateDelivery } from "@/app/(app)/clients/actions";
import { formatISODate } from "@/lib/format";

export default async function EditDeliveryPage({
  params,
}: {
  params: Promise<{ id: string; orderId: string; deliveryId: string }>;
}) {
  const { id, orderId, deliveryId } = await params;
  const [delivery, order, sizes, ctypes, prices] = await Promise.all([
    prisma.delivery.findUnique({
      where: { id: deliveryId },
      include: { items: true, addOns: true, returns: true },
    }),
    prisma.order.findUnique({ where: { id: orderId }, include: { client: true } }),
    prisma.brickSize.findMany({ orderBy: { order: "asc" } }),
    prisma.constructionType.findMany({ orderBy: { order: "asc" } }),
    prisma.brickPrice.findMany(),
  ]);
  if (!delivery || !order || order.clientId !== id || delivery.orderId !== orderId) notFound();

  return (
    <>
      <PageHeader
        title={`Edit delivery - ${order.client.name}`}
        back={`/clients/${id}`}
      />
      <DeliveryForm
        orderId={orderId}
        sizes={sizes.map((s) => ({ id: s.id, label: s.label }))}
        ctypes={ctypes.map((c) => ({ id: c.id, name: c.name }))}
        priceMap={Object.fromEntries(
          prices.map((p) => [`${p.brickSizeId}_${p.constructionTypeId}`, p.sellPrice])
        )}
        defaults={[]}
        initial={{
          date: formatISODate(delivery.date),
          truckPlate: delivery.truckPlate ?? "",
          notes: delivery.notes ?? "",
          items: delivery.items.map((i) => ({
            brickSizeId: i.brickSizeId,
            constructionTypeId: i.constructionTypeId,
            quantity: i.quantity,
            pricePerBrick: i.pricePerBrick,
          })),
          addOns: delivery.addOns.map((a) => ({
            name: a.name,
            quantity: a.quantity,
            unit: a.unit,
            pricePerUnit: a.pricePerUnit,
          })),
          returns: delivery.returns.map((r) => ({
            brickCount: r.brickCount,
            refundAmount: r.refundAmount,
            notes: r.notes ?? undefined,
          })),
        }}
        submitLabel="Save changes"
        hidePayment
        onSubmit={async (d) => {
          "use server";
          await updateDelivery(deliveryId, {
            date: d.date,
            truckPlate: d.truckPlate,
            notes: d.notes,
            items: d.items,
            addOns: d.addOns,
            returns: d.returns,
          });
        }}
      />
    </>
  );
}
