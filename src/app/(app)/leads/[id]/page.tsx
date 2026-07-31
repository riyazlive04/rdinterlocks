import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireArea } from "@/lib/auth";
import { Card, PageHeader, Pill } from "@/components/ui";
import { Icon } from "@/components/icons";
import { formatINR, formatISODate, formatLongDate, formatNumber } from "@/lib/format";
import { displayPhone, isFollowUpDue, orDash } from "@/lib/leads";
import { FollowUpControl, LeadStatusActions, StagePicker } from "./lead-controls";

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireArea("leads");
  const { id } = await params;

  const lead = await prisma.lead.findUnique({
    where: { id },
    include: {
      brickSize: true,
      constructionTypeRef: true,
      convertedClient: true,
      imports: { orderBy: { receivedAt: "desc" }, take: 20 },
    },
  });
  if (!lead) notFound();

  const locked = !!lead.convertedAt;
  const due = isFollowUpDue(lead);
  const value =
    lead.totalBudget ?? (lead.brickCount && lead.costPerBrick ? lead.brickCount * lead.costPerBrick : null);
  const extra = (lead.extra as Record<string, unknown> | null) ?? {};
  const extraKeys = Object.keys(extra);

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
      </div>

      <div className="mt-4">
        <LeadStatusActions id={lead.id} status={lead.status} converted={locked} />
      </div>
    </>
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
