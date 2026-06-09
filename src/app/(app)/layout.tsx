import { requireSession } from "@/lib/auth";
import { Sidebar } from "@/components/sidebar";
import { BottomNav } from "@/components/bottom-nav";
import { MobileTopBar } from "@/components/topbar";
import { FloatingActions } from "@/components/floating-actions";
import { primaryNav, mobileNav, visibleNav } from "@/components/nav-config";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const sideItems = visibleNav(primaryNav, session);
  const bottomItems = visibleNav(mobileNav, session);
  return (
    <div className="min-h-screen flex bg-paper">
      <Sidebar userName={session.name} role={session.role} items={sideItems} />
      <div className="flex-1 min-w-0 flex flex-col">
        <MobileTopBar />
        <main className="flex-1 px-4 md:px-8 py-4 md:py-6 pb-28 md:pb-8 max-w-screen-xl w-full mx-auto">
          {children}
        </main>
        <BottomNav items={bottomItems} />
        <FloatingActions />
      </div>
    </div>
  );
}
