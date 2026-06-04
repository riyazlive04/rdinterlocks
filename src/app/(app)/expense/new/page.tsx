import { prisma } from "@/lib/db";
import { PageHeader, Card } from "@/components/ui";
import { ExpenseForm } from "./form";
import { createExpense } from "../actions";

export default async function NewExpensePage() {
  const [categories, vendors, tippers] = await Promise.all([
    prisma.expenseCategory.findMany({ orderBy: { order: "asc" } }),
    prisma.vendor.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.tipper.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);
  if (categories.length === 0) {
    return (
      <>
        <PageHeader title="New expense" back="/expense" />
        <Card>
          <div className="p-6 text-center text-sm text-slate-500">
            <p>Add at least one expense category before recording an expense.</p>
            <a href="/settings/expense-categories" className="text-brand-blue underline mt-2 inline-block">
              Manage categories
            </a>
          </div>
        </Card>
      </>
    );
  }
  return (
    <>
      <PageHeader title="New expense" back="/expense" />
      <ExpenseForm
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        vendors={vendors.map((v) => ({ id: v.id, name: v.name }))}
        tippers={tippers.map((t) => ({ id: t.id, name: t.name }))}
        onSubmit={async (d) => {
          "use server";
          await createExpense(d);
        }}
      />
    </>
  );
}
