/**
 * Dependency-free assertion harness for the flow suites in this folder.
 *
 * The repo has no test runner (see ARCHITECTURE.md); these scripts are run
 * directly with `npx tsx`, matching the existing scripts/check-archive-order.ts
 * and scripts/probe-routes.mjs conventions.
 */

type Result = { id: string; title: string; ok: boolean; detail?: string };

const results: Result[] = [];
let currentId = "??";
let currentTitle = "";

export function tc(id: string, title: string, body: () => void | Promise<void>) {
  return async () => {
    currentId = id;
    currentTitle = title;
    try {
      await body();
    } catch (e) {
      results.push({ id, title: `${title} :: threw`, ok: false, detail: (e as Error).message });
    }
  };
}

function pass(step: string) {
  results.push({ id: currentId, title: `${currentTitle} :: ${step}`, ok: true });
}
function fail(step: string, detail: string) {
  results.push({ id: currentId, title: `${currentTitle} :: ${step}`, ok: false, detail });
}

export function eq<T>(step: string, actual: T, expected: T) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) pass(step);
  else fail(step, `expected ${b}, got ${a}`);
}

export function ok(step: string, cond: boolean, detail = "condition was false") {
  if (cond) pass(step);
  else fail(step, detail);
}

export function throws(step: string, fn: () => unknown, match?: RegExp) {
  try {
    fn();
    fail(step, "expected it to throw, but it returned normally");
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    if (match && !match.test(msg)) fail(step, `threw "${msg}", which does not match ${match}`);
    else pass(step);
  }
}

export async function run(suiteName: string, cases: Array<() => Promise<void>>) {
  for (const c of cases) await c();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${suiteName} ===`);
  for (const r of results) {
    console.log(
      `${r.ok ? "  PASS" : "  FAIL"}  [${r.id}] ${r.title}${r.ok ? "" : `\n          -> ${r.detail}`}`
    );
  }
  console.log(`\n${results.length - failed.length}/${results.length} passed, ${failed.length} failed`);
  if (failed.length) process.exitCode = 1;
}
