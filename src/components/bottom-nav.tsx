"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Icon } from "./icons";
import { isNavActive, type NavItem } from "./nav-config";

export function BottomNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <div className="md:hidden fixed left-0 right-0 bottom-0 z-30 bg-white border-t border-slate-200 pb-[env(safe-area-inset-bottom)]">
      <nav
        className="grid max-w-[420px] mx-auto"
        style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      >
        {items.map((it) => {
          const Ic = Icon[it.icon];
          const active = isNavActive(it, pathname);
          return (
            <Link
              key={it.id}
              href={it.href}
              className="flex flex-col items-center justify-center py-2.5 gap-0.5"
            >
              <Ic
                size={22}
                color={active ? "#E11D2C" : "#94A3B8"}
                stroke={active ? 2 : 1.6}
              />
              <span
                className={clsx(
                  "text-[10px]",
                  active ? "font-semibold text-brand-red" : "font-medium text-slate-500"
                )}
              >
                {it.label}
              </span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
