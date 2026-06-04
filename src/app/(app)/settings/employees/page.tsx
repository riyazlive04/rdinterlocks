import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { MasterList } from "@/components/master-list";
import { createEmployee, updateEmployee, deleteEmployee } from "../actions";

export default async function EmployeesSettingsPage() {
  const rows = await prisma.employee.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  return (
    <>
      <PageHeader
        title="Employees"
        sub="Drivers, watchmen, staff — pay daily or monthly"
        back="/settings"
      />
      <MasterList
        rows={rows.map((r) => ({
          id: r.id,
          name: r.name,
          role: r.role,
          payType: r.payType,
          payRate: r.payRate,
          phone: r.phone ?? "",
        }))}
        fields={[
          { type: "text", key: "name", label: "Name", required: true },
          { type: "text", key: "role", label: "Role", placeholder: "driver, watchman, staff…" },
          {
            type: "select",
            key: "payType",
            label: "Pay type",
            required: true,
            options: [
              { value: "monthly", label: "Monthly" },
              { value: "daily", label: "Daily" },
              { value: "hourly", label: "Hourly" },
            ],
          },
          { type: "number", key: "payRate", label: "Pay rate (₹)", required: true, step: "1" },
          { type: "text", key: "phone", label: "Phone" },
        ]}
        columns={[
          { key: "name", header: "Name", format: "bold" },
          { key: "role", header: "Role", format: "muted" },
          { key: "payType", header: "Pay", format: "capitalize" },
          { key: "payRate", header: "Rate", format: "currency" },
          { key: "phone", header: "Phone", format: "mono" },
        ]}
        onCreate={async (d) => {
          "use server";
          await createEmployee({
            name: String(d.name),
            role: String(d.role || "staff"),
            payType: d.payType as "monthly" | "daily" | "hourly",
            payRate: Number(d.payRate || 0),
            phone: String(d.phone || ""),
          });
        }}
        onUpdate={async (id, d) => {
          "use server";
          await updateEmployee(id, {
            name: String(d.name),
            role: String(d.role || "staff"),
            payType: d.payType as "monthly" | "daily" | "hourly",
            payRate: Number(d.payRate || 0),
            phone: String(d.phone || ""),
          });
        }}
        onDelete={async (id) => {
          "use server";
          await deleteEmployee(id);
        }}
        addLabel="Add employee"
      />
    </>
  );
}
