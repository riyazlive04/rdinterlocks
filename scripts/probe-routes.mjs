import { SignJWT } from "jose";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const owner = await prisma.user.findFirst({ where: { role: "admin" } });
if (!owner) throw new Error("No admin user — run npm run db:seed");

const secret = new TextEncoder().encode(process.env.SESSION_SECRET);
const token = await new SignJWT({ userId: owner.id, name: owner.name, role: owner.role })
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt()
  .setExpirationTime("30d")
  .sign(secret);

const cookie = `rd_session=${token}`;

const client = await prisma.client.findFirst();
const employee = await prisma.employee.findFirst();

const routes = [
  "/",
  "/menu",
  "/production",
  "/production/new",
  "/expense",
  "/expense/new",
  "/tipper",
  "/tipper/new",
  "/mason",
  "/mason/new",
  "/loading",
  "/loading/new",
  "/clients",
  "/clients/new",
  client ? `/clients/${client.id}` : null,
  client ? `/clients/${client.id}/orders/new` : null,
  "/employees",
  employee ? `/employees/${employee.id}` : null,
  "/cash",
  "/cash/new",
  "/vehicles",
  "/vehicles?tab=emi",
  "/vehicles?tab=expenses",
  "/guide",
  "/reports",
  "/reports?kind=summary",
  "/reports?kind=production",
  "/reports?kind=sales",
  "/reports?kind=expense",
  "/reports?kind=tipper",
  "/reports?kind=mason",
  "/reports?kind=loading",
  "/reports?kind=wages",
  "/reports?kind=cashbook",
  "/settings",
  "/settings/factory",
  "/settings/security",
  "/settings/brick-sizes",
  "/settings/construction-types",
  "/settings/price-matrix",
  "/settings/expense-categories",
  "/settings/materials",
  "/settings/operators",
  "/settings/masons",
  "/settings/loaders",
  "/settings/employees",
  "/settings/vendors",
  "/settings/tippers",
].filter(Boolean);

let failures = 0;
for (const path of routes) {
  const res = await fetch(`http://localhost:3000${path}`, {
    headers: { cookie },
    redirect: "manual",
  });
  const ok = res.status >= 200 && res.status < 400;
  console.log(`${ok ? "✓" : "✗"} ${path}: ${res.status}`);
  if (!ok) {
    failures++;
    const body = await res.text();
    console.log(`  ${body.slice(0, 300)}`);
  }
}

console.log(`\n${failures === 0 ? "✓ All routes OK" : `✗ ${failures} failures`}`);
await prisma.$disconnect();
process.exit(failures > 0 ? 1 : 0);
