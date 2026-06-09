import { prisma } from "@/lib/db";
import { PageHeader, Card } from "@/components/ui";
import { LoadingMultiForm } from "./multi-form";
import { createLoadingWork } from "../actions";

export default async function NewLoadingPage() {
  const [loaders, operators, employees, sizes] = await Promise.all([
    prisma.loader.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.operator.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.employee.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.brickSize.findMany({ orderBy: { order: "asc" } }),
  ]);
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
        onSubmit={async (d) => {
          "use server";
          await createLoadingWork(d);
        }}
      />
    </>
  );
}
