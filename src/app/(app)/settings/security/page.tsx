import { PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { SecurityForm } from "./form";
import { changePassword } from "../actions";

export default async function SecurityPage() {
  await requireAdmin();
  return (
    <>
      <PageHeader title="Security" sub="Change your admin password" back="/settings" />
      <SecurityForm
        onSave={async (data) => {
          "use server";
          await changePassword(data);
        }}
      />
    </>
  );
}
