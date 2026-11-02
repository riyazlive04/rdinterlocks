/**
 * Invariant: EVERY route page gates its own read access.
 *
 * (app)/layout.tsx calls requireSession(), so an unauthenticated visitor never
 * gets in — but that is all it proves. It checks no area and no role, and
 * src/middleware.ts only validates that the session token verifies. A page
 * without its own gate is therefore readable by every logged-in user
 * regardless of their access areas: the nav hides the link (visibleNav in
 * components/nav-config.ts), but typing the URL still renders it. That is how
 * a loading-crew login could read the full client ledger, or open
 * /settings/price-matrix.
 *
 * Two rules, both checked here:
 *
 *   1. Every page.tsx calls one of the gate helpers from lib/auth.
 *   2. No page.tsx is a client component. A client component can neither be
 *      async nor call requireArea (cookies()/redirect() are server-only), so
 *      it CANNOT gate itself — it has to become a server page that renders a
 *      client form, the split used by expense/new, cash/new and clients/new.
 *
 * Static, like scripts/check-archive-order.ts — it reads the source.
 *
 * Run: npx tsx scripts/e2e/check-page-auth.ts
 */

import fs from "fs";
import path from "path";

const GATES = [
  "requireAdmin(",
  "requireArea(",
  "requireAnyArea(",
  "requireAdminOrManager(",
  "requireSession(",
];

/**
 * Pages outside the (app) group that must stay reachable without a session.
 * /login is the sign-in screen itself; gating it would lock everyone out.
 */
const PUBLIC_PAGES = ["src/app/login/page.tsx"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name === "page.tsx") out.push(full);
  }
  return out;
}

/** Strip comments so a gate name quoted in prose can't satisfy the check. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const pages = walk(path.join(process.cwd(), "src", "app"));
const ungated: string[] = [];
const clientPages: string[] = [];

for (const file of pages) {
  const rel = path.relative(process.cwd(), file).replace(/\\/g, "/");
  if (PUBLIC_PAGES.includes(rel)) continue;

  const code = stripComments(fs.readFileSync(file, "utf8"));
  if (/^\s*["']use client["']/m.test(code)) clientPages.push(rel);
  if (!GATES.some((g) => code.includes(g))) ungated.push(rel);
}

console.log(`Checked ${pages.length} route page(s) (${PUBLIC_PAGES.length} public page(s) exempt).`);

if (ungated.length === 0 && clientPages.length === 0) {
  console.log("PASS — every route page gates its own access, and none is a client component.");
} else {
  if (ungated.length) {
    console.error(`\nFAIL — ${ungated.length} page(s) have no access gate:\n`);
    for (const p of ungated) console.error(`  ${p}`);
    console.error(
      '\nAdd requireArea("<area>") (see src/lib/access.ts; the nav item id in\n' +
        "components/nav-config.ts is the area key) or requireAdmin() as the first\n" +
        "statement of the page component."
    );
  }
  if (clientPages.length) {
    console.error(`\nFAIL — ${clientPages.length} page(s) are client components and cannot gate themselves:\n`);
    for (const p of clientPages) console.error(`  ${p}`);
    console.error(
      "\nMove the interactive part to ./form.tsx and make page.tsx a server\n" +
        "component that awaits the gate and renders it (see cash/new/)."
    );
  }
  process.exitCode = 1;
}
