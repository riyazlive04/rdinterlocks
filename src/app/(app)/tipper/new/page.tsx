import { prisma } from "@/lib/db";
import { PageHeader, Card } from "@/components/ui";
import { TipperForm } from "./form";
import { createTipperLoad } from "../actions";

export default async function NewTipperLoadPage() {
  const [tippers, sizes] = await Promise.all([
    prisma.tipper.findMany({
      where: { active: true },
      include: { vendor: true },
      orderBy: { name: "asc" },
    }),
    prisma.brickSize.findMany({ orderBy: { order: "asc" } }),
  ]);
  if (tippers.length === 0) {
    return (
      <>
        <PageHeader title="New tipper load" back="/tipper" />
        <Card>
          <div className="p-6 text-center text-sm text-slate-500">
            <p>Add at least one tipper before recording a load.</p>
            <a href="/settings/tippers" className="text-brand-blue underline mt-2 inline-block">
              Manage tippers
            </a>
          </div>
        </Card>
      </>
    );
  }
  return (
    <>
      <PageHeader title="New tipper load" back="/tipper" />
      <TipperForm
        tippers={tippers.map((t) => ({
          id: t.id,
          name: t.name,
          ownership: t.ownership,
          vendorName: t.vendor?.name ?? null,
        }))}
        sizes={sizes.map((s) => ({ id: s.id, label: s.label }))}
        onSubmit={async (d) => {
          "use server";
          await createTipperLoad(d);
        }}
      />
    </>
  );
}
