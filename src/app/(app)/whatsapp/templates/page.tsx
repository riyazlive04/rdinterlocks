import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { MasterList } from "@/components/master-list";
import { createWaTemplate, updateWaTemplate, deleteWaTemplate } from "../actions";

export default async function WaTemplatesPage() {
  await requireAdmin();
  const rows = await prisma.waTemplate.findMany({ where: { active: true }, orderBy: { name: "asc" } });

  return (
    <>
      <PageHeader
        title="WhatsApp templates"
        sub="Records of templates approved in the Meta Business dashboard — only approved templates can ever be sent"
        back="/whatsapp"
      />
      <MasterList
        rows={rows.map((r) => ({
          id: r.id,
          name: r.name,
          language: r.language,
          category: r.category,
          variableCount: r.variableCount,
          approved: r.approved,
        }))}
        fields={[
          { type: "text", key: "name", label: "Template name (exact, as in Meta)", required: true },
          { type: "text", key: "language", label: "Language code", placeholder: "en_US" },
          { type: "text", key: "category", label: "Category", placeholder: "utility" },
          { type: "number", key: "variableCount", label: "Body variables", placeholder: "0" },
          { type: "checkbox", key: "approved", label: "Approved in Meta (can be sent)" },
        ]}
        columns={[
          { key: "name", header: "Name", format: "bold" },
          { key: "language", header: "Language", format: "mono" },
          { key: "category", header: "Category", format: "capitalize" },
          { key: "variableCount", header: "Vars", format: "number" },
          { key: "approved", header: "Approved", format: "capitalize" },
        ]}
        onCreate={async (d) => {
          "use server";
          await createWaTemplate({
            name: String(d.name),
            language: String(d.language || "en_US"),
            category: String(d.category || "utility"),
            variableCount: Number(d.variableCount || 0),
            approved: !!d.approved,
          });
        }}
        onUpdate={async (id, d) => {
          "use server";
          await updateWaTemplate(id, {
            name: String(d.name),
            language: String(d.language || "en_US"),
            category: String(d.category || "utility"),
            variableCount: Number(d.variableCount || 0),
            approved: !!d.approved,
          });
        }}
        onDelete={async (id) => {
          "use server";
          await deleteWaTemplate(id);
        }}
        addLabel="Add template"
        emptyText="No templates yet. Add the templates you've had approved in Meta Business Manager."
      />
    </>
  );
}
