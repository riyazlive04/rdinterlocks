"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Icon } from "./icons";
import { mobileNav, isNavActive } from "./nav-config";

export function BottomNav() {
  const pathname = usePathname();
  return (
    <div className="md:hidden fixed left-0 right-0 bottom-0 z-30 bg-white border-t border-slate-200 pb-[env(safe-area-inset-bottom)]">
      <nav className="grid grid-cols-5 max-w-[420px] mx-auto">
        {mobileNav.map((it) => {
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
