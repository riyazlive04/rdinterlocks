import { redirect } from "next/navigation";
import Image from "next/image";
import { createSession, getSession, verifyPin } from "@/lib/auth";

async function loginAction(formData: FormData) {
  "use server";
  const password = String(formData.get("password") ?? "").trim();
  if (!password) return redirect("/login?error=missing");
  const session = await verifyPin(password);
  if (!session) return redirect("/login?error=invalid");
  await createSession(session);
  redirect("/");
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getSession();
  if (session) redirect("/");
  const params = await searchParams;
  const error = params?.error;
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 bg-gradient-to-b from-slate-100 via-paper to-paper">
      <div className="w-full max-w-[380px]">
        <div className="flex flex-col items-center mb-8">
          <div className="w-20 h-20 rounded-full overflow-hidden ring-2 ring-black/10 mb-4 shadow-cardLg">
            <Image src="/logo.svg" alt="RD Interlock Bricks" width={80} height={80} unoptimized />
          </div>
          <div className="display text-xl font-bold tracking-tight">
            RD <span className="text-brand-red">INTER</span>
            <span className="text-brand-blue">LOCK</span> Bricks
          </div>
          <div className="mono text-[10px] font-medium text-slate-500 tracking-widest uppercase mt-1">
            Factory Operations System
          </div>
        </div>
        <div className="bg-white rounded-2xl shadow-cardLg border border-slate-900/[.06] p-6">
          <h1 className="text-lg font-bold text-ink tracking-tight">Welcome back</h1>
          <p className="text-sm text-slate-500 mt-1">Sign in to continue</p>
          <form action={loginAction} className="mt-5 space-y-3">
            <div className="px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-500 flex items-center justify-between">
              <span><span className="font-semibold text-ink">Admin</span></span>
              <span className="text-[10px] uppercase tracking-wider text-slate-400">Owner</span>
            </div>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              placeholder="Password"
              autoFocus
              className="w-full px-3.5 py-3 rounded-xl bg-white border border-slate-200 text-base text-ink focus:outline-none focus:ring-2 focus:ring-brand-red/30 focus:border-brand-red"
              required
            />
            {error && (
              <div className="text-xs text-red-600 text-center">
                {error === "invalid" ? "Incorrect password" : "Please enter your password"}
              </div>
            )}
            <button
              type="submit"
              className="w-full py-3.5 rounded-xl text-white font-bold text-base shadow-red bg-brand-red hover:bg-brand-redDark transition"
            >
              Sign in
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
