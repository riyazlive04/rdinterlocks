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
    action: "Fast day sheet",
    enter: "Day → add size rows",
    enterHref: "/day",
    output: [
      { label: "Production list", href: "/production" },
      { label: "Dashboard", href: "/" },
    ],
  },
  {
    action: "Client payment / advance",
    enter: "Client page → Record payment",
    enterHref: "/clients",
    output: [
      { label: "Cashbook", href: "/cash" },
      { label: "Client detail", href: "/clients" },
    ],
  },
  {
    action: "New order",
    enter: "Client → New order",
    enterHref: "/clients",
    output: [
      { label: "Client detail", href: "/clients" },
      { label: "Dashboard orders", href: "/" },
    ],
  },
  {
    action: "Delivery",
    enter: "Order → Add delivery",
    enterHref: "/clients",
    output: [
      { label: "Deliveries log", href: "/deliveries" },
      { label: "Reports → Sales", href: "/reports?kind=sales" },
      { label: "Cashbook", href: "/cash" },
    ],
  },
  {
    action: "Evening delivery check",
    enter: "Deliveries → mark done",
    enterHref: "/deliveries",
    output: [{ label: "Deliveries log", href: "/deliveries" }],
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
    action: "Worker advance",
    enter: "Payroll → Record advance",
    enterHref: "/payroll",
    output: [
      { label: "Cashbook", href: "/cash" },
      { label: "Payroll", href: "/payroll" },
    ],
  },
  {
    action: "Pay salary / settle",
    enter: "Payroll → Settle",
    enterHref: "/payroll",
    output: [
      { label: "Cashbook", href: "/cash" },
      { label: "Reports → Salary", href: "/reports?kind=wages" },
      { label: "Payroll", href: "/payroll" },
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
    action: "Expense",
    enter: "Expense → New expense",
    enterHref: "/expense/new",
    output: [
      { label: "Cashbook", href: "/cash" },
      { label: "Reports → Expense", href: "/reports?kind=expense" },
    ],
  },
  {
    action: "Pay EMI",
    enter: "Vehicles → Pay EMI",
    enterHref: "/vehicles",
    output: [
      { label: "Cashbook", href: "/cash" },
      { label: "Vehicles → EMI", href: "/vehicles" },
    ],
  },
  {
    action: "Brick return",
    enter: "Order → Add delivery → Returns",
    enterHref: "/clients",
    output: [
      { label: "Reports → Sales", href: "/reports?kind=sales" },
      { label: "Client detail", href: "/clients" },
    ],
  },
  {
    action: "Attendance",
    enter: "Employee detail → Mark attendance",
    enterHref: "/employees",
    output: [{ label: "Employee history", href: "/employees" }],
  },
  {
    action: "Add a login",
    enter: "Settings → Users & access",
    enterHref: "/settings/users",
    output: [{ label: "Users & access", href: "/settings/users" }],
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
        body: "Tap targets for the most common tasks - Production, Sale, Expense and more.",
      },
      {
        title: "Smart alerts",
        body: "Auto warnings: low raw material stock, overdue deliveries, open advances not yet settled.",
        link: "/",
      },
      {
        title: "Stock pipeline",
        body: "Live counts per stage: Produced → Drying → Curing → Ready. Batches move stage automatically by age.",
        link: "/",
      },
      {
        title: "Revenue is role-based",
        body: "Cash, profit and revenue figures only show for admins. A manager without the Revenue area won't see them.",
      },
    ],
  },
  {
    group: "Daily Production",
    icon: "Brick",
    items: [
      {
        title: "Single entry",
        body: "Shift (rate auto-fills), machine, brick size. The recipe shows the material deducted from stock. You can log several entries for one machine on the same day.",
        link: "/production/new",
      },
      {
        title: "Fast day sheet",
        body: "One date / shift / operator set with many brick-size rows - each row becomes its own stock batch and salary split.",
        link: "/day",
      },
      {
        title: "Multi-operator salary split",
        body: "Pick all operators on the line - the total salary divides equally.",
      },
      {
        title: "Per-size day & night rate",
        body: "Set a day and night piece-rate per brick size in Settings → Brick sizes; production auto-fills it.",
        link: "/settings/brick-sizes",
      },
    ],
  },
  {
    group: "Stock pipeline",
    icon: "Box",
    items: [
      {
        title: "Auto staging by age",
        body: "Each batch advances Produced → Drying → Curing → Ready based on the number of days since it was produced.",
      },
      {
        title: "Set drying & curing days",
        body: "Choose how many days each stage lasts in Settings → Factory; the pipeline counts update accordingly.",
        link: "/settings/factory",
      },
    ],
  },
  {
    group: "Clients & Sales",
    icon: "Receipt",
    items: [
      {
        title: "Order → Delivery → Payment",
        body: "An order can have multiple deliveries, each with add-on products (cement, lintel) and returns. The balance updates automatically.",
        link: "/clients",
      },
      {
        title: "Add a client inline (with advance)",
        body: "Create a new client while taking an order and record an opening advance at the same time.",
        link: "/clients/new",
      },
      {
        title: "Deliveries log",
        body: "A date-sorted list of deliveries for the evening check - tap to mark a delivery done.",
        link: "/deliveries",
      },
    ],
  },
  {
    group: "Reports",
    icon: "Chart",
    items: [
      {
        title: "Diary-style ledger",
        body: "Each report groups entries by date with daily sub-totals and a grand total - the same layout the owner uses in his diary.",
        link: "/reports",
      },
      {
        title: "Summary (P&L)",
        body: "Net profit, income/expense breakdown, staff payment status and a separate transport P&L. Hidden for users without Revenue access.",
        link: "/reports?kind=summary",
      },
      {
        title: "Excel & PDF export",
        body: "Every diary view exports to Excel (with formulas) or branded PDF. Buttons live top-right.",
      },
    ],
  },
  {
    group: "Salary & Advances",
    icon: "Workers",
    items: [
      {
        title: "Payroll in one place",
        body: "Everyone's earned, advances, paid and net payable for the month - operators, masons, loaders and employees together.",
        link: "/payroll",
      },
      {
        title: "Record advance (any worker)",
        body: "Payroll → Record advance works for operators, masons, loaders and employees. It posts a cash-out and shows under that person.",
      },
      {
        title: "Settle / pay salary",
        body: "Payroll → Settle pays the net wage, deducts (settles) open advances and posts the cash-out. Net payable then reads zero.",
      },
      {
        title: "Mason / Loader rates",
        body: "Mason rate per brick comes from the Price matrix (size × construction type); loader is piece-rate per brick.",
        link: "/settings/price-matrix",
      },
    ],
  },
  {
    group: "Tipper & Vehicles",
    icon: "Truck",
    items: [
      {
        title: "Own RD vs vendor (AVM)",
        body: "Mark each tipper as own or vendor-owned. Vendor loads create a payable; own loads create a receivable when carrying for clients.",
        link: "/tipper",
      },
      {
        title: "EMI tracking",
        body: "Set the monthly EMI in Settings → Tippers. On Vehicles → EMI, tap Pay - the vehicle, amount and title are pre-filled into a new expense.",
        link: "/vehicles",
      },
    ],
  },
  {
    group: "Cashbook",
    icon: "Tag",
    items: [
      {
        title: "One source of truth",
        body: "Every money movement - sales, expenses, advances, salary, tipper rent and EMI - posts here automatically. Cash in hand is always live.",
        link: "/cash",
      },
      {
        title: "Pick a date range",
        body: "Today / This week / This month / All, or a custom range - plus filters by type (Salary, Advance, Expense, Sales…).",
      },
    ],
  },
  {
    group: "Settings & Access",
    icon: "Settings",
    items: [
      {
        title: "Master data lives here",
        body: "Brick sizes & rates, construction types, price matrix, expense categories, materials, recipes, vendors, tippers, operators, masons, loaders, employees.",
        link: "/settings",
      },
      {
        title: "Users & access",
        body: "Create logins and choose which areas each user can see. Leave Revenue off to hide all money totals from a manager.",
        link: "/settings/users",
      },
      {
        title: "Signing in",
        body: "Each person signs in with their own username + password. Set or change passwords under Users & access.",
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
