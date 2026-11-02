import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireArea } from "@/lib/auth";
import { Card, PageHeader, Pill, EmptyState, StatCard } from "@/components/ui";
import { Icon } from "@/components/icons";
import { Pagination } from "@/components/pagination";
import { formatNumber, formatShortDate, relativeTime } from "@/lib/format";
import { configuredChannels } from "@/lib/lead-webhook";
import { replayDeliveryAction } from "./actions";
import { ReplayButton } from "./replay-button";

// The operator's view of inbound lead intake.
//
// Three things are visible nowhere else in the app, and all three are the
// kind of problem that is silent until someone asks why the leads stopped:
//
//   1. Channel configuration. LEAD_WEBHOOK_CHANNELS is parsed per request and
//      a malformed entry is DISCARDED, not defaulted — so a typo'd scheme
//      disables that provider's intake while the endpoint keeps answering
//      401s that look exactly like a bad secret. The errors[] panel below is
//      the only place that is ever said out loud.
//   2. Rejected deliveries. The webhook route deliberately tells the sender
//      nothing specific about a bad signature, so the stored row is the only
//      evidence that a provider is signing wrongly.
//   3. LeadImport, the import audit log, which has had no UI at all.

const PAGE_SIZE = 40;

// pending | imported | duplicate | rejected | failed — see the status comment
// on LeadWebhookDelivery. `rejected` is a delivery we refused and will never
// retry; `failed` is one we could not complete, and is the replayable one.
const DELIVERY_STATUSES = ["pending", "imported", "duplicate", "rejected", "failed"] as const;

const STATUS_TONES: Record<string, "slate" | "success" | "info" | "warning" | "danger" | "red"> = {
  pending: "warning",
  imported: "success",
  duplicate: "info",
  rejected: "danger",
  failed: "red",
};

// Only `failed` is worth re-running: `imported` and `duplicate` already did
// their job, and `pending` means the live request is still in flight.
//
// `rejected` is deliberately NOT here. A delivery is rejected either because
// its signature did not verify — in which case nothing proves who sent it,
// and the body in that row may be a forgery parked there by anyone who
// guessed the channel slug — or because the payload was unusable, which a
// replay of the same bytes cannot fix. replayDelivery() refuses those rows
// server-side regardless of what this list says; this only keeps the UI from
// offering a button that is guaranteed to fail.
const REPLAYABLE = new Set(["failed"]);

export default async function LeadIntakePage({
  searchParams,
}: {
  searchParams: Promise<{
    channel?: string;
    status?: string;
    page?: string;
  }>;
}) {
  await requireArea("leadIntake");
  const sp = await searchParams;
  const channel = sp?.channel ?? "";
  const status = sp?.status ?? "";
  const page = Math.max(1, Number(sp?.page) || 1);

  const where = {
    ...(channel ? { channel } : {}),
    ...(status ? { status } : {}),
  };

  const since24h = new Date(Date.now() - 86400000);
  const { channels, errors, warnings } = configuredChannels();

  const [deliveries, totalFiltered, totalAll, statusCounts, channelCounts, last24h, imports] =
    await Promise.all([
      // Paged in the query rather than sliced in memory like the leads list:
      // this table is append-only and unbounded, so one row per delivery
      // forever is not something to load whole.
      prisma.leadWebhookDelivery.findMany({
        where,
        orderBy: { receivedAt: "desc" },
        take: PAGE_SIZE,
        skip: (page - 1) * PAGE_SIZE,
      }),
      prisma.leadWebhookDelivery.count({ where }),
      prisma.leadWebhookDelivery.count(),
      prisma.leadWebhookDelivery.groupBy({ by: ["status"], _count: true }),
      // Channels that have actually delivered, which is not the same set as
      // the configured ones — a provider removed from the env still has
      // history, and that history still needs filtering.
      prisma.leadWebhookDelivery.groupBy({ by: ["channel"], _count: true }),
      prisma.leadWebhookDelivery.count({ where: { receivedAt: { gte: since24h } } }),
      prisma.leadImport.findMany({ orderBy: { receivedAt: "desc" }, take: 25 }),
    ]);

  const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));
  const countForStatus = (s: string) => statusCounts.find((c) => c.status === s)?._count ?? 0;

  // Configured first, then any channel that only exists in the log.
  const channelNames = [
    ...channels.keys(),
    ...channelCounts.map((c) => c.channel).filter((c) => !channels.has(c)),
  ];

  const qs = (over: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { channel, status, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const s = params.toString();
    return s ? `/leads/intake?${s}` : "/leads/intake";
  };

  return (
    <>
      <PageHeader
        title="Lead intake"
        sub="Inbound webhook deliveries, channel configuration and the import audit log"
        back="/leads"
      />

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
        <StatCard
          label="Last 24h"
          value={formatNumber(last24h)}
          sub="Deliveries received"
          tone="ink"
        />
        <StatCard
          label="Pending"
          value={formatNumber(countForStatus("pending"))}
          sub="Not yet interpreted"
          tone={countForStatus("pending") > 0 ? "blue" : "default"}
        />
        <StatCard label="Imported" value={formatNumber(countForStatus("imported"))} tone="success" />
        <StatCard label="Duplicate" value={formatNumber(countForStatus("duplicate"))} />
        <StatCard
          label="Rejected"
          value={formatNumber(countForStatus("rejected"))}
          sub="We refused it"
          tone={countForStatus("rejected") > 0 ? "red" : "default"}
        />
        <StatCard
          label="Failed"
          value={formatNumber(countForStatus("failed"))}
          sub="Replayable"
          tone={countForStatus("failed") > 0 ? "red" : "default"}
        />
      </div>

      {/* Channel configuration. The errors come first and loudly: a discarded
          entry means that provider's intake is off, with nothing in the
          endpoint's own answers to say so. */}
      <Card className="mb-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-base font-bold text-ink">Configured channels</div>
            <div className="text-[11px] text-slate-500">
              From <span className="mono">LEAD_WEBHOOK_CHANNELS</span> — read per request, so an env
              change needs no deploy
            </div>
          </div>
          <Pill tone={channels.size > 0 ? "success" : "danger"}>
            {channels.size} live
          </Pill>
        </div>

        {errors.length > 0 && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 mb-3">
            <div className="flex items-center gap-1.5 text-[12px] font-bold text-red-700">
              <Icon.Flag size={14} color="#B91C1C" />
              {errors.length === 1 ? "1 configuration error" : `${errors.length} configuration errors`}
              <span className="font-semibold text-red-600">— intake is disabled for these</span>
            </div>
            <ul className="mt-2 space-y-1">
              {errors.map((e, i) => (
                <li key={i} className="text-[12px] text-red-700">
                  <span className="mono font-semibold">{e.channel ?? "LEAD_WEBHOOK_CHANNELS"}</span>{" "}
                  — {e.problem}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Warnings are channels that WORK but are weaker than they look —
            kept visually distinct from errors so a live channel is never
            mistaken for a disabled one. */}
        {warnings.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 mb-3">
            <div className="flex items-center gap-1.5 text-[12px] font-bold text-amber-800">
              <Icon.Flag size={14} color="#B45309" />
              {warnings.length === 1 ? "1 configuration warning" : `${warnings.length} configuration warnings`}
              <span className="font-semibold text-amber-700">— these channels still accept leads</span>
            </div>
            <ul className="mt-2 space-y-1">
              {warnings.map((w, i) => (
                <li key={i} className="text-[12px] text-amber-800">
                  <span className="mono font-semibold">{w.channel ?? "LEAD_WEBHOOK_CHANNELS"}</span>{" "}
                  — {w.problem}
                </li>
              ))}
            </ul>
          </div>
        )}

        {channels.size === 0 ? (
          <div className="text-[12px] text-slate-500">
            No channel is configured, so <span className="mono">/api/v1/leads/webhook/*</span>{" "}
            rejects everything. See <span className="mono">docs/lead-webhook-contract.md</span>.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-left">
                  <Th>Channel</Th>
                  <Th>Scheme</Th>
                  <Th>Signature header</Th>
                  <Th align="right">Tolerance</Th>
                  <Th>Lead source</Th>
                  <Th>Field map</Th>
                </tr>
              </thead>
              <tbody>
                {[...channels.values()].map((c) => {
                  const mapped = Object.keys(c.fieldMap).length;
                  // Only the two timestamp-signed schemes have a replay window
                  // to enforce; verifyDelivery never reads the timestamp for
                  // the others, so showing their configured tolerance would
                  // claim a protection that is not in force.
                  const windowed =
                    c.scheme === "hmac-sha256-hex" || c.scheme === "hmac-sha256-base64";
                  return (
                    <tr
                      key={c.channel}
                      className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50"
                    >
                      <Td>
                        <span className="mono font-semibold">{c.channel}</span>
                      </Td>
                      <Td>
                        {/* `bearer` is a static token with no integrity cover on
                            the body at all — worth flagging, not just listing. */}
                        <Pill tone={c.scheme === "bearer" ? "warning" : "slate"}>{c.scheme}</Pill>
                      </Td>
                      <Td className="mono text-[11px] text-slate-600">
                        {c.signatureHeader}
                        {c.signaturePrefix ? ` (${c.signaturePrefix}…)` : ""}
                      </Td>
                      <Td align="right" className="num">
                        {!windowed ? (
                          <span className="text-amber-700">n/a</span>
                        ) : c.toleranceSeconds > 0 ? (
                          `${c.toleranceSeconds}s`
                        ) : (
                          <span className="text-amber-700">off</span>
                        )}
                      </Td>
                      <Td className="text-slate-600">{c.source}</Td>
                      <Td>
                        {mapped > 0 ? (
                          <Pill tone="blue">{mapped} fields mapped</Pill>
                        ) : (
                          <span className="text-[11px] text-slate-400">Built-in aliases</span>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Filters. Plain links, so the whole view is shareable as a URL. */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        <FilterChip href={qs({ channel: "", page: "" })} active={!channel} label="All channels" />
        {channelNames.map((c) => (
          <FilterChip
            key={c}
            href={qs({ channel: c, page: "" })}
            active={channel === c}
            label={c}
          />
        ))}
        <span className="w-px bg-slate-200 mx-1" />
        <FilterChip href={qs({ status: "", page: "" })} active={!status} label="All statuses" />
        {DELIVERY_STATUSES.map((s) => (
          <FilterChip
            key={s}
            href={qs({ status: s, page: "" })}
            active={status === s}
            label={`${s} ${countForStatus(s)}`}
          />
        ))}
      </div>

      {deliveries.length === 0 ? (
        <EmptyState
          title={
            totalAll === 0
              ? "No webhook deliveries yet"
              : "No deliveries match this filter"
          }
          sub={
            totalAll === 0
              ? "Intake is configured with the LEAD_WEBHOOK_CHANNELS environment variable — one JSON entry per provider, no deploy needed. The contract to hand a provider (endpoint, signing, payload shape) is docs/lead-webhook-contract.md."
              : "Clear the channel or status filter to see the rest of the log."
          }
          action={
            totalAll === 0 ? undefined : (
              <Link
                href="/leads/intake"
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-[13px] font-semibold text-ink hover:border-slate-400"
              >
                Clear filters
              </Link>
            )
          }
        />
      ) : (
        <div className="bg-white rounded-2xl border border-slate-900/[.06] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-left">
                  <Th>Received</Th>
                  <Th>Channel</Th>
                  <Th>Submission id</Th>
                  <Th>Status</Th>
                  <Th align="right">Code</Th>
                  <Th>Message</Th>
                  <Th>Lead</Th>
                  <Th align="right">Action</Th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => (
                  <tr key={d.id} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50">
                    <Td>
                      <div className="font-semibold">{formatShortDate(d.receivedAt)}</div>
                      <div className="text-[10px] text-slate-400">{relativeTime(d.receivedAt)}</div>
                    </Td>
                    <Td>
                      <span className="mono font-semibold">{d.channel}</span>
                      {!channels.has(d.channel) && (
                        <div className="mt-0.5">
                          <Pill tone="warning">Not configured</Pill>
                        </div>
                      )}
                    </Td>
                    <Td className="mono text-[11px] text-slate-600">
                      {d.externalId ?? <span className="text-slate-400">-</span>}
                    </Td>
                    <Td>
                      <Pill tone={STATUS_TONES[d.status] ?? "slate"}>{d.status}</Pill>
                      {d.outcome && (
                        <div className="text-[10px] text-slate-400 mt-0.5">{d.outcome}</div>
                      )}
                      {d.replayedAt && (
                        <div className="text-[10px] text-slate-400">
                          Replayed {relativeTime(d.replayedAt)} · {d.attempts} attempts
                        </div>
                      )}
                    </Td>
                    <Td align="right" className="num text-slate-600">
                      {d.statusCode || "-"}
                    </Td>
                    <Td className="text-[11px] text-slate-600 max-w-[280px]">
                      {d.message || <span className="text-slate-400">-</span>}
                    </Td>
                    <Td>
                      {d.leadId ? (
                        <Link
                          href={`/leads/${d.leadId}`}
                          className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand-blue hover:underline"
                        >
                          Open <Icon.Chevron size={13} color="#1D4ED8" />
                        </Link>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </Td>
                    <Td align="right">
                      {REPLAYABLE.has(d.status) ? (
                        <ReplayButton id={d.id} onReplay={replayDeliveryAction} />
                      ) : (
                        <span className="text-[11px] text-slate-400">-</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <Pagination page={page} totalPages={totalPages} />

      {/* The import audit log. Wider than the webhook table: it also carries
          the Transcriber and Meta channels, which never produce a delivery
          row, so this is the only place all three intake paths line up. */}
      <div className="mt-6 mb-2 flex items-center justify-between">
        <div>
          <div className="text-base font-bold text-ink">Recent imports</div>
          <div className="text-[11px] text-slate-500">
            Every intake path — phone transcripts, Meta Lead Ads and provider webhooks
          </div>
        </div>
      </div>

      {imports.length === 0 ? (
        <EmptyState title="No imports recorded yet" sub="Nothing has reached the lead importer." />
      ) : (
        <div className="bg-white rounded-2xl border border-slate-900/[.06] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-left">
                  <Th>Received</Th>
                  <Th>Channel</Th>
                  <Th>Outcome</Th>
                  <Th align="right">Code</Th>
                  <Th>Credential</Th>
                  <Th>Message</Th>
                  <Th>Lead</Th>
                </tr>
              </thead>
              <tbody>
                {imports.map((i) => (
                  <tr key={i.id} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50">
                    <Td>
                      <div className="font-semibold">{formatShortDate(i.receivedAt)}</div>
                      <div className="text-[10px] text-slate-400">{relativeTime(i.receivedAt)}</div>
                    </Td>
                    <Td>
                      <span className="mono font-semibold">{i.channel}</span>
                    </Td>
                    <Td>
                      <Pill
                        tone={
                          i.outcome === "created" || i.outcome === "updated"
                            ? "success"
                            : i.outcome === "conflict"
                              ? "info"
                              : i.outcome === "rejected"
                                ? "danger"
                                : i.outcome === "error"
                                  ? "red"
                                  : "slate"
                        }
                      >
                        {i.outcome}
                      </Pill>
                    </Td>
                    <Td align="right" className="num text-slate-600">
                      {i.statusCode || "-"}
                    </Td>
                    <Td className="mono text-[11px] text-slate-600">
                      {i.apiKeyLabel || <span className="text-slate-400">-</span>}
                    </Td>
                    <Td className="text-[11px] text-slate-600 max-w-[280px]">
                      {i.message || <span className="text-slate-400">-</span>}
                    </Td>
                    <Td>
                      {i.leadId ? (
                        <Link
                          href={`/leads/${i.leadId}`}
                          className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand-blue hover:underline"
                        >
                          Open <Icon.Chevron size={13} color="#1D4ED8" />
                        </Link>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function FilterChip({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={`px-2.5 py-1.5 rounded-lg text-[12px] font-semibold transition ${
        active
          ? "bg-ink text-white"
          : "bg-white text-slate-600 border border-slate-200 hover:border-slate-400"
      }`}
    >
      {label}
    </Link>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "right" | "left" | "center" }) {
  return (
    <th
      className={`px-3 py-2.5 font-semibold text-slate-600 uppercase tracking-wider text-[10px] ${
        align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align,
  className,
}: {
  children: React.ReactNode;
  align?: "right" | "left" | "center";
  className?: string;
}) {
  return (
    <td
      className={`px-3 py-2.5 ${
        align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"
      } ${className ?? ""}`}
    >
      {children}
    </td>
  );
}
