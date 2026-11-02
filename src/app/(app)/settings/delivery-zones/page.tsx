import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { PageHeader, Card } from "@/components/ui";
import { DeliveryZoneManager } from "./manager";
import {
  createDeliveryZone,
  updateDeliveryZone,
  deactivateDeliveryZone,
  reactivateDeliveryZone,
} from "../actions";

export default async function DeliveryZonesPage() {
  await requireAdmin();

  const [zones, sizes, ctypes] = await Promise.all([
    prisma.deliveryZone.findMany({
      orderBy: { order: "asc" },
      include: { rules: true, prices: true, _count: { select: { quotations: true } } },
    }),
    prisma.brickSize.findMany({ orderBy: { order: "asc" } }),
    prisma.constructionType.findMany({ orderBy: { order: "asc" } }),
  ]);

  return (
    <>
      <PageHeader
        title="Delivery zones"
        sub="Location-based quotation pricing — group towns by distance from the factory, each with its own minimum order and price"
        back="/settings"
      />
      {sizes.length === 0 || ctypes.length === 0 ? (
        <Card>
          <div className="text-center text-sm text-slate-500 py-6">
            Add at least one Brick size and one Construction type first.
          </div>
        </Card>
      ) : (
        <DeliveryZoneManager
          zones={zones.map((z) => ({
            id: z.id,
            name: z.name,
            distanceLabel: z.distanceLabel,
            areas: z.areas,
            order: z.order,
            active: z.active,
            quotationCount: z._count.quotations,
            rules: z.rules.map((r) => ({
              brickSizeId: r.brickSizeId,
              minBricks: r.minBricks,
              transportOnly: r.transportOnly,
            })),
            prices: z.prices.map((p) => ({
              brickSizeId: p.brickSizeId,
              constructionTypeId: p.constructionTypeId,
              sellPrice: p.sellPrice,
            })),
          }))}
          sizes={sizes.map((s) => ({ id: s.id, label: s.label }))}
          ctypes={ctypes.map((c) => ({ id: c.id, name: c.name }))}
          onCreate={async (data) => {
            "use server";
            await createDeliveryZone(data);
          }}
          onUpdate={async (id, data) => {
            "use server";
            await updateDeliveryZone(id, data);
          }}
          onDeactivate={async (id) => {
            "use server";
            await deactivateDeliveryZone(id);
          }}
          onReactivate={async (id) => {
            "use server";
            await reactivateDeliveryZone(id);
          }}
        />
      )}
    </>
  );
}
