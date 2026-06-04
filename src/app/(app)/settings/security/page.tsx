import { PageHeader } from "@/components/ui";
import { SecurityForm } from "./form";
import { changePassword } from "../actions";

export default function SecurityPage() {
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
