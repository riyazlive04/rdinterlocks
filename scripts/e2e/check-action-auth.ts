/**
 * Invariant: EVERY exported Server Action performs an authorization check.
 *
 * A Server Action is not an internal function call — Next.js publishes each
 * one as its own callable HTTP endpoint. Gating the page that renders the form
 * does nothing for the action behind it: any authenticated user can invoke any
 * action by id. src/middleware.ts only proves a session is *valid*; it reads no
 * role and no permission. So an action without its own check is reachable by
 * every logged-in user regardless of their access areas — which for
 * createUser/updateUser is privilege escalation to admin, and for
 * updateQuoteContent means rewriting the UPI id that customers pay into.
 *
 * This is a static check in the spirit of scripts/check-archive-order.ts: it
 * reads the source rather than running it, so it costs nothing and cannot be
 * forgotten the next time an action is added.
 *
 * Run: npx tsx scripts/e2e/check-action-auth.ts
 */

import fs from "fs";
import path from "path";

const GATES = [
  "requireAdmin(",
  "requireArea(",
  "requireAnyArea(",
  "requireAdminOrManager(",
  "requireSession(",
  // Feature-local wrappers that call one of the above.
  "requireQuotationWrite(",
  "requireWhatsappWrite(",
];

/**
 * Actions that legitimately need no gate. Keep this empty unless there is a
 * real reason, and state the reason — an entry here is a standing exemption
 * from the app's entire authorization model.
 */
const EXEMPT: Record<string, string> = {};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name === "actions.ts") out.push(full);
  }
  return out;
}

type Finding = { file: string; action: string };

function findUngated(file: string): Finding[] {
  const src = fs.readFileSync(file, "utf8");
  const findings: Finding[] = [];

  const starts: number[] = [];
  const re = /^export async function (\w+)/gm;
  const names: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    starts.push(m.index);
    names.push(m[1]);
  }

  for (let i = 0; i < starts.length; i++) {
    const begin = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1] : src.length;

    // The body starts at the first "{" AFTER the parameter list closes —
    // a parameter can itself be an inline object type, so counting braces
    // from the signature would find the wrong one.
    const pOpen = src.indexOf("(", begin);
    let depth = 0;
    let j = pOpen;
    for (; j < end; j++) {
      if (src[j] === "(") depth++;
      else if (src[j] === ")" && --depth === 0) break;
    }
    const body = src.slice(src.indexOf("{", j), end);

    const action = names[i];
    if (EXEMPT[action]) continue;
    if (!GATES.some((g) => body.includes(g))) findings.push({ file, action });
  }
  return findings;
}

const files = walk(path.join(process.cwd(), "src", "app"));
const findings = files.flatMap(findUngated);
const total = files.reduce((n, f) => n + (fs.readFileSync(f, "utf8").match(/^export async function /gm)?.length ?? 0), 0);

console.log(`Checked ${total} exported Server Action(s) across ${files.length} actions.ts file(s).`);

if (findings.length === 0) {
  console.log("PASS — every Server Action performs an authorization check.");
} else {
  console.error(`\nFAIL — ${findings.length} Server Action(s) have no authorization check:\n`);
  for (const f of findings) {
    console.error(`  ${path.relative(process.cwd(), f.file)} -> ${f.action}()`);
  }
  console.error(
    "\nAdd requireArea(\"<area>\") (see src/lib/access.ts) or requireAdmin() as the\n" +
      "first statement of each, matching the gate its own page already uses."
  );
  process.exitCode = 1;
}
