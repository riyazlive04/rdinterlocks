import { prisma } from "@/lib/db";
import { PageHeader, Card } from "@/components/ui";
import { LoadingForm } from "./form";
import { createLoadingWork } from "../actions";

export default async function NewLoadingPage() {
  const [loaders, sizes] = await Promise.all([
    prisma.loader.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.brickSize.findMany({ orderBy: { order: "asc" } }),
  ]);
  if (loaders.length === 0) {
    return (
      <>
        <PageHeader title="New loading entry" back="/loading" />
        <Card>
          <div className="p-6 text-center text-sm text-slate-500">
            <p>Add at least one loader first.</p>
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
      <LoadingForm
        loaders={loaders.map((l) => ({ id: l.id, name: l.name }))}
        sizes={sizes.map((s) => ({ id: s.id, label: s.label }))}
        onSubmit={async (d) => {
          "use server";
          await createLoadingWork(d);
        }}
      />
    </>
  );
}
