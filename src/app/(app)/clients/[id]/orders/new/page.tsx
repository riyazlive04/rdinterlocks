import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader, Card } from "@/components/ui";
import { OrderForm } from "./form";
import { createOrder } from "../../../actions";

export default async function NewOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [client, sizes, ctypes, prices] = await Promise.all([
    prisma.client.findUnique({ where: { id } }),
    prisma.brickSize.findMany({ orderBy: { order: "asc" } }),
    prisma.constructionType.findMany({ orderBy: { order: "asc" } }),
    prisma.brickPrice.findMany(),
  ]);
  if (!client) notFound();
  if (sizes.length === 0 || ctypes.length === 0) {
    return (
      <>
        <PageHeader title={`New order — ${client.name}`} back={`/clients/${id}`} />
        <Card>
          <div className="p-6 text-center text-sm text-slate-500">
            Add brick sizes and construction types in Settings before creating orders.
          </div>
        </Card>
      </>
    );
  }
  return (
    <>
      <PageHeader title={`New order — ${client.name}`} back={`/clients/${id}`} />
      <OrderForm
        clientId={id}
        sizes={sizes.map((s) => ({ id: s.id, label: s.label }))}
        ctypes={ctypes.map((c) => ({ id: c.id, name: c.name }))}
        priceMap={Object.fromEntries(
          prices.map((p) => [`${p.brickSizeId}_${p.constructionTypeId}`, p.sellPrice])
        )}
        onSubmit={async (d) => {
          "use server";
          await createOrder(d);
        }}
      />
    </>
  );
}
