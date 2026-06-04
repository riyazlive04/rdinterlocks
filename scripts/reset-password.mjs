// Resets the admin password without touching any other data.
//   Default: reads DEFAULT_PASSWORD from .env (currently "Admin@123")
//   Override: pass a password as the first argument
//     node --env-file=.env scripts/reset-password.mjs MyNewPass
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const password = process.argv[2] ?? process.env.DEFAULT_PASSWORD ?? "Admin@123";

const owner = await prisma.user.findFirst({ where: { role: "admin" } });
if (!owner) {
  console.error("No admin user — run `npm run db:seed` first.");
  process.exit(1);
}

await prisma.user.update({
  where: { id: owner.id },
  data: { pinHash: await bcrypt.hash(password, 10) },
});

// Verify by attempting a real compare
const fresh = await prisma.user.findUnique({ where: { id: owner.id } });
const ok = await bcrypt.compare(password, fresh.pinHash);

console.log(`✓ Admin password reset`);
console.log(`  Login:    Admin`);
console.log(`  Password: ${password}`);
console.log(`  Verified: ${ok ? "YES" : "NO (something is wrong)"}`);

await prisma.$disconnect();
