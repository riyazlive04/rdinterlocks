import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { MasterList } from "@/components/master-list";
import {
  createExpenseCategory,
  updateExpenseCategory,
  deleteExpenseCategory,
} from "../actions";

export default async function ExpenseCategoriesPage() {
  const rows = await prisma.expenseCategory.findMany({ orderBy: { order: "asc" } });
  return (
    <>
      <PageHeader
        title="Expense categories"
        sub="Cement, Diesel, EB, Mould (Die), Tea, Wifi — admin can add anything"
        back="/settings"
      />
      <MasterList
        rows={rows.map((r) => ({ id: r.id, name: r.name, order: r.order }))}
        fields={[
          { type: "text", key: "name", label: "Name", required: true, placeholder: "e.g. Cement" },
          { type: "number", key: "order", label: "Display order" },
        ]}
        columns={[
          { key: "name", header: "Name", format: "bold" },
          { key: "order", header: "Order", format: "number" },
        ]}
        onCreate={async (d) => {
          "use server";
          await createExpenseCategory({ name: String(d.name), order: Number(d.order || 0) });
        }}
        onUpdate={async (id, d) => {
          "use server";
          await updateExpenseCategory(id, { name: String(d.name), order: Number(d.order || 0) });
        }}
        onDelete={async (id) => {
          "use server";
          await deleteExpenseCategory(id);
        }}
        addLabel="Add category"
      />
    </>
  );
}
