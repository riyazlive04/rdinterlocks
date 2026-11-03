import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { Icon } from "@/components/icons";
import { primaryNav, groupedNav, type NavItem } from "@/components/nav-config";
import { requireSession } from "@/lib/auth";

function Tile({ item }: { item: NavItem }) {
  const Ic = Icon[item.icon];
  return (
    <Link
      href={item.href}
      className="bg-white rounded-2xl p-4 border border-slate-200 hover:border-slate-400 transition flex flex-col items-start gap-3"
    >
      <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
        <Ic size={20} color="#475569" />
      </div>
      <div className="text-[14px] font-bold text-ink">{item.label}</div>
    </Link>
  );
}

/**
 * The mobile "More" sheet — the only route to anything outside the five
 * bottom-nav items, so every group must render here or a phone loses access
 * to it. Grouped by the same five headings as the sidebar.
 */
export default async function MenuPage() {
  const session = await requireSession();
  const nav = groupedNav(primaryNav, session);
  // The dashboard is already the home tab; repeating it here wastes a tile.
  const pinned = nav.pinned.filter((it) => it.id !== "home");

  return (
    <>
      <PageHeader title="Menu" sub="All sections" />

      <div className="space-y-6">
        {pinned.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {pinned.map((it) => (
              <Tile key={it.id} item={it} />
            ))}
          </div>
        )}

        {nav.groups.map((g) => (
          <section key={g.key} aria-labelledby={`menu-${g.key}`}>
            <h2
              id={`menu-${g.key}`}
              className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2 px-1"
            >
              {g.label}
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {g.items.map((it) => (
                <Tile key={it.id} item={it} />
              ))}
            </div>
          </section>
        ))}

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {nav.footer.map((it) => (
            <Tile key={it.id} item={it} />
          ))}
          <form action="/logout" method="post" className="contents">
            <button
              type="submit"
              className="bg-white rounded-2xl p-4 border border-slate-200 hover:border-red-300 transition flex flex-col items-start gap-3 text-left"
            >
              <div className="w-10 h-10 rounded-xl bg-brand-redLight flex items-center justify-center">
                <Icon.Logout size={20} color="#E11D2C" />
              </div>
              <div className="text-[14px] font-bold text-brand-red">Logout</div>
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
