import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader, Card } from "@/components/ui";
import { LoadingForm } from "../../new/form";
import { updateLoadingWork } from "../../actions";
import { formatISODate } from "@/lib/format";

export default async function EditLoadingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [work, loaders, operators, employees, sizes] = await Promise.all([
    prisma.loadingWork.findUnique({ where: { id } }),
    prisma.loader.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.operator.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.employee.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.brickSize.findMany({ orderBy: { order: "asc" } }),
  ]);
  if (!work) notFound();

  const workers = {
    loaders: loaders.map((l) => ({ type: "loader" as const, id: l.id, name: l.name })),
    operators: operators.map((o) => ({ type: "operator" as const, id: o.id, name: o.name })),
    employees: employees.map((e) => ({ type: "employee" as const, id: e.id, name: e.name })),
  };
  const workerType = (work.workerType as "loader" | "operator" | "employee") ?? "loader";
  const workerId = work.loaderId ?? work.operatorId ?? work.employeeId ?? "";

  if (loaders.length + operators.length + employees.length === 0) {
    return (
      <>
        <PageHeader title="Edit loading entry" back="/loading" />
        <Card>
          <div className="p-6 text-center text-sm text-slate-500">Add a worker first.</div>
        </Card>
      </>
    );
  }
  return (
    <>
      <PageHeader title="Edit loading entry" back="/loading" />
      <LoadingForm
        workers={workers}
        sizes={sizes.map((s) => ({ id: s.id, label: s.label }))}
        initial={{
          date: formatISODate(work.date),
          workerType,
          workerId,
          brickSizeId: work.brickSizeId ?? undefined,
          brickCount: work.brickCount,
          ratePerBrick: work.ratePerBrick,
        }}
        submitLabel="Save changes"
        onSubmit={async (d) => {
          "use server";
          await updateLoadingWork(id, d);
        }}
      />
    </>
  );
}
