import { PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { SecurityForm } from "./form";
import { changePassword } from "../actions";

export default async function SecurityPage() {
  const session = await requireAdmin();
  return (
    <>
      <PageHeader title="Security" sub="Change your own password" back="/settings" />
      <SecurityForm
        role={session.role}
        onSave={async (data) => {
          "use server";
          await changePassword(data);
        }}
      />
    </>
  );
}
