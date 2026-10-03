import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { Icon, IconName } from "@/components/icons";
import { requireAdminOrManager } from "@/lib/auth";
import { isAdmin } from "@/lib/access";

const sections: Array<{
  group: string;
  items: Array<{ href: string; label: string; sub: string; icon: IconName }>;
}> = [
  {
    group: "Factory",
    items: [
      { href: "/settings/factory", label: "Factory profile", sub: "Name, address, phone, GST", icon: "Building" },
      { href: "/settings/machines", label: "Machines", sub: "Production lines - rename or add", icon: "Tools" },
      { href: "/settings/users", label: "Users & access", sub: "Add logins, choose what each can see", icon: "Workers" },
      { href: "/settings/security", label: "Security", sub: "Change password", icon: "Settings" },
    ],
  },
  {
    group: "Pricing",
    items: [
      { href: "/settings/brick-sizes", label: "Brick sizes", sub: '6", 6"H, 8" - add/edit', icon: "Brick" },
      { href: "/settings/slab-sizes", label: "Lintel beam sizes", sub: "4, 5, 6 - add/edit", icon: "Brick" },
      { href: "/settings/construction-types", label: "Construction types", sub: "Room, Compound, Godown - add more", icon: "Building" },
      { href: "/settings/price-matrix", label: "Price matrix", sub: "Sell price + mason rate per size × type", icon: "Tag" },
    ],
  },
  {
    group: "People",
    items: [
      { href: "/settings/operators", label: "Operators", sub: "Production line workers", icon: "Users" },
      { href: "/settings/masons", label: "Masons", sub: "Site-laying workers", icon: "Hammer" },
      { href: "/settings/loaders", label: "Loaders", sub: "Truck loading workers", icon: "Box" },
      { href: "/settings/employees", label: "Employees", sub: "Drivers, watchmen, staff", icon: "Workers" },
    ],
  },
  {
    group: "Logistics",
    items: [
      { href: "/settings/vendors", label: "Vendors", sub: "AVM, etc.", icon: "Tag" },
      { href: "/settings/tippers", label: "Tippers", sub: "Own RD + vendor trucks", icon: "Truck" },
    ],
  },
  {
    group: "Catalogue",
    items: [
      { href: "/settings/expense-categories", label: "Expense categories", sub: "Cement, Diesel, EB, Mould, etc.", icon: "Tag" },
      { href: "/settings/materials", label: "Raw materials", sub: "Materials + usage per batch", icon: "Box" },
      { href: "/settings/material-stock", label: "Raw material stock", sub: "On-hand qty, reorder, add received", icon: "Stack" },
    ],
  },
  {
    group: "Data",
    items: [
      { href: "/archive", label: "Hide data & backups", sub: "Clear the books for a fresh start - nothing is lost", icon: "Download" },
    ],
  },
];

export default async function SettingsHub() {
  // Managers get in, but only for the Data group — hiding the books is
  // theirs to run; master data is not.
  const session = await requireAdminOrManager();
  const admin = isAdmin(session.role);
  const visible = admin ? sections : sections.filter((s) => s.group === "Data");
  return (
    <>
      <PageHeader
        title="Settings"
        sub={admin ? "Master data - admin can add or change anything" : "Hide the books for a fresh start"}
      />
      <div className="space-y-6">
        {visible.map((s) => (
          <div key={s.group}>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2 px-1">
              {s.group}
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {s.items.map((it) => {
                const Ic = Icon[it.icon];
                return (
                  <Link
                    key={it.href}
                    href={it.href}
                    className="bg-white rounded-2xl border border-slate-200 hover:border-slate-400 p-4 flex items-start gap-3 transition"
                  >
                    <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0">
                      <Ic size={18} color="#475569" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-bold text-ink">{it.label}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">{it.sub}</div>
                    </div>
                    <Icon.Chevron size={14} color="#94A3B8" />
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
