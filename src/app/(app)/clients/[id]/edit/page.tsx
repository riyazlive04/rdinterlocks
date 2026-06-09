import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { EditClientForm } from "./form";
import { updateClient } from "../../actions";

export default async function EditClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) notFound();

  return (
    <>
      <PageHeader title={`Edit - ${client.name}`} back={`/clients/${id}`} />
      <EditClientForm
        initial={{
          name: client.name,
          location: client.location ?? "",
          phone: client.phone ?? "",
          notes: client.notes ?? "",
        }}
        onSubmit={async (d) => {
          "use server";
          await updateClient(id, d);
        }}
      />
    </>
  );
}
