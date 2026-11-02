import { requireArea } from "@/lib/auth";
import { NewCashEntryForm } from "./form";

// Server wrapper so this route carries its own access gate. The form itself is
// a client component ("use client" + useState/useTransition), and a client
// component can neither be async nor call requireArea — cookies() and
// redirect() are server-only — so the gate lives here and the interactive form
// moved to ./form.tsx. Same split the rest of the app already uses (see
// expense/new/page.tsx + expense/new/form.tsx).
export default async function NewCashEntryPage() {
  await requireArea("cash");
  return <NewCashEntryForm />;
}
