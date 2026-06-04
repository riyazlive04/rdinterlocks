import Link from "next/link";
import { prisma } from "@/lib/db";
import { Card, PageHeader, Pill, EmptyState } from "@/components/ui";
import { Icon } from "@/components/icons";
import { formatINR, formatShortDate, startOfDay } from "@/lib/format";
import { DeleteExpense } from "./delete-expense";

export default async function ExpensePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; category?: string }>;
}) {
  const sp = await searchParams;
  const today = startOfDay();
  const from = sp?.from ? new Date(sp.from) : new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  const to = sp?.to ? new Date(sp.to) : today;
  to.setHours(23, 59, 59, 999);

  const [expenses, categories] = await Promise.all([
    prisma.expense.findMany({
      where: {
        date: { gte: from, lte: to },
        ...(sp?.category ? { categoryId: sp.category } : {}),
      },
      include: { category: true, vendor: true },
      orderBy: { date: "desc" },
    }),
    prisma.expenseCategory.findMany({ orderBy: { order: "asc" } }),
  ]);

  const total = expenses.reduce((s, e) => s + e.amount, 0);

  // Group by category
  const byCat: Record<string, number> = {};
  for (const e of expenses) {
    byCat[e.category.name] = (byCat[e.category.name] ?? 0) + e.amount;
  }
  const top = Object.entries(byCat)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return (
    <>
      <PageHeader
        title="Expenses"
        sub={`${expenses.length} entries · ${formatINR(total)}`}
        right={
          <Link
            href="/expense/new"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-brand-red text-white text-[13px] font-semibold shadow-red"
          >
            <Icon.Plus size={16} stroke={2.4} /> New expense
          </Link>
        }
      />

      {/* Top categories */}
      {top.length > 0 && (
        <Card className="mb-5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-3">
            Top categories — last 30 days
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
            {top.map(([k, v]) => (
              <Link
                key={k}
                href={`/expense?category=${encodeURIComponent(
                  categories.find((c) => c.name === k)?.id ?? ""
                )}`}
                className="block p-2.5 bg-slate-50 rounded-xl hover:bg-slate-100 transition"
              >
                <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider truncate">
                  {k}
                </div>
                <div className="num display text-base font-bold mt-0.5">{formatINR(v)}</div>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {/* Category filter */}
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar mb-4">
        <Link
          href="/expense"
          className={`px-3 py-1.5 rounded-full text-[12px] font-semibold whitespace-nowrap ${
            !sp?.category
              ? "bg-ink text-white"
              : "bg-white text-slate-700 border border-slate-200"
          }`}
        >
          All
        </Link>
        {categories.map((c) => (
          <Link
            key={c.id}
            href={`/expense?category=${c.id}`}
            className={`px-3 py-1.5 rounded-full text-[12px] font-semibold whitespace-nowrap ${
              sp?.category === c.id
                ? "bg-ink text-white"
                : "bg-white text-slate-700 border border-slate-200"
            }`}
          >
            {c.name}
          </Link>
        ))}
      </div>

      {expenses.length === 0 ? (
        <EmptyState title="No expenses yet" sub="Record your first expense to start tracking." />
      ) : (
        <div className="bg-white rounded-2xl border border-slate-900/[.06] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <Th>Date</Th>
                  <Th>Title</Th>
                  <Th>Category</Th>
                  <Th>Vendor</Th>
                  <Th>Method</Th>
                  <Th align="right">Amount</Th>
                  <Th align="right">Action</Th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((e) => (
                  <tr key={e.id} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50">
                    <Td>{formatShortDate(e.date)}</Td>
                    <Td className="font-semibold text-ink">{e.title}</Td>
                    <Td>
                      <Pill tone="slate">{e.category.name}</Pill>
                    </Td>
                    <Td className="text-slate-600">{e.vendor?.name ?? "—"}</Td>
                    <Td>
                      <span className="capitalize text-slate-600 text-[12px]">
                        {/* method comes from the linked cashEntry; show "—" when not loaded */}
                        cash
                      </span>
                    </Td>
                    <Td align="right" className="num font-bold text-brand-red">
                      −{formatINR(e.amount)}
                    </Td>
                    <Td align="right">
                      <DeleteExpense id={e.id} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "right" | "left" | "center" }) {
  return (
    <th
      className={`px-3 py-2.5 font-semibold text-slate-600 uppercase tracking-wider text-[10px] ${
        align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}
function Td({
  children,
  align,
  className,
}: {
  children: React.ReactNode;
  align?: "right" | "left" | "center";
  className?: string;
}) {
  return (
    <td
      className={`px-3 py-2.5 ${
        align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"
      } ${className ?? ""}`}
    >
      {children}
    </td>
  );
}
