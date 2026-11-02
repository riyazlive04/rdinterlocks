import { NextRequest, NextResponse } from "next/server";
import { randomUUID, createHash, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/db";
import { sendWaMessage } from "@/lib/whatsapp-send";

// POST /api/v1/whatsapp/tick
//
// Driven by Vercel Cron, nothing else — this is the ONLY place scheduled
// WhatsApp sends happen. Auth is a dedicated CRON_API_KEY (not
// INTEGRATION_API_KEYS — a leaked Transcriber/Meta key must not be able to
// trigger sends), compared constant-time exactly like api-auth.ts, and fails
// CLOSED when unconfigured.
//
// Claims due WaEnrollment rows with a guarded updateMany (same optimistic
// shape as convertLeadCore's claim) so two overlapping cron invocations can
// never both process the same row. A batch size cap bounds one invocation to
// the function timeout; whatever's left just waits for the next firing —
// that's the whole "resumable" story, no separate resume state needed. A
// claim older than 10 minutes is treated as abandoned (crashed invocation)
// and reclaimed.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BATCH_SIZE = 25;
const STALE_CLAIM_MS = 10 * 60 * 1000;
const REFUSED_BACKOFF_MS = 60 * 60 * 1000; // e.g. template not yet approved
const FAILED_BACKOFF_MS = 30 * 60 * 1000; // e.g. transient Graph API error

function keyMatches(presented: string, expected: string): boolean {
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function authenticate(headers: Headers): boolean {
  const expected = process.env.CRON_API_KEY;
  if (!expected) return false; // fail closed — no key configured, no sends
  const auth = headers.get("authorization")?.trim();
  const presented = auth ? auth.replace(/^Bearer\s+/i, "").trim() : headers.get("x-api-key")?.trim();
  if (!presented) return false;
  return keyMatches(presented, expected);
}

/**
 * Vercel Cron invokes its target with GET, not POST — a cron entry pointed at
 * a POST-only route just collects 405s on a schedule, with nothing in the app
 * to show that nurturing never ran. Both verbs land on the same handler and
 * the same CRON_API_KEY check; Vercel sends the key as
 * `Authorization: Bearer …`, which authenticate() already accepts.
 */
export async function GET(req: NextRequest) {
  return POST(req);
}

export async function POST(req: NextRequest) {
  if (!authenticate(req.headers)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const staleThreshold = new Date(now.getTime() - STALE_CLAIM_MS);
  const claimGuard = { OR: [{ claimedAt: null }, { claimedAt: { lt: staleThreshold } }] };

  const due = await prisma.waEnrollment.findMany({
    where: { status: "active", nextRunAt: { lte: now }, ...claimGuard },
    orderBy: { nextRunAt: "asc" },
    take: BATCH_SIZE,
    select: { id: true },
  });
  if (due.length === 0) {
    return NextResponse.json({ ok: true, claimed: 0, processed: 0, results: {} });
  }

  const claimToken = randomUUID();
  const claimed = await prisma.waEnrollment.updateMany({
    // Re-stating status + claim guard here (not just `id: { in: due } }`) is
    // what makes this safe against a second, overlapping tick that read the
    // same due list a moment earlier — only one of the two updateMany calls
    // can match a given row's still-open claim window.
    where: { id: { in: due.map((d) => d.id) }, status: "active", ...claimGuard },
    data: { claimedAt: now, claimToken },
  });

  const rows = await prisma.waEnrollment.findMany({
    where: { claimToken },
    include: {
      currentStep: true,
      sequence: { include: { steps: { orderBy: { stepOrder: "asc" } } } },
    },
  });

  const results = { sent: 0, deferred: 0, stopped: 0, refused: 0, failed: 0, completed: 0 };

  for (const enrollment of rows) {
    const release = (data: Record<string, unknown>) =>
      prisma.waEnrollment
        .update({ where: { id: enrollment.id }, data: { ...data, claimedAt: null, claimToken: null } })
        .catch((e) => console.error(`[whatsapp/tick] failed to release claim for ${enrollment.id}`, e));

    try {
      // Defensive re-check: an admin may have deactivated this sequence
      // since it was enrolled. deleteWaSequence already stops active
      // enrollments when that happens, but this closes the race where a
      // tick already claimed the row a moment before that write landed.
      if (!enrollment.sequence.active) {
        await release({ status: "stopped", stopReason: "manual" });
        results.stopped++;
        continue;
      }

      const step = enrollment.currentStep ?? enrollment.sequence.steps[0] ?? null;
      if (!step) {
        await release({ status: "completed" });
        results.completed++;
        continue;
      }

      const outcome = await sendWaMessage({
        leadId: enrollment.leadId,
        templateId: step.templateId,
        enrollmentId: enrollment.id,
      });

      switch (outcome.kind) {
        case "sent": {
          results.sent++;
          const steps = enrollment.sequence.steps;
          const next = steps[steps.findIndex((s) => s.id === step.id) + 1];
          if (next) {
            await release({
              currentStepId: next.id,
              nextRunAt: new Date(Date.now() + next.delayMinutes * 60_000),
            });
          } else {
            await release({ status: "completed", currentStepId: step.id });
          }
          break;
        }
        case "deferred":
          results.deferred++;
          await release({ currentStepId: step.id, nextRunAt: outcome.retryAt });
          break;
        case "stopped":
          // sendWaMessage already flipped status/stopReason on the
          // enrollment — this call just releases the claim.
          results.stopped++;
          await release({});
          break;
        case "refused":
          results.refused++;
          await release({ currentStepId: step.id, nextRunAt: new Date(Date.now() + REFUSED_BACKOFF_MS) });
          break;
        case "failed":
          results.failed++;
          await release({ currentStepId: step.id, nextRunAt: new Date(Date.now() + FAILED_BACKOFF_MS) });
          break;
      }
    } catch (e) {
      // Back the row off like a failed send rather than just releasing the
      // claim. Releasing alone left nextRunAt in the past, so a row that
      // throws every time stayed permanently due and was re-claimed by every
      // subsequent tick — and because the batch is ordered by nextRunAt and
      // capped at BATCH_SIZE, enough such rows would fill each batch and
      // starve every healthy enrollment behind them indefinitely.
      console.error(`[whatsapp/tick] enrollment ${enrollment.id} failed`, e);
      results.failed++;
      await release({ nextRunAt: new Date(Date.now() + FAILED_BACKOFF_MS) });
    }
  }

  return NextResponse.json({ ok: true, claimed: claimed.count, processed: rows.length, results });
}
