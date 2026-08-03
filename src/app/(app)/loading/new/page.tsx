import { prisma } from "@/lib/db";
import { PageHeader, Card } from "@/components/ui";
import { LoadingMultiForm } from "./multi-form";
import { createLoadingWork } from "../actions";

export default async function NewLoadingPage() {
  const [loaders, operators, employees, sizes, clients, tippers, vendors, openOrders] =
    await Promise.all([
      prisma.loader.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      prisma.operator.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      prisma.employee.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      prisma.brickSize.findMany({ orderBy: { order: "asc" } }),
      prisma.client.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      prisma.tipper.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      prisma.vendor.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      // Orders still owed bricks, so the entry can book what left the yard
      // against the right one.
      prisma.order.findMany({
        where: { status: { in: ["upcoming", "active"] } },
        include: {
          items: { include: { brickSize: true } },
          deliveries: { include: { items: true, returns: true } },
        },
        orderBy: { date: "desc" },
      }),
    ]);

  const orderOptions = openOrders.map((o) => {
    const ordered = o.items.reduce((s, i) => s + i.quantity, 0);
    const delivered = o.deliveries.reduce(
      (s, d) =>
        s +
        d.items.reduce((x, i) => x + i.quantity, 0) -
        d.returns.reduce((x, r) => x + r.brickCount, 0),
      0
    );
    return {
      id: o.id,
      clientId: o.clientId,
      date: o.date.toISOString(),
      ordered,
      delivered,
      pending: Math.max(0, ordered - delivered),
      sizes: o.items.map((i) => i.brickSize.label),
    };
  });
  const workers = {
    loaders: loaders.map((l) => ({ type: "loader" as const, id: l.id, name: l.name })),
    operators: operators.map((o) => ({ type: "operator" as const, id: o.id, name: o.name })),
    employees: employees.map((e) => ({ type: "employee" as const, id: e.id, name: e.name })),
  };
  const hasWorkers = loaders.length + operators.length + employees.length > 0;
  if (!hasWorkers) {
    return (
      <>
        <PageHeader title="New loading entry" back="/loading" />
        <Card>
          <div className="p-6 text-center text-sm text-slate-500">
            <p>Add at least one loader, operator or employee first.</p>
            <a href="/settings/loaders" className="text-brand-blue underline mt-2 inline-block">
              Manage loaders
            </a>
          </div>
        </Card>
      </>
    );
  }
  return (
    <>
      <PageHeader title="New loading entry" back="/loading" />
      <LoadingMultiForm
        workers={workers}
        sizes={sizes.map((s) => ({ id: s.id, label: s.label }))}
        clients={clients.map((c) => ({ id: c.id, name: c.name, location: c.location ?? undefined }))}
        orders={orderOptions}
        tippers={tippers.map((t) => ({ id: t.id, name: t.name, ownership: t.ownership }))}
        vendors={vendors.map((v) => ({ id: v.id, name: v.name }))}
        onSubmit={async (d) => {
          "use server";
          await createLoadingWork(d);
        }}
      />
    </>
  );
}
