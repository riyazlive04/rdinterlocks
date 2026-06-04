import { requireSession } from "@/lib/auth";
import { Sidebar } from "@/components/sidebar";
import { BottomNav } from "@/components/bottom-nav";
import { MobileTopBar } from "@/components/topbar";
import { FloatingActions } from "@/components/floating-actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  return (
    <div className="min-h-screen flex bg-paper">
      <Sidebar userName={session.name} />
      <div className="flex-1 min-w-0 flex flex-col">
        <MobileTopBar />
        <main className="flex-1 px-4 md:px-8 py-4 md:py-6 pb-24 md:pb-8 max-w-screen-xl w-full mx-auto">
          {children}
        </main>
        <BottomNav />
        <FloatingActions />
      </div>
    </div>
  );
}
