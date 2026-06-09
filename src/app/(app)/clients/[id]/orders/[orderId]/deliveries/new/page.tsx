import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { DeliveryForm } from "./form";
import { createDelivery } from "@/app/(app)/clients/actions";

export default async function NewDeliveryPage({
  params,
}: {
  params: Promise<{ id: string; orderId: string }>;
}) {
  const { id, orderId } = await params;
  const [order, sizes, ctypes, prices] = await Promise.all([
    prisma.order.findUnique({
      where: { id: orderId },
      include: {
        client: true,
        items: { include: { brickSize: true, constructionType: true } },
      },
    }),
    prisma.brickSize.findMany({ orderBy: { order: "asc" } }),
    prisma.constructionType.findMany({ orderBy: { order: "asc" } }),
    prisma.brickPrice.findMany(),
  ]);
  if (!order || order.clientId !== id) notFound();

  return (
    <>
      <PageHeader
        title={`New delivery - ${order.client.name}`}
        sub={`Order placed ${order.date.toDateString()}`}
        back={`/clients/${id}`}
      />
      <DeliveryForm
        orderId={orderId}
        sizes={sizes.map((s) => ({ id: s.id, label: s.label }))}
        ctypes={ctypes.map((c) => ({ id: c.id, name: c.name }))}
        priceMap={Object.fromEntries(
          prices.map((p) => [`${p.brickSizeId}_${p.constructionTypeId}`, p.sellPrice])
        )}
        defaults={order.items.map((i) => ({
          brickSizeId: i.brickSizeId,
          constructionTypeId: i.constructionTypeId,
          quantity: i.quantity,
          pricePerBrick: i.pricePerBrick,
        }))}
        onSubmit={async (d) => {
          "use server";
          await createDelivery(d);
        }}
      />
    </>
  );
}
