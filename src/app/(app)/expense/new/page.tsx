import { prisma } from "@/lib/db";
import { PageHeader, Card } from "@/components/ui";
import { ExpenseForm } from "./form";
import { createExpense } from "../actions";

export default async function NewExpensePage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; tipper?: string; amount?: string; title?: string }>;
}) {
  const sp = await searchParams;
  const [categories, vendors, tippers] = await Promise.all([
    prisma.expenseCategory.findMany({ orderBy: { order: "asc" } }),
    prisma.vendor.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.tipper.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);

  // Prefill from query params (e.g. the "Pay EMI" link on the Vehicles page).
  // Match category by name so links can pass a readable "EMI" instead of an id.
  const matchedCategory = sp?.category
    ? categories.find((c) => c.name.toLowerCase() === sp.category!.toLowerCase())
    : undefined;
  const amountNum = sp?.amount ? Number(sp.amount) : undefined;
  const initial = {
    categoryId: matchedCategory?.id,
    title: sp?.title || undefined,
    amount: amountNum && !Number.isNaN(amountNum) ? amountNum : undefined,
    tipperId: sp?.tipper && tippers.some((t) => t.id === sp.tipper) ? sp.tipper : undefined,
  };
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
        initial={initial}
        onSubmit={async (d) => {
          "use server";
          await createExpense(d);
        }}
      />
    </>
  );
}
