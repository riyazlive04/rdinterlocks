import { Prisma } from "@prisma/client";
import { prisma } from "./db";

// Normalisation + upsert for inbound Transcriber leads.
//
// Design rule that drives everything here: a transcript is lossy. The caller
// may not know the customer's name, may say "about two lakh" instead of a
// number, and may send a field we haven't modelled yet. Rejecting the request
// would throw away the parts it DID get right, so instead we coerce what we
// can, record what we couldn't, and only ever hard-fail on things that make
// the record meaningless — a body that isn't an object, or a missing
// contactKey (without it there is no way to group repeat calls from the same
// caller into one lead, and every call would fragment into its own).

export type LeadFieldKey =
  | "callId"
  | "contactKey"
  | "customerName"
  | "phoneNumber"
  | "phoneMasked"
  | "place"
  | "brickType"
  | "brickCount"
  | "constructionType"
  | "costPerBrick"
  | "totalBudget"
  | "notes"
  | "followUpDate"
  | "quotationStage";

// Accepted input names per canonical field. Comparison is done on a squashed
// form (lowercased, non-alphanumerics removed), so `customer_name`,
// `customerName`, `Customer Name` and `CUSTOMERNAME` all match "customername"
// without needing separate entries. Order matters — first match wins.
const FIELD_ALIASES: Record<LeadFieldKey, string[]> = {
  callId: ["callid", "calluuid", "recordingid", "conversationid", "sessionid", "id"],
  // The idempotency + grouping key: one contact, however many calls. Falls
  // back to whichever phone field is present so a Transcriber delivery that
  // forgets contactKey still groups correctly, rather than hard-failing.
  contactKey: ["contactkey", "contactid", "customerkey", "customerid", "phonekey"],
  // "contactname" is checked first — it's the current field name. "customername"
  // and the rest are accepted for older callers and older Transcriber payloads.
  customerName: ["contactname", "customername", "clientname", "callername", "customer", "name"],
  phoneNumber: [
    "phonenumber",
    "phone",
    "mobilenumber",
    "mobile",
    "contactnumber",
    "customerphone",
    "callerphone",
    "callernumber",
  ],
  phoneMasked: ["phonemasked", "maskedphone", "phonemask", "maskednumber", "maskedmobile"],
  place: ["place", "location", "city", "town", "area", "sitename", "site", "address"],
  brickType: ["typeofbricks", "bricktype", "bricksize", "brickspec", "product", "size"],
  brickCount: [
    "numberofbricks",
    "noofbricks",
    "brickcount",
    "brickqty",
    "bricks",
    "quantity",
    "qty",
  ],
  constructionType: [
    "typeofconstruction",
    "constructiontype",
    "construction",
    "worktype",
    "purpose",
  ],
  costPerBrick: ["costperbrick", "priceperbrick", "rateperbrick", "unitprice", "rate"],
  totalBudget: [
    "totalbudget",
    "estimatedbudget",
    "budget",
    "totalcost",
    "totalamount",
    "ordervalue",
  ],
  notes: ["notes", "note", "remarks", "summary", "comments", "description"],
  followUpDate: [
    "followupdate",
    "nextfollowup",
    "followup",
    "callbackdate",
    "reminderdate",
    "nextcalldate",
  ],
  quotationStage: [
    "quotationstage",
    "quotationstatus",
    "quotationphase",
    "salesstage",
    "quotation",
    "stage",
    "status",
  ],
};

// Envelope keys we unwrap rather than treat as data, so both of these work:
//   { "callId": "c-1", "place": "Salem" }
//   { "callId": "c-1", "data": { "place": "Salem" } }
const ENVELOPE_KEYS = ["data", "fields", "lead", "extracted", "extractedfields", "result"];

function squash(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// ─── Coercion helpers ─────────────────────────────────────────────────

// Placeholder strings that mean "the extractor had nothing", not a real value.
// Observed in live Transcriber traffic: a JS null reaches us as the STRING
// "null" for string-typed fields, which would otherwise be stored verbatim and
// render as a customer literally named "null".
const NULLISH_TEXT = new Set([
  "null",
  "undefined",
  "nan",
  "none",
  "n/a",
  "na",
  "-",
  "--",
  "unknown",
  "not mentioned",
  "not specified",
  "not available",
]);

function isNullishText(s: string): boolean {
  return NULLISH_TEXT.has(s.trim().toLowerCase());
}

function coerceText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") {
    const t = v.trim();
    return isNullishText(t) ? "" : t;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

// Money and counts arrive as anything from 12000 to "₹1,20,000" to "2 lakh".
// Indian shorthand is common in a spoken quote, so it's worth understanding.
export function coerceNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;

  const s = v.trim().toLowerCase().replace(/[₹,\s_]/g, "");
  if (!s) return null;

  let multiplier = 1;
  if (/(crores|crore|cr)$/.test(s)) multiplier = 1e7;
  else if (/(lakhs|lakh|lacs|lac|l)$/.test(s)) multiplier = 1e5;
  else if (/(thousand|k)$/.test(s)) multiplier = 1e3;

  const n = parseFloat(s.replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(n)) return null;
  return n * multiplier;
}

// Accepts ISO, epoch millis, and the dd/mm/yyyy the office actually writes.
// Ambiguous d/m vs m/d is resolved as DAY FIRST (Indian convention).
export function coerceDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "number" && Number.isFinite(v)) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    // Bare date: pin to local midnight, not the UTC midnight `new Date()` would
    // give, so a follow-up doesn't drift to the previous day in IST.
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  const dmy = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(s);
  if (dmy) {
    const [, a, b, y] = dmy;
    return new Date(Number(y), Number(b) - 1, Number(a));
  }
  const ymd = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/.exec(s);
  if (ymd) {
    const [, y, m, d] = ymd;
    return new Date(Number(y), Number(m) - 1, Number(d));
  }
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export const QUOTATION_STAGES = ["new", "quoted", "negotiating", "won", "lost"] as const;

const STAGE_SYNONYMS: Record<string, string> = {
  "": "new",
  new: "new",
  fresh: "new",
  enquiry: "new",
  inquiry: "new",
  lead: "new",
  initial: "new",
  pending: "new",
  notquoted: "new",
  quoted: "quoted",
  quotesent: "quoted",
  quotationsent: "quoted",
  quotation: "quoted",
  estimatesent: "quoted",
  priced: "quoted",
  negotiating: "negotiating",
  negotiation: "negotiating",
  followup: "negotiating",
  indiscussion: "negotiating",
  discussing: "negotiating",
  won: "won",
  converted: "won",
  confirmed: "won",
  closedwon: "won",
  orderplaced: "won",
  accepted: "won",
  lost: "lost",
  rejected: "lost",
  declined: "lost",
  closedlost: "lost",
  notinterested: "lost",
  dropped: "lost",
  cancelled: "lost",
};

// Known synonyms map onto the five canonical stages. Anything unrecognised is
// passed through in a tidied form rather than discarded or forced to "new", so
// the Transcriber can add a stage without waiting on a deploy here.
export function normalizeStage(v: unknown): string {
  const raw = coerceText(v);
  if (!raw) return "new";
  return STAGE_SYNONYMS[squash(raw)] ?? raw.toLowerCase().replace(/\s+/g, " ").trim();
}

// ─── Payload normalisation ────────────────────────────────────────────

export type NormalizedLead = {
  callId: string;
  contactKey: string;
  customerName: string;
  phoneNumber: string;
  phoneMasked: string;
  place: string;
  brickType: string;
  brickCount: number | null;
  constructionType: string;
  costPerBrick: number | null;
  totalBudget: number | null;
  notes: string;
  followUpDate: Date | null;
  quotationStage: string;
};

export type NormalizeResult = {
  values: NormalizedLead;
  /** Canonical fields the payload did not supply — stored empty, not rejected. */
  missingFields: LeadFieldKey[];
  /** Values that arrived but could not be coerced; the raw text is kept in `extra`. */
  warnings: string[];
  /** Unmodelled keys, preserved verbatim for forward compatibility. */
  extra: Record<string, unknown>;
};

function flattenEnvelope(body: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (ENVELOPE_KEYS.includes(squash(k)) && v && typeof v === "object" && !Array.isArray(v)) {
      Object.assign(merged, v as Record<string, unknown>);
    }
  }
  // Top level wins over a nested envelope on conflict.
  return { ...merged, ...body };
}

export function normalizeLeadPayload(body: Record<string, unknown>): NormalizeResult {
  const flat = flattenEnvelope(body);

  // Index the payload by squashed key so lookup is spelling-insensitive.
  const byKey = new Map<string, { originalKey: string; value: unknown }>();
  for (const [k, v] of Object.entries(flat)) {
    if (ENVELOPE_KEYS.includes(squash(k))) continue;
    if (!byKey.has(squash(k))) byKey.set(squash(k), { originalKey: k, value: v });
  }

  const consumed = new Set<string>();
  const pick = (field: LeadFieldKey): unknown => {
    for (const alias of FIELD_ALIASES[field]) {
      const hit = byKey.get(alias);
      if (hit === undefined) continue;
      if (hit.value === null || hit.value === undefined || hit.value === "") continue;
      // A placeholder like the string "null" is absence, not a value. Skipping
      // it here (rather than only in coerceText) means numbers and dates treat
      // it as missing too, so it lands in missingFields instead of raising a
      // spurious "not a recognisable date" warning.
      if (typeof hit.value === "string" && isNullishText(hit.value)) {
        consumed.add(alias);
        continue;
      }
      consumed.add(alias);
      return hit.value;
    }
    return undefined;
  };

  const warnings: string[] = [];
  const extra: Record<string, unknown> = {};

  const rawFollowUp = pick("followUpDate");
  const followUpDate = coerceDate(rawFollowUp);
  if (rawFollowUp !== undefined && followUpDate === null) {
    warnings.push(
      `followUpDate "${coerceText(rawFollowUp)}" is not a recognisable date; kept as extra.followUpDateRaw`
    );
    extra.followUpDateRaw = rawFollowUp;
  }

  const numberField = (field: LeadFieldKey): number | null => {
    const raw = pick(field);
    if (raw === undefined) return null;
    const n = coerceNumber(raw);
    if (n === null) {
      warnings.push(`${field} "${coerceText(raw)}" is not a number; kept as extra.${field}Raw`);
      extra[`${field}Raw`] = raw;
      return null;
    }
    if (n < 0) {
      warnings.push(`${field} was negative (${n}); ignored`);
      extra[`${field}Raw`] = raw;
      return null;
    }
    return n;
  };

  const brickCountRaw = numberField("brickCount");
  const phoneNumber = coerceText(pick("phoneNumber"));
  const phoneMasked = coerceText(pick("phoneMasked"));
  // No explicit contactKey? Fall back to whichever phone we have — it's the
  // same "one contact" identity the key is meant to capture.
  const contactKey = coerceText(pick("contactKey")) || phoneNumber || phoneMasked;
  const values: NormalizedLead = {
    callId: coerceText(pick("callId")),
    contactKey,
    customerName: coerceText(pick("customerName")),
    phoneNumber,
    phoneMasked,
    place: coerceText(pick("place")),
    brickType: coerceText(pick("brickType")),
    brickCount: brickCountRaw === null ? null : Math.round(brickCountRaw),
    constructionType: coerceText(pick("constructionType")),
    costPerBrick: numberField("costPerBrick"),
    totalBudget: numberField("totalBudget"),
    notes: coerceText(pick("notes")),
    followUpDate,
    quotationStage: normalizeStage(pick("quotationStage")),
  };

  // Anything left over is a field this version doesn't model. Keep it.
  for (const [squashed, { originalKey, value }] of byKey) {
    if (consumed.has(squashed)) continue;
    if (value === null || value === undefined || value === "") continue;
    extra[originalKey] = value;
  }

  const missingFields: LeadFieldKey[] = [];
  // callId is no longer the idempotency key (contactKey is), so its absence is
  // now just an advisory gap rather than a hard failure.
  if (!values.callId) missingFields.push("callId");
  if (!values.customerName) missingFields.push("customerName");
  if (!values.phoneNumber && !values.phoneMasked) missingFields.push("phoneNumber");
  if (!values.place) missingFields.push("place");
  if (!values.brickType) missingFields.push("brickType");
  if (values.brickCount === null) missingFields.push("brickCount");
  if (!values.constructionType) missingFields.push("constructionType");
  if (values.costPerBrick === null) missingFields.push("costPerBrick");
  if (values.totalBudget === null) missingFields.push("totalBudget");
  if (!values.notes) missingFields.push("notes");
  if (values.followUpDate === null) missingFields.push("followUpDate");

  return { values, missingFields, warnings, extra };
}

// ─── Master-data resolution ───────────────────────────────────────────

// Spoken text won't be an id, so match it against the admin's master lists on a
// best-effort basis. A miss is fine — the free text is kept either way and the
// office can pick the right size when converting the lead.
function looseMatch(spoken: string, candidate: string): boolean {
  const a = spoken.toLowerCase().replace(/inches|inch|["'”“]/g, "").replace(/[^a-z0-9]/g, "");
  const b = candidate.toLowerCase().replace(/inches|inch|["'”“]/g, "").replace(/[^a-z0-9]/g, "");
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

async function resolveMasterData(brickType: string, constructionType: string) {
  const [sizes, types] = await Promise.all([
    brickType ? prisma.brickSize.findMany({ select: { id: true, label: true } }) : [],
    constructionType ? prisma.constructionType.findMany({ select: { id: true, name: true } }) : [],
  ]);

  // Prefer the longest matching label so "6H" beats "6" for `6"H`.
  const size = sizes
    .filter((s) => looseMatch(brickType, s.label))
    .sort((a, b) => b.label.length - a.label.length)[0];
  const type = types
    .filter((t) => looseMatch(constructionType, t.name))
    .sort((a, b) => b.name.length - a.name.length)[0];

  return { brickSizeId: size?.id ?? null, constructionTypeId: type?.id ?? null };
}

// ─── Upsert ───────────────────────────────────────────────────────────

export type ImportOutcome = "created" | "updated" | "conflict";

// The full persisted row is returned, not the incoming values, so the caller
// can be shown exactly what the record now holds. That distinction matters on
// a merge: a thin re-import legitimately leaves earlier fields in place, and
// echoing the request back would make it look like they had been wiped.
export type PersistedLead = {
  id: string;
  contactKey: string;
  callId: string;
  customerName: string;
  phoneNumber: string;
  phoneMasked: string;
  place: string;
  brickType: string;
  brickCount: number | null;
  constructionType: string;
  costPerBrick: number | null;
  totalBudget: number | null;
  notes: string;
  followUpDate: Date | null;
  quotationStage: string;
  callSequence: number;
  isFollowUp: boolean;
  status: string;
};

export type ImportResult =
  | { outcome: "created" | "updated"; lead: PersistedLead }
  | { outcome: "conflict"; message: string; lead: PersistedLead };

/**
 * Idempotent create-or-update keyed on contactKey — one contact, however many
 * calls, is one lead.
 *
 * Merge rule on re-import: a field is overwritten only when the new payload
 * carries a non-empty value for it. A later, thinner extraction therefore
 * cannot blank out details an earlier one got right. Pass mode="replace" to
 * overwrite unconditionally.
 */
export async function importLead(
  values: NormalizedLead,
  extra: Record<string, unknown>,
  mode: "merge" | "replace" = "merge"
): Promise<ImportResult> {
  const refs = await resolveMasterData(values.brickType, values.constructionType);
  const hasExtra = Object.keys(extra).length > 0;

  const select = {
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
  } as const;

  const existing = await prisma.lead.findUnique({ where: { contactKey: values.contactKey } });

  // Was this exact call already recorded against any lead? A retried
  // extraction re-sends the same callId and must not bump callSequence again —
  // only a callId we haven't seen succeed before counts as another touchpoint.
  // Absent a callId there's no way to prove a duplicate, so it's treated as
  // NOT new (safer to under-count than to inflate the call count).
  const priorCallSeen =
    !!values.callId &&
    (await prisma.leadImport.count({
      where: { callId: values.callId, outcome: { in: ["created", "updated"] } },
    })) > 0;

  if (existing) {
    // A converted lead has already become a client/order downstream. Silently
    // rewriting it would desync the two, so refuse and let the caller decide.
    if (existing.convertedAt) {
      return {
        outcome: "conflict",
        message: `Lead for contactKey "${values.contactKey}" was already converted on ${existing.convertedAt.toISOString()} and can no longer be updated by import.`,
        lead: await prisma.lead.findUniqueOrThrow({ where: { id: existing.id }, select }),
      };
    }

    const replace = mode === "replace";
    const text = (next: string, prev: string) => (replace || next ? next : prev);
    const num = (next: number | null, prev: number | null) =>
      replace || next !== null ? next : prev;

    const isNewCall = !!values.callId && !priorCallSeen;

    const mergedExtra = replace
      ? extra
      : { ...((existing.extra as Record<string, unknown> | null) ?? {}), ...extra };

    const updated = await prisma.lead.update({
      where: { id: existing.id },
      data: {
        callId: text(values.callId, existing.callId),
        customerName: text(values.customerName, existing.customerName),
        phoneNumber: text(values.phoneNumber, existing.phoneNumber),
        phoneMasked: text(values.phoneMasked, existing.phoneMasked),
        place: text(values.place, existing.place),
        brickType: text(values.brickType, existing.brickType),
        brickCount: num(values.brickCount, existing.brickCount),
        constructionType: text(values.constructionType, existing.constructionType),
        costPerBrick: num(values.costPerBrick, existing.costPerBrick),
        totalBudget: num(values.totalBudget, existing.totalBudget),
        notes: text(values.notes, existing.notes),
        followUpDate: replace || values.followUpDate ? values.followUpDate : existing.followUpDate,
        // "new" is the default, not an assertion — don't let it undo a real stage.
        quotationStage:
          replace || values.quotationStage !== "new"
            ? values.quotationStage
            : existing.quotationStage,
        callSequence: isNewCall ? existing.callSequence + 1 : existing.callSequence,
        isFollowUp: isNewCall ? true : existing.isFollowUp,
        brickSizeId: refs.brickSizeId ?? (replace ? null : existing.brickSizeId),
        constructionTypeId: refs.constructionTypeId ?? (replace ? null : existing.constructionTypeId),
        ...(hasExtra || replace ? { extra: mergedExtra as Prisma.InputJsonValue } : {}),
      },
      select,
    });
    return { outcome: "updated", lead: updated };
  }

  try {
    const created = await prisma.lead.create({
      data: {
        contactKey: values.contactKey,
        callId: values.callId,
        customerName: values.customerName,
        phoneNumber: values.phoneNumber,
        phoneMasked: values.phoneMasked,
        place: values.place,
        brickType: values.brickType,
        brickCount: values.brickCount,
        constructionType: values.constructionType,
        costPerBrick: values.costPerBrick,
        totalBudget: values.totalBudget,
        notes: values.notes,
        followUpDate: values.followUpDate,
        quotationStage: values.quotationStage,
        callSequence: 1,
        isFollowUp: false,
        brickSizeId: refs.brickSizeId,
        constructionTypeId: refs.constructionTypeId,
        ...(hasExtra ? { extra: extra as Prisma.InputJsonValue } : {}),
      },
      select,
    });
    return { outcome: "created", lead: created };
  } catch (e) {
    // Two identical contactKeys racing: the unique index is the arbiter, and
    // the loser retries as an update so the request is still idempotent.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return importLead(values, extra, mode);
    }
    throw e;
  }
}

// Append-only audit row. Never allowed to fail the request it is recording.
export async function recordImport(row: {
  callId: string | null;
  leadId: string | null;
  payload: unknown;
  outcome: string;
  statusCode: number;
  message: string;
  apiKeyLabel: string;
  requestId: string;
}) {
  try {
    await prisma.leadImport.create({
      data: {
        callId: row.callId,
        leadId: row.leadId,
        payload: (row.payload ?? {}) as Prisma.InputJsonValue,
        outcome: row.outcome,
        statusCode: row.statusCode,
        message: row.message.slice(0, 1000),
        apiKeyLabel: row.apiKeyLabel,
        requestId: row.requestId,
      },
    });
  } catch (e) {
    console.error("[leads/import] failed to write audit row", row.requestId, e);
  }
}
