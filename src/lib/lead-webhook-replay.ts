import { randomUUID } from "crypto";
import { prisma } from "./db";
import { importLead, normalizeLeadPayload, recordImport, type SourceMeta } from "./leads-import";
import {
  applyFieldMap,
  configuredChannels,
  extractTracking,
  type LeadWebhookChannel,
} from "./lead-webhook";

// Operator-triggered replay of a stored inbound webhook delivery.
//
// Why this exists: api/v1/leads/webhook/[channel] persists every delivery to
// LeadWebhookDelivery BEFORE it interprets it, so a delivery WE could not
// complete — a DB blip, master data that wasn't configured yet, an importer
// error — still has its verbatim body on disk. The contract tells providers
// to retry only on 429/5xx and most relays never retry at all, so without a
// replay path that enquiry is simply lost. This re-runs the delivery through
// the SAME import the live route runs, from the stored bytes.
//
// WHY THE SIGNATURE IS NOT RE-VERIFIED HERE
//
// Authenticity was settled on arrival: verifyDelivery ran against the exact
// bytes as they were received, and a delivery that failed it is stored with
// status "rejected" and never reached the importer at all. Re-checking the
// stored body now would fail for two reasons that have nothing to do with
// whether the provider really sent it:
//
//   1. The timestamp-bound schemes (hmac-sha256-hex, -base64) enforce a
//      replay window of toleranceSeconds. By definition a replay is outside
//      it — that window is exactly what stops an attacker re-posting a
//      captured request, and it would now reject the operator too.
//   2. The channel secret may have been rotated since the delivery arrived,
//      so the stored digest no longer recomputes even for a genuine body.
//
// A replay is therefore an authenticated OPERATOR action, gated by the
// leadIntake area, not a re-authenticated provider request. The one thing it
// must not do is create a second lead, which is what callId below is for.

// Same ceiling as the live route, so a stored batch replays under the rules
// it arrived under.
const MAX_BATCH = 100;

export type ReplayResult = { ok: boolean; outcome: string; message: string };

/** The provider's own id for the submission. Same key list, in the same
 *  order, as the live route's externalIdOf. */
function externalIdOf(payload: Record<string, unknown>): string | null {
  for (const key of ["leadId", "lead_id", "leadgenId", "leadgen_id", "id"]) {
    const v = payload[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

type OneResult = {
  externalId: string | null;
  outcome: "created" | "updated" | "conflict" | "rejected" | "error";
  statusCode: number;
  leadRef: string | null;
  message: string;
};

/**
 * Import one submission. Never throws — a bad entry in a batch must not stop
 * the rest, and the row update needs a per-lead outcome either way.
 */
async function importOne(
  channel: LeadWebhookChannel,
  payload: Record<string, unknown>,
  deliveryId: string,
  requestId: string,
  apiKeyLabel: string
): Promise<OneResult> {
  const externalId = externalIdOf(payload);
  const mapped = applyFieldMap(payload, channel.fieldMap);
  const { values, extra } = normalizeLeadPayload(mapped);

  // This single line is what makes a replay idempotent rather than a way to
  // duplicate a lead. The provider's submission id becomes the callId, so a
  // delivery that half-succeeded first time (lead written, row update lost)
  // merges back into the same Lead on contactKey and does not bump
  // callSequence again — importLead treats a callId it has already recorded
  // as a seen touchpoint, not a new one. Replaying a delivery that carried no
  // submission id can therefore not be deduplicated on callId; it still
  // merges on contactKey, which is the phone number.
  if (externalId) values.callId = externalId;

  if (!values.contactKey) {
    return {
      externalId,
      outcome: "rejected",
      statusCode: 400,
      leadRef: null,
      message: "No phone number — the submission cannot be grouped or acted on.",
    };
  }

  const sourceMeta: SourceMeta = { source: channel.source, ...extractTracking(payload) };

  try {
    const result = await importLead(values, extra, "merge", sourceMeta);
    const statusCode = result.outcome === "created" ? 201 : result.outcome === "conflict" ? 409 : 200;

    await recordImport({
      callId: values.callId || externalId,
      leadId: result.lead.id,
      payload: { delivery: deliveryId, replay: true, payload },
      outcome: result.outcome,
      statusCode,
      message: result.outcome === "conflict" ? result.message : "",
      apiKeyLabel,
      requestId,
      channel: channel.channel,
    });

    return {
      externalId,
      outcome: result.outcome,
      statusCode,
      leadRef: result.lead.id,
      message: result.outcome === "conflict" ? result.message : "",
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[leads/replay/${channel.channel}] ${requestId} import failed`, e);
    await recordImport({
      callId: values.callId || externalId,
      leadId: null,
      payload: { delivery: deliveryId, replay: true, payload },
      outcome: "error",
      statusCode: 500,
      message,
      apiKeyLabel,
      requestId,
      channel: channel.channel,
    });
    return { externalId, outcome: "error", statusCode: 500, leadRef: null, message };
  }
}

/** Marks the attempt on the delivery row. Every exit from replayDelivery goes
 *  through here, so `attempts` and `replayedAt` tell the truth even about a
 *  replay that got nowhere — a row stuck at "failed" with five attempts is
 *  the signal that the problem is not transient. */
async function markAttempt(
  id: string,
  data: {
    status: string;
    outcome: string;
    statusCode: number;
    message: string;
    externalId?: string | null;
    leadId?: string | null;
  }
) {
  try {
    await prisma.leadWebhookDelivery.update({
      where: { id },
      data: {
        ...data,
        message: data.message.slice(0, 2000),
        attempts: { increment: 1 },
        lastAttempt: new Date(),
        replayedAt: new Date(),
      },
    });
  } catch (e) {
    // The import may well have succeeded; losing the bookkeeping must not
    // turn that into a thrown error the operator reads as a failed replay.
    console.error("[leads/replay] failed to update delivery row", id, e);
  }
}

/**
 * Replays one stored delivery. Never throws: every failure, including a
 * missing row or a channel that has since been removed from
 * LEAD_WEBHOOK_CHANNELS, comes back in the result for the screen to show.
 */
export async function replayDelivery(
  deliveryId: string,
  actorLabel: string
): Promise<ReplayResult> {
  const apiKeyLabel = `replay:${actorLabel}`;
  const requestId = randomUUID();

  try {
    const delivery = await prisma.leadWebhookDelivery.findUnique({
      where: { id: deliveryId },
      select: { id: true, channel: true, body: true, statusCode: true, status: true },
    });
    if (!delivery) {
      return { ok: false, outcome: "error", message: "That delivery no longer exists." };
    }

    // NEVER replay a delivery that failed authentication.
    //
    // The route stores the raw body BEFORE it verifies the signature, so an
    // unsigned or wrongly-signed request is still persisted — deliberately,
    // because that row is the only place a provider's broken signing is
    // visible. The consequence is that anyone on the internet who guesses a
    // channel slug can park an arbitrary lead payload in this table, where
    // it appears beside genuine traffic. Replaying it would import that
    // forgery as a real provider submission, attributed to whichever
    // operator clicked the button, and from there it is auto-assigned,
    // possibly auto-quoted, and its phone number becomes a valid target for
    // the factory's WhatsApp sender.
    //
    // Replay exists for deliveries WE could not complete (a Graph outage, a
    // bad field map, a bug in the importer) — those were authenticated on
    // arrival. Authentication is the one thing a replay cannot re-establish,
    // since the timestamp window has passed and the secret may have rotated,
    // so a row that never passed it is refused outright rather than trusted.
    if (delivery.statusCode === 401 || delivery.statusCode === 408) {
      return {
        ok: false,
        outcome: "error",
        message:
          "This delivery was refused because its signature did not verify, so it cannot be replayed — " +
          "nothing proves who sent it. Ask the provider to re-send it correctly signed.",
      };
    }

    // Read the channel list fresh rather than trusting the name on the row:
    // the config is an env var, and a channel the operator removed must not
    // keep importing just because old deliveries name it.
    const { channels, errors } = configuredChannels();
    const channel = channels.get(delivery.channel);
    if (!channel) {
      // A channel can vanish two ways — deleted from LEAD_WEBHOOK_CHANNELS, or
      // still listed but discarded by parseChannelConfig because its entry is
      // malformed. The second is the one worth naming, because it looks like
      // nothing is wrong until intake quietly stops.
      const configError = errors.find((e) => e.channel === delivery.channel);
      const message = configError
        ? `Channel "${delivery.channel}" is misconfigured and cannot import: ${configError.problem}`
        : `Channel "${delivery.channel}" is no longer in LEAD_WEBHOOK_CHANNELS. Restore its entry before replaying.`;
      await markAttempt(delivery.id, {
        status: "failed",
        outcome: "error",
        statusCode: 503,
        message,
      });
      return { ok: false, outcome: "error", message };
    }

    let body: unknown;
    try {
      body = JSON.parse(delivery.body);
    } catch {
      const message = "Stored body is not valid JSON; there is nothing to import.";
      await markAttempt(delivery.id, {
        status: "rejected",
        outcome: "error",
        statusCode: 400,
        message,
      });
      return { ok: false, outcome: "error", message };
    }

    if (typeof body !== "object" || body === null) {
      const message = "Stored body is not a JSON object; there is nothing to import.";
      await markAttempt(delivery.id, {
        status: "rejected",
        outcome: "error",
        statusCode: 400,
        message,
      });
      return { ok: false, outcome: "error", message };
    }

    const envelope = body as Record<string, unknown>;
    const batch = Array.isArray(envelope.leads) ? (envelope.leads as unknown[]) : null;

    if (batch && batch.length > MAX_BATCH) {
      const message = `Batch of ${batch.length} exceeds ${MAX_BATCH}; it was rejected on arrival and cannot be replayed.`;
      await markAttempt(delivery.id, {
        status: "rejected",
        outcome: "error",
        statusCode: 400,
        message,
      });
      return { ok: false, outcome: "error", message };
    }

    // ─── Single submission ───────────────────────────────────────────
    if (!batch) {
      const result = await importOne(channel, envelope, delivery.id, requestId, apiKeyLabel);
      const status =
        result.outcome === "created" || result.outcome === "updated"
          ? "imported"
          : result.outcome === "conflict"
            ? "duplicate"
            : result.outcome === "rejected"
              ? "rejected"
              : "failed";

      await markAttempt(delivery.id, {
        status,
        outcome: result.outcome,
        statusCode: result.statusCode,
        message: result.message,
        externalId: result.externalId,
        leadId: result.leadRef,
      });

      const ok = status === "imported";
      return {
        ok,
        outcome: result.outcome,
        message:
          result.message ||
          (ok
            ? `Lead ${result.outcome} from the stored delivery.`
            : "The delivery could not be imported."),
      };
    }

    // ─── Batch ───────────────────────────────────────────────────────
    const results: OneResult[] = [];
    for (const entry of batch) {
      if (typeof entry !== "object" || entry === null) {
        results.push({
          externalId: null,
          outcome: "rejected",
          statusCode: 400,
          leadRef: null,
          message: "Entry is not a JSON object.",
        });
        continue;
      }
      results.push(
        await importOne(channel, entry as Record<string, unknown>, delivery.id, requestId, apiKeyLabel)
      );
    }

    const accepted = results.filter((r) => r.outcome === "created" || r.outcome === "updated").length;
    const anyFailed = results.some((r) => r.outcome === "rejected" || r.outcome === "error");
    const outcome = `batch:${accepted}/${results.length}`;
    const detail = results
      .filter((r) => r.message)
      .map((r) => `${r.externalId ?? "?"}: ${r.message}`)
      .join("; ");

    await markAttempt(delivery.id, {
      status: anyFailed ? (accepted > 0 ? "failed" : "rejected") : "imported",
      outcome,
      statusCode: anyFailed ? 207 : 200,
      message: anyFailed ? detail : "",
    });

    return {
      ok: !anyFailed,
      outcome,
      message: anyFailed
        ? detail || `${accepted} of ${results.length} leads imported.`
        : `${accepted} of ${results.length} leads imported.`,
    };
  } catch (e) {
    // Anything the per-entry handling did not already catch — a lost DB
    // connection on the initial read, for instance. The caller is a button,
    // not a retrying client, so it gets a message rather than an exception.
    const message = e instanceof Error ? e.message : String(e);
    console.error("[leads/replay] replay failed", deliveryId, e);
    return { ok: false, outcome: "error", message };
  }
}
