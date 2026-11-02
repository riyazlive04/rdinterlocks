import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireArea } from "@/lib/auth";
import { can } from "@/lib/access";
import { Avatar, Card, PageHeader, Pill } from "@/components/ui";
import { Icon } from "@/components/icons";
import { formatINR, formatISODate, formatLongDate, formatNumber, formatShortDate } from "@/lib/format";
import { displayPhone, isFollowUpDue, orDash } from "@/lib/leads";
import { FollowUpControl, LeadStatusActions, StagePicker } from "./lead-controls";
import { WhatsAppThread } from "./whatsapp-thread";
import { ActivityForm } from "../activity-form";
import { kindLabel, outcomeLabel, outcomeTone } from "../activity-meta";
import { OwnerPicker } from "../owner-picker";
import { ZonePicker } from "../zone-picker";
import { enrollLeadInSequence, stopEnrollment } from "../../whatsapp/actions";

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireArea("leads");
  const { id } = await params;

  const [lead, users, zones] = await Promise.all([
    prisma.lead.findUnique({
      where: { id },
      include: {
        brickSize: true,
        constructionTypeRef: true,
        convertedClient: true,
        owner: { select: { id: true, name: true } },
        zone: { select: { id: true, name: true, distanceLabel: true } },
        imports: { orderBy: { receivedAt: "desc" }, take: 20 },
        // Newest first: the last thing that happened is the thing the person
        // on the phone needs. Append-only by design — nothing in the app
        // edits or deletes a LeadActivity row.
        activities: {
          orderBy: { createdAt: "desc" },
          take: 50,
          include: { user: { select: { id: true, name: true } } },
        },
      },
    }),
    // Who a lead can be handed to.
    prisma.user.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    // Delivery zones a lead can be placed in — the rate chart's price bands.
    prisma.deliveryZone.findMany({
      where: { active: true },
      orderBy: { order: "asc" },
      select: { id: true, name: true, distanceLabel: true },
    }),
  ]);
  if (!lead) notFound();

  const canWhatsApp = can(session, "whatsapp");
  const [waMessages, activeEnrollment, availableSequences] = canWhatsApp
    ? await Promise.all([
        prisma.waMessage.findMany({
          where: { leadId: id },
          orderBy: { createdAt: "asc" },
          include: { template: true },
        }),
        prisma.waEnrollment.findFirst({
          where: { leadId: id, status: "active" },
          include: { sequence: true, currentStep: { include: { template: true } } },
        }),
        prisma.waSequence.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      ])
    : [[], null, []];

  const locked = !!lead.convertedAt;
  const due = isFollowUpDue(lead);
  const value =
    lead.totalBudget ?? (lead.brickCount && lead.costPerBrick ? lead.brickCount * lead.costPerBrick : null);
  const extra = (lead.extra as Record<string, unknown> | null) ?? {};
  const extraKeys = Object.keys(extra);

  // An owner who has since been deactivated still has to appear in the picker,
  // otherwise the control would silently read as "Unassigned" on a lead that
  // very much has an owner.
  const leadOwner = lead.owner;
  const ownerOptions =
    leadOwner && !users.some((u) => u.id === leadOwner.id)
      ? [{ id: leadOwner.id, name: `${leadOwner.name} (inactive)` }, ...users]
      : users;

  // Meta attribution. Captured on every Meta lead by the webhook and, until
  // now, shown nowhere — so a campaign could not be judged by what it
  // actually produced. Transcriber leads have none of it, hence the guard.
  const hasCampaignFields = !!(
    lead.campaignId ||
    lead.adsetId ||
    lead.adId ||
    lead.formId ||
    lead.platform
  );
  const showCampaign = lead.source !== "transcriber" || hasCampaignFields;

  return (
    <>
      <PageHeader
        title={lead.customerName || "Name not captured"}
        sub={
          lead.callSequence > 1
            ? `Call ${lead.callSequence} · latest ${lead.callId}`
            : `Call ${lead.callId}`
        }
        back="/leads"
        right={
          !locked ? (
            <div className="flex gap-2">
              <Link
                href={`/leads/${lead.id}/edit`}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-900/[.1] text-[13px] font-semibold hover:bg-slate-50"
              >
                <Icon.Pencil size={15} /> Edit
              </Link>
              {can(session, "quotations") && can(session, "revenue") && (
                <Link
                  href={`/quotations/new?leadId=${lead.id}`}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-900/[.1] text-[13px] font-semibold hover:bg-slate-50"
                >
                  <Icon.FileText size={15} /> Quote
                </Link>
              )}
              <Link
                href={`/leads/${lead.id}/convert`}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-brand-red text-white text-[13px] font-semibold shadow-red hover:bg-brand-redDark"
              >
                <Icon.Check size={15} /> Convert
              </Link>
            </div>
          ) : (
            <Pill tone="success">Converted</Pill>
          )
        }
      />

      {locked && (
        <Card className="mb-4 border-emerald-200 bg-emerald-50">
          <div className="flex items-center gap-2 flex-wrap">
            <Icon.Check size={16} color="#047857" />
            <span className="text-[13px] font-semibold text-emerald-900">
              Converted on {formatLongDate(lead.convertedAt!)}
            </span>
            {lead.convertedClient && (
              <Link
                href={`/clients/${lead.convertedClient.id}`}
                className="text-[13px] font-semibold text-brand-blue underline"
              >
                → {lead.convertedClient.name}
              </Link>
            )}
          </div>
          <div className="text-[11px] text-emerald-800 mt-1">
            This lead is now read-only. Further imports for this contact are refused with 409
            rather than overwriting it.
          </div>
        </Card>
      )}

      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <div className="text-base font-bold text-ink mb-3">Enquiry</div>
          <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-3">
            <Row label="Customer name" value={orDash(lead.customerName)} />
            <Row label="Phone" value={orDash(displayPhone(lead))} />
            <Row label="Place" value={orDash(lead.place)} />
            <Row
              label="Type of bricks"
              value={orDash(lead.brickType)}
              hint={lead.brickSize ? `matched ${lead.brickSize.label}` : "no master-data match"}
            />
            <Row
              label="Number of bricks"
              value={lead.brickCount === null ? "—" : formatNumber(lead.brickCount)}
            />
            <Row
              label="Type of construction"
              value={orDash(lead.constructionType)}
              hint={
                lead.constructionTypeRef
                  ? `matched ${lead.constructionTypeRef.name}`
                  : "no master-data match"
              }
            />
            <Row
              label="Cost per brick"
              value={lead.costPerBrick === null ? "—" : formatINR(lead.costPerBrick)}
            />
            <Row
              label="Total budget"
              value={lead.totalBudget === null ? "—" : formatINR(lead.totalBudget)}
            />
            <Row label="Source" value={lead.source} />
          </dl>

          <div className="mt-4 pt-3 border-t border-slate-100">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
              Notes
            </div>
            <div className="text-[13px] text-ink whitespace-pre-wrap">
              {lead.notes || <span className="text-slate-400">Nothing captured</span>}
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <div className="text-base font-bold text-ink mb-3">Pipeline</div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
              Owner
            </div>
            <OwnerPicker
              id={lead.id}
              ownerUserId={lead.ownerUserId}
              ownerName={leadOwner?.name ?? null}
              users={ownerOptions}
              locked={locked}
            />

            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mt-4 mb-1.5">
              Delivery zone
            </div>
            <ZonePicker
              id={lead.id}
              zoneId={lead.zoneId}
              zoneName={
                lead.zone
                  ? `${lead.zone.name}${lead.zone.distanceLabel ? ` (${lead.zone.distanceLabel})` : ""}`
                  : null
              }
              zones={zones}
              locked={locked}
            />

            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mt-4 mb-1.5">
              Quotation stage
            </div>
            <StagePicker id={lead.id} stage={lead.quotationStage} locked={locked} />

            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mt-4 mb-1.5">
              Follow-up {due && <span className="text-brand-red">· due</span>}
            </div>
            <FollowUpControl
              id={lead.id}
              date={lead.followUpDate ? formatISODate(lead.followUpDate) : null}
              locked={locked}
            />

            <div className="mt-4 pt-3 border-t border-slate-100 flex items-baseline justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Value
              </span>
              <span className="num text-[16px] font-bold text-ink">
                {value === null ? "—" : formatINR(value)}
              </span>
            </div>
          </Card>

          {showCampaign && (
            <Card>
              <div className="text-base font-bold text-ink mb-1">Campaign</div>
              <div className="text-[11px] text-slate-500 mb-3">
                Meta attribution, exactly as the lead form delivered it.
              </div>
              <dl className="space-y-2">
                <Row label="Platform" value={orDash(lead.platform)} />
                <IdRow label="Campaign" value={orDash(lead.campaignId)} />
                <IdRow label="Ad set" value={orDash(lead.adsetId)} />
                <IdRow label="Ad" value={orDash(lead.adId)} />
                <IdRow label="Form" value={orDash(lead.formId)} />
              </dl>
            </Card>
          )}

          {extraKeys.length > 0 && (
            <Card>
              <div className="text-base font-bold text-ink mb-1">Extra fields</div>
              <div className="text-[11px] text-slate-500 mb-3">
                Sent by the Transcriber but not modelled here yet — kept verbatim.
              </div>
              <dl className="space-y-2">
                {extraKeys.map((k) => (
                  <div key={k}>
                    <dt className="mono text-[10px] uppercase tracking-wider text-slate-500">{k}</dt>
                    <dd className="text-[12px] text-ink break-words">
                      {typeof extra[k] === "object"
                        ? JSON.stringify(extra[k])
                        : String(extra[k])}
                    </dd>
                  </div>
                ))}
              </dl>
            </Card>
          )}
        </div>

        <Card className="lg:col-span-3">
          <div className="flex items-baseline justify-between mb-3">
            <div>
              <div className="text-base font-bold text-ink">Activity</div>
              <div className="text-xs text-slate-500">
                Every call, message and visit on this lead — append-only
              </div>
            </div>
            <span className="text-[11px] font-semibold text-slate-500">
              {lead.activities.length} {lead.activities.length === 1 ? "entry" : "entries"}
            </span>
          </div>

          <ActivityForm id={lead.id} locked={locked} />

          {lead.activities.length === 0 ? (
            <div className="text-sm text-slate-500 py-4 text-center">
              Nothing logged yet — the first call goes in the form above.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 mt-3">
              {lead.activities.map((a) => (
                <div key={a.id} className="py-2.5 flex items-start gap-3">
                  <Avatar name={a.user?.name || "?"} size={28} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[12px] font-semibold text-ink">
                        {/* userId is SetNull on user deletion — the entry
                            outlives whoever made it. */}
                        {a.user?.name ?? "Deleted user"}
                      </span>
                      <Pill tone="slate">{kindLabel(a.kind)}</Pill>
                      {a.outcome && (
                        <Pill tone={outcomeTone(a.outcome)}>{outcomeLabel(a.outcome)}</Pill>
                      )}
                    </div>
                    {a.note && (
                      <div className="text-[12px] text-ink whitespace-pre-wrap mt-0.5">{a.note}</div>
                    )}
                    {a.nextActionAt && (
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        Next action {formatShortDate(a.nextActionAt)}
                      </div>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500 whitespace-nowrap">
                    {a.createdAt.toLocaleString("en-IN")}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="lg:col-span-3">
          <div className="flex items-baseline justify-between mb-3">
            <div>
              <div className="text-base font-bold text-ink">Import history</div>
              <div className="text-xs text-slate-500">
                Every request the Transcriber sent for this call
              </div>
            </div>
            <span className="text-[11px] font-semibold text-slate-500">
              {lead.imports.length} {lead.imports.length === 1 ? "request" : "requests"}
            </span>
          </div>
          {lead.imports.length === 0 ? (
            <div className="text-sm text-slate-500 py-4 text-center">
              No import records — this lead was not created by the API.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {lead.imports.map((imp) => (
                <div key={imp.id} className="py-2.5 flex items-start gap-3">
                  <Pill
                    tone={
                      imp.statusCode >= 500
                        ? "danger"
                        : imp.statusCode === 409
                          ? "warning"
                          : imp.statusCode >= 400
                            ? "red"
                            : "success"
                    }
                  >
                    {imp.statusCode}
                  </Pill>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-semibold text-ink">
                      {imp.outcome}
                      {imp.apiKeyLabel && (
                        <span className="font-normal text-slate-500"> · key {imp.apiKeyLabel}</span>
                      )}
                    </div>
                    {imp.message && (
                      <div className="text-[11px] text-slate-500 break-words">{imp.message}</div>
                    )}
                    <div className="mono text-[10px] text-slate-400 mt-0.5">
                      {imp.requestId}
                    </div>
                  </div>
                  <div className="text-[11px] text-slate-500 whitespace-nowrap">
                    {imp.receivedAt.toLocaleString("en-IN")}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {canWhatsApp && (
          <Card className="lg:col-span-3">
            <WhatsAppThread
              leadId={lead.id}
              optOut={lead.whatsappOptOut}
              messages={waMessages.map((m) => ({
                id: m.id,
                direction: m.direction,
                status: m.status,
                body: m.body,
                templateName: m.template?.name ?? null,
                createdAt: m.createdAt.toISOString(),
              }))}
              activeEnrollment={
                activeEnrollment
                  ? {
                      id: activeEnrollment.id,
                      sequenceName: activeEnrollment.sequence.name,
                      currentTemplateName: activeEnrollment.currentStep?.template.name ?? null,
                      nextRunAt: activeEnrollment.nextRunAt ? activeEnrollment.nextRunAt.toISOString() : null,
                    }
                  : null
              }
              availableSequences={availableSequences.map((s) => ({ id: s.id, name: s.name }))}
              onEnroll={enrollLeadInSequence}
              onStop={stopEnrollment}
            />
          </Card>
        )}
      </div>

      <div className="mt-4">
        <LeadStatusActions id={lead.id} status={lead.status} converted={locked} />
      </div>
    </>
  );
}

// Meta ids are long numeric strings — shown in the same mono/break style the
// Extra fields card uses, so they can be copied into Ads Manager without the
// card blowing out sideways.
function IdRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className="mono text-[12px] text-ink break-all">{value}</dd>
    </div>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className="text-[14px] text-ink font-medium">{value}</dd>
      {hint && <div className="text-[10px] text-slate-400">{hint}</div>}
    </div>
  );
}
