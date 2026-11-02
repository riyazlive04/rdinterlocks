import { requireArea } from "@/lib/auth";
import { NewClientForm } from "./form";

// Server wrapper so this route carries its own access gate. The form is a
// client component (useState/useTransition/useRouter), which can neither be
// async nor call requireArea — cookies() and redirect() are server-only — so
// the gate lives here and the form moved to ./form.tsx. Same split the rest of
// the app already uses (see expense/new/page.tsx + expense/new/form.tsx).
export default async function NewClientPage() {
  await requireArea("sales");
  return <NewClientForm />;
}
