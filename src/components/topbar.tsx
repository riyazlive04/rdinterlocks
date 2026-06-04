"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Icon } from "./icons";

export function MobileTopBar() {
  const pathname = usePathname();
  return (
    <div className="md:hidden sticky top-0 z-20 bg-white border-b border-slate-200 px-4 py-2.5 flex items-center justify-between">
      <Link href="/" className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-full overflow-hidden ring-1 ring-black/10">
          <Image src="/logo.svg" alt="RD" width={28} height={28} unoptimized />
        </div>
        <span className="display text-[13px] font-bold tracking-tight">
          RD <span className="text-brand-red">INTER</span>
          <span className="text-brand-blue">LOCK</span>
        </span>
      </Link>
      {pathname !== "/menu" && (
        <Link
          href="/logout"
          className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500"
          aria-label="Logout"
        >
          <Icon.Logout size={16} />
        </Link>
      )}
    </div>
  );
}
