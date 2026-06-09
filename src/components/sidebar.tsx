"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Icon } from "./icons";
import { isNavActive, type NavItem } from "./nav-config";

export function Sidebar({
  userName,
  role,
  items,
}: {
  userName: string;
  role: string;
  items: NavItem[];
}) {
  const pathname = usePathname();
  return (
    <aside className="hidden md:flex md:w-60 lg:w-64 flex-shrink-0 bg-white border-r border-slate-200 flex-col h-screen sticky top-0">
      <div className="px-5 py-5 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-full overflow-hidden ring-1 ring-black/10">
            <Image src="/logo.svg" alt="RD Interlock" width={36} height={36} unoptimized />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="display text-[14px] font-bold tracking-tight">
              RD <span className="text-brand-red">INTER</span>
              <span className="text-brand-blue">LOCK</span>
            </span>
            <span className="mono text-[9px] font-medium text-slate-500 tracking-widest uppercase">
              Bricks
            </span>
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2.5 py-3 space-y-0.5">
        {items.map((it) => {
          const Ic = Icon[it.icon];
          const active = isNavActive(it, pathname);
          return (
            <Link
              key={it.id}
              href={it.href}
              className={clsx(
                "flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[13px] transition-colors",
                active
                  ? "bg-ink text-white font-semibold"
                  : "text-slate-700 font-medium hover:bg-slate-100"
              )}
            >
              <Ic
                size={17}
                color={active ? "#fff" : "#475569"}
                stroke={active ? 2 : 1.6}
              />
              <span className="flex-1">{it.label}</span>
              {active && (
                <span className="w-1.5 h-1.5 rounded-full bg-brand-red" />
              )}
            </Link>
          );
        })}
      </nav>

      <div className="px-3 py-3 border-t border-slate-100">
        <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg">
          <div className="w-8 h-8 rounded-full bg-ink text-white flex items-center justify-center text-[12px] font-bold">
            {userName.slice(0, 1).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-ink truncate">{userName}</div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">{role}</div>
          </div>
          <Link
            href="/logout"
            className="text-slate-500 hover:text-ink p-1.5 rounded-md hover:bg-slate-100"
            aria-label="Logout"
          >
            <Icon.Logout size={16} />
          </Link>
        </div>
      </div>
    </aside>
  );
}
