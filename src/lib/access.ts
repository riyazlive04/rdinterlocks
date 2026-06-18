// Areas of the app that access can be granted for. The admin/owner role
// always has full access; other users get only the areas in their
// `permissions` list. "revenue" is special — it gates money totals
// (dashboard cash/profit, reports revenue, cashbook) rather than a page.
export const ACCESS_AREAS = [
  { key: "production", label: "Production" },
  { key: "day", label: "Daily entry" },
  { key: "sales", label: "Clients & Sales" },
  { key: "deliveries", label: "Deliveries" },
  { key: "tipper", label: "Tipper" },
  { key: "mason", label: "Mason work" },
  { key: "loading", label: "Loading work" },
  { key: "expense", label: "Expense" },
  { key: "employees", label: "Employees" },
  { key: "leave", label: "Leave marking" },
  { key: "payroll", label: "Payroll" },
  { key: "cash", label: "Cashbook" },
  { key: "reports", label: "Reports" },
  { key: "vehicles", label: "Vehicles & EMI" },
  { key: "revenue", label: "See revenue, profit & cash totals" },
] as const;

export type AreaKey = (typeof ACCESS_AREAS)[number]["key"];

export type AccessUser = { role: string; permissions: string[] };

export function isAdmin(role: string) {
  return role === "admin" || role === "owner";
}

export function can(user: AccessUser, area: string) {
  if (isAdmin(user.role)) return true;
  return user.permissions.includes(area);
}
