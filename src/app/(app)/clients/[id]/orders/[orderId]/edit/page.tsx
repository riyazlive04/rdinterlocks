import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader, Card } from "@/components/ui";
import { OrderForm } from "../../new/form";
import { updateOrder } from "../../../../actions";
import { formatISODate } from "@/lib/format";

export default async function EditOrderPage({
  params,
}: {
  params: Promise<{ id: string; orderId: string }>;
}) {
  const { id, orderId } = await params;
  const [client, order, sizes, ctypes, prices] = await Promise.all([
    prisma.client.findUnique({ where: { id } }),
    prisma.order.findUnique({ where: { id: orderId }, include: { items: true } }),
    prisma.brickSize.findMany({ orderBy: { order: "asc" } }),
    prisma.constructionType.findMany({ orderBy: { order: "asc" } }),
    prisma.brickPrice.findMany(),
  ]);
  if (!client || !order) notFound();
  if (sizes.length === 0 || ctypes.length === 0) {
    return (
      <>
        <PageHeader title={`Edit order - ${client.name}`} back={`/clients/${id}`} />
        <Card>
          <div className="p-6 text-center text-sm text-slate-500">
            Add brick sizes and construction types in Settings first.
          </div>
        </Card>
      </>
    );
  }
  return (
    <>
      <PageHeader title={`Edit order - ${client.name}`} back={`/clients/${id}`} />
      <OrderForm
        clientId={id}
        sizes={sizes.map((s) => ({ id: s.id, label: s.label }))}
        ctypes={ctypes.map((c) => ({ id: c.id, name: c.name }))}
        priceMap={Object.fromEntries(
          prices.map((p) => [`${p.brickSizeId}_${p.constructionTypeId}`, p.sellPrice])
        )}
        initial={{
          date: formatISODate(order.date),
          expectedDeliveryDate: order.expectedDeliveryDate
            ? formatISODate(order.expectedDeliveryDate)
            : "",
          notes: order.notes ?? "",
          items: order.items.map((it) => ({
            brickSizeId: it.brickSizeId,
            constructionTypeId: it.constructionTypeId,
            quantity: it.quantity,
            pricePerBrick: it.pricePerBrick,
          })),
        }}
        submitLabel="Save changes"
        hideAdvance
        onSubmit={async (d) => {
          "use server";
          await updateOrder(orderId, {
            date: d.date,
            expectedDeliveryDate: d.expectedDeliveryDate,
            notes: d.notes,
            items: d.items,
          });
        }}
      />
    </>
  );
}
