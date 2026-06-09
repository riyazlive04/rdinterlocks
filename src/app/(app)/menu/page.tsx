import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { Icon } from "@/components/icons";
import { primaryNav, visibleNav } from "@/components/nav-config";
import { requireSession } from "@/lib/auth";

export default async function MenuPage() {
  const session = await requireSession();
  return (
    <>
      <PageHeader title="Menu" sub="All sections" />
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {visibleNav(primaryNav, session)
          .filter((it) => it.id !== "home")
          .map((it) => {
            const Ic = Icon[it.icon];
            return (
              <Link
                key={it.id}
                href={it.href}
                className="bg-white rounded-2xl p-4 border border-slate-200 hover:border-slate-400 transition flex flex-col items-start gap-3"
              >
                <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
                  <Ic size={20} color="#475569" />
                </div>
                <div className="text-[14px] font-bold text-ink">{it.label}</div>
              </Link>
            );
          })}
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
    </>
  );
}
