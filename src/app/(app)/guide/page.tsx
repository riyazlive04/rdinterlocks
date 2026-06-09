import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { Icon, IconName } from "@/components/icons";

const quickRef: Array<{
  action: string;
  enter: string;
  enterHref: string;
  output: Array<{ label: string; href: string }>;
}> = [
  {
    action: "Daily production",
    enter: "Production → New entry",
    enterHref: "/production/new",
    output: [
      { label: "Production list", href: "/production" },
      { label: "Reports → Production", href: "/reports?kind=production" },
      { label: "Dashboard", href: "/" },
    ],
  },
  {
    action: "Client payment",
    enter: "Client page → Record payment",
    enterHref: "/clients",
    output: [
      { label: "Cashbook", href: "/cash" },
      { label: "Reports → Cashbook", href: "/reports?kind=cashbook" },
      { label: "Client detail", href: "/clients" },
    ],
  },
  {
    action: "Worker advance",
    enter: "Employee detail → Give advance",
    enterHref: "/employees",
    output: [
      { label: "Cashbook", href: "/cash" },
      { label: "Reports → Wages", href: "/reports?kind=wages" },
    ],
  },
  {
    action: "Salary payout",
    enter: "Employee detail → Salary payout",
    enterHref: "/employees",
    output: [
      { label: "Cashbook", href: "/cash" },
      { label: "Reports → Wages", href: "/reports?kind=wages" },
    ],
  },
  {
    action: "New order",
    enter: "Client → New order",
    enterHref: "/clients",
    output: [
      { label: "Client detail", href: "/clients" },
      { label: "Dashboard pending orders", href: "/" },
    ],
  },
  {
    action: "Delivery",
    enter: "Order → Add delivery",
    enterHref: "/clients",
    output: [
      { label: "Reports → Sales", href: "/reports?kind=sales" },
      { label: "Cashbook", href: "/cash" },
    ],
  },
  {
    action: "Tipper trip",
    enter: "Tipper → New load",
    enterHref: "/tipper/new",
    output: [
      { label: "Tipper list", href: "/tipper" },
      { label: "Reports → Tipper", href: "/reports?kind=tipper" },
      { label: "Cashbook (if rent)", href: "/cash" },
    ],
  },
  {
    action: "Mason work",
    enter: "Mason → New work",
    enterHref: "/mason/new",
    output: [
      { label: "Mason list", href: "/mason" },
      { label: "Reports → Mason", href: "/reports?kind=mason" },
    ],
  },
  {
    action: "Loading work",
    enter: "Loading → New entry",
    enterHref: "/loading/new",
    output: [
      { label: "Loading list", href: "/loading" },
      { label: "Reports → Loading", href: "/reports?kind=loading" },
    ],
  },
  {
    action: "Expense",
    enter: "Expense → New expense",
    enterHref: "/expense/new",
    output: [
      { label: "Cashbook", href: "/cash" },
      { label: "Reports → Expense", href: "/reports?kind=expense" },
      { label: "Reports → Summary", href: "/reports?kind=summary" },
    ],
  },
  {
    action: "Brick return",
    enter: "Order → Add delivery → Returns section",
    enterHref: "/clients",
    output: [
      { label: "Reports → Sales (inline)", href: "/reports?kind=sales" },
      { label: "Client detail", href: "/clients" },
    ],
  },
  {
    action: "Attendance",
    enter: "Employee detail → Mark attendance",
    enterHref: "/employees",
    output: [{ label: "Employee history", href: "/employees" }],
  },
];

const sections: Array<{
  group: string;
  icon: IconName;
  items: Array<{ title: string; body: string; link?: string }>;
}> = [
  {
    group: "Dashboard",
    icon: "Home",
    items: [
      {
        title: "Quick action grid",
        body: "Six tap targets for the most common tasks. Tap Production to start an entry, Sale to go to clients, etc.",
      },
      {
        title: "Smart alerts",
        body: "Auto-generated warnings: low raw material stock, overdue dispatches, open advances.",
        link: "/",
      },
      {
        title: "7-day production chart",
        body: "Bricks produced each day for the past week, latest day highlighted in red.",
      },
      {
        title: "Stock pipeline",
        body: "Live counts of bricks in each stage: Produced → Drying → Curing → Ready.",
      },
    ],
  },
  {
    group: "Daily Production",
    icon: "Brick",
    items: [
      {
        title: "Shift + machine + size",
        body: "Pick day or night shift (rate auto-fills), assign a machine, choose brick size. The recipe shows how much cement / fly ash / powder will be deducted from stock.",
      },
      {
        title: "Damaged bricks",
        body: "Track damaged separately so good count is clear. Damaged still create a stock batch but show in red on the list.",
      },
      {
        title: "Multi-operator wage split",
        body: "Pick all operators on the line - total wage divides equally.",
      },
    ],
  },
  {
    group: "Reports",
    icon: "Chart",
    items: [
      {
        title: "Diary-style ledger",
        body: "Each report shows entries grouped by date with sub-totals per day and a grand total at the bottom - same layout the owner uses in his diary.",
        link: "/reports",
      },
      {
        title: "Summary tab (P&L)",
        body: "Net Profit hero number, income/expense breakdown, top expense categories, staff payment status, and Transport business as a separate P&L.",
        link: "/reports?kind=summary",
      },
      {
        title: "Excel and PDF export",
        body: "Every diary view exports to Excel (with formulas) or PDF (with brand letterhead). Buttons live top-right.",
      },
    ],
  },
  {
    group: "Clients & Sales",
    icon: "Receipt",
    items: [
      {
        title: "Order → Delivery → Payment",
        body: "An order can have multiple deliveries. Each delivery can include add-on products (cement, lintel) and returns. Balance updates automatically.",
        link: "/clients",
      },
      {
        title: "Inline returns",
        body: "Returns appear in the Sales report under their parent delivery - tracking exactly how the diary records them.",
      },
    ],
  },
  {
    group: "Tipper & Vendors",
    icon: "Truck",
    items: [
      {
        title: "Own RD vs vendor (AVM)",
        body: "Mark each tipper as own or vendor-owned. Vendor loads create a payable; own loads create a receivable when carrying for clients.",
        link: "/tipper",
      },
      {
        title: "EMI tracking",
        body: "Set monthly EMI on a tipper in Settings → Tippers. Pay an EMI as an Expense with category EMI.",
      },
    ],
  },
  {
    group: "Wages & Advances",
    icon: "Workers",
    items: [
      {
        title: "Operator advance",
        body: "Recorded against an operator. When the next salary is paid, mark advances as settled.",
      },
      {
        title: "Mason / Loader rates",
        body: "Mason rate per brick comes from the Price matrix (size × construction type). Loader is piece-rate per brick.",
        link: "/settings/price-matrix",
      },
    ],
  },
  {
    group: "Settings",
    icon: "Settings",
    items: [
      {
        title: "Master data lives here",
        body: "Brick sizes, construction types, price matrix, expense categories, materials, recipes, vendors, tippers, operators, masons, loaders, employees.",
        link: "/settings",
      },
      {
        title: "Material recipe",
        body: "Per 1000 bricks of each size, set how much of each material is consumed. Production decrements stock automatically.",
        link: "/settings/materials",
      },
    ],
  },
];

export default function GuidePage() {
  return (
    <>
      <PageHeader title="App guide" sub="What goes where, and where to see it" />

      <Card className="mb-5">
        <div className="text-base font-bold text-ink mb-2">Quick reference</div>
        <div className="text-xs text-slate-500 mb-3">
          Where to enter each action - and where the result shows up.
        </div>
        <div className="overflow-x-auto -mx-4">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-slate-50 border-y border-slate-200">
                <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                  Action
                </th>
                <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                  Enter at
                </th>
                <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                  See output at
                </th>
              </tr>
            </thead>
            <tbody>
              {quickRef.map((q) => (
                <tr key={q.action} className="border-b border-slate-100">
                  <td className="px-4 py-2.5 font-semibold text-ink">{q.action}</td>
                  <td className="px-4 py-2.5">
                    <Link href={q.enterHref} className="text-brand-blue hover:underline">
                      {q.enter}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-x-1.5 gap-y-0.5">
                      {q.output.map((o, i) => (
                        <Link
                          key={i}
                          href={o.href}
                          className="text-slate-700 hover:text-brand-red hover:underline"
                        >
                          {o.label}
                          {i < q.output.length - 1 && <span className="text-slate-300 ml-1.5">·</span>}
                        </Link>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="space-y-4">
        {sections.map((s) => {
          const Ic = Icon[s.icon];
          return (
            <Card key={s.group}>
              <div className="flex items-center gap-2.5 mb-3">
                <div className="w-9 h-9 rounded-xl bg-brand-redLight text-brand-red flex items-center justify-center">
                  <Ic size={18} />
                </div>
                <div className="text-base font-bold text-ink">{s.group}</div>
              </div>
              <div className="space-y-2.5">
                {s.items.map((it, i) => (
                  <div key={i} className="border-l-2 border-slate-200 pl-3">
                    <div className="text-[13px] font-semibold text-ink">
                      {it.link ? (
                        <Link href={it.link} className="hover:text-brand-red">
                          {it.title} <span className="text-brand-blue text-[11px]">↗</span>
                        </Link>
                      ) : (
                        it.title
                      )}
                    </div>
                    <div className="text-[12px] text-slate-600 mt-0.5">{it.body}</div>
                  </div>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
