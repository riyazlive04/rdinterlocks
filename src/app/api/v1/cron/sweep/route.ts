import { NextRequest, NextResponse } from "next/server";
import { authenticateCron } from "@/lib/cron-auth";
import { autoAssignLeads, autoDraftQuotations, sweepExpiredQuotations } from "@/lib/auto-quote";

// POST (or GET) /api/v1/cron/sweep
//
// The sales-desk automation sweep: assign unowned leads, auto-DRAFT
// quotations for leads that have enough data to price, and move stale sent
// quotations to `expired`. Nothing here sends anything to a customer — an
// auto-drafted quotation lands in the review queue for a human.
//
// This app is NOT deployed on Vercel (it runs locally today and moves to a
// VPS), so there is no platform cron behind this. It is an authenticated HTTP
// endpoint, and scripts/run-sweep.mjs is the invoker you point Windows Task
// Scheduler or a VPS crontab at. Auth is the dedicated CRON_API_KEY, compared
// constant-time in lib/cron-auth.ts, failing CLOSED when unconfigured.
//
// Safe to call more often than needed: each stage is bounded by a batch cap
// and is idempotent in the only way that matters — a lead with a quotation is
// never re-drafted, an owned lead is never reassigned, and an already-expired
// quotation no longer matches the sweep's filter.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Some schedulers only issue GET (curl in a crontab, a shared host's "web
 * cron", Vercel Cron if this ever does land there). A POST-only route would
 * just collect 405s on a schedule with nothing in the app to show the sweep
 * never ran, so both verbs land on the same handler and the same key check.
 */
export async function GET(req: NextRequest) {
  return POST(req);
}

export async function POST(req: NextRequest) {
  if (!authenticateCron(req.headers)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const errors: Record<string, string> = {};

  // Each stage is awaited on its own and its failure recorded rather than
  // propagated: a broken price lookup must not cost the desk its lead
  // assignment or leave stale quotations showing as live. The library
  // functions already swallow per-row faults; this is the belt to that
  // braces, so the response always reports all three.
  const stage = async <T>(name: string, run: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await run();
    } catch (e) {
      console.error(`[cron/sweep] stage ${name} failed`, e);
      errors[name] = e instanceof Error ? e.message : String(e);
      return fallback;
    }
  };

  // Order matters: assign owners first so a lead auto-drafted in the same run
  // already has someone to route its review to (Settings.quoteReviewByOwner).
  const assign = await stage("assign", autoAssignLeads, { assigned: 0 });
  const draft = await stage("draft", autoDraftQuotations, {
    considered: 0,
    drafted: 0,
    skipped: {} as Record<string, number>,
    errors: 0,
  });
  const expiry = await stage("expiry", sweepExpiredQuotations, { expired: 0 });

  return NextResponse.json({
    ok: Object.keys(errors).length === 0,
    elapsedMs: Date.now() - startedAt,
    assign,
    draft,
    expiry,
    errors,
  });
}
