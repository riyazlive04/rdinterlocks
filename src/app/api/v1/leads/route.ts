import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import { authenticateApiRequest } from "@/lib/api-auth";
import {
  LEAD_IMPORT_LIMITS,
  MINUTE_MS,
  clientIp,
  rateLimit,
  rateLimitHeaders,
} from "@/lib/rate-limit";

// GET /api/v1/leads
//
// Read back what the import endpoint stored. The sender needs this to confirm a
// lead landed after an ambiguous timeout, and to reconcile its outgoing queue
// against the CRM without a human opening the app.
//
// Deliberately NOT /api/v1/leads/:id — the static segment /import already owns
// a child path, and a dynamic sibling would make a lead whose callId happens to
// be "import" unreachable. Lookup is by query instead:
//
//   ?contactKey=+91...  exact match — the lead for this contact, all calls
//   ?callId=CALL_001    exact match on the most recent call attributed to a lead
//   ?stage=quoted        filter by quotation stage
//   ?status=open         open | converted | discarded (default: all)
//   ?due=1               follow-up due today or earlier
//   ?limit=50&offset=0   paging, limit capped at 200
//
//   200 ok | 401 unauthorized | 429 rate_limited | 500 error

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_VERSION = "v1";
const MAX_LIMIT = 200;

export async function GET(req: NextRequest) {
  const requestId = req.headers.get("x-request-id")?.trim() || randomUUID();
  const ip = clientIp(req.headers);

  const ipLimit = rateLimit(`leads-read:ip:${ip}`, LEAD_IMPORT_LIMITS.perIpPerMinute(), MINUTE_MS);
  if (!ipLimit.ok) {
    return NextResponse.json(
      {
        ok: false,
        apiVersion: API_VERSION,
        requestId,
        error: {
          code: "rate_limited",
          message: `Rate limit exceeded (per IP). Retry after ${ipLimit.retryAfterSec}s.`,
          retryAfterSeconds: ipLimit.retryAfterSec,
        },
      },
      { status: 429, headers: { "X-Request-Id": requestId, ...rateLimitHeaders(ipLimit) } }
    );
  }

  const auth = authenticateApiRequest(req.headers);
  if (!auth.ok) {
    const status = auth.code === "not_configured" ? 500 : 401;
    return NextResponse.json(
      {
        ok: false,
        apiVersion: API_VERSION,
        requestId,
        error: {
          code: auth.code === "not_configured" ? "server_not_configured" : "unauthorized",
          message: auth.message,
        },
      },
      { status, headers: { "X-Request-Id": requestId } }
    );
  }

  const keyLimit = rateLimit(
    `leads-read:key:${auth.identity.label}`,
    LEAD_IMPORT_LIMITS.perKeyPerMinute(),
    MINUTE_MS
  );
  if (!keyLimit.ok) {
    return NextResponse.json(
      {
        ok: false,
        apiVersion: API_VERSION,
        requestId,
        error: {
          code: "rate_limited",
          message: `Rate limit exceeded (per API key). Retry after ${keyLimit.retryAfterSec}s.`,
          retryAfterSeconds: keyLimit.retryAfterSec,
        },
      },
      { status: 429, headers: { "X-Request-Id": requestId, ...rateLimitHeaders(keyLimit) } }
    );
  }

  try {
    const sp = req.nextUrl.searchParams;
    const contactKey = sp.get("contactKey")?.trim();
    const callId = sp.get("callId")?.trim();
    const stage = sp.get("stage")?.trim();
    const status = sp.get("status")?.trim();
    const due = sp.get("due") === "1";

    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(sp.get("limit")) || 50));
    const offset = Math.max(0, Number(sp.get("offset")) || 0);

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const where = {
      ...(contactKey ? { contactKey } : {}),
      ...(callId ? { callId } : {}),
      ...(stage ? { quotationStage: stage } : {}),
      ...(status ? { status } : {}),
      ...(due ? { followUpDate: { lte: endOfToday }, status: "open" } : {}),
    };

    const [total, leads] = await Promise.all([
      prisma.lead.count({ where }),
      prisma.lead.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: limit,
        select: {
          id: true,
          contactKey: true,
          callId: true,
          customerName: true,
          phoneNumber: true,
          phoneMasked: true,
          place: true,
          brickType: true,
          brickCount: true,
          constructionType: true,
          costPerBrick: true,
          totalBudget: true,
          notes: true,
          followUpDate: true,
          quotationStage: true,
          callSequence: true,
          isFollowUp: true,
          status: true,
          extra: true,
          convertedAt: true,
          convertedClientId: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);

    return NextResponse.json(
      {
        ok: true,
        apiVersion: API_VERSION,
        requestId,
        total,
        limit,
        offset,
        leads: leads.map((l) => ({
          ...l,
          followUpDate: l.followUpDate?.toISOString() ?? null,
          convertedAt: l.convertedAt?.toISOString() ?? null,
          createdAt: l.createdAt.toISOString(),
          updatedAt: l.updatedAt.toISOString(),
        })),
      },
      { status: 200, headers: { "X-Request-Id": requestId, ...rateLimitHeaders(keyLimit) } }
    );
  } catch (e) {
    console.error(`[leads/read] ${requestId} unhandled error`, e);
    return NextResponse.json(
      {
        ok: false,
        apiVersion: API_VERSION,
        requestId,
        error: {
          code: "internal_error",
          message: `Could not read leads. Quote request id ${requestId} when reporting this.`,
        },
      },
      { status: 500, headers: { "X-Request-Id": requestId } }
    );
  }
}
