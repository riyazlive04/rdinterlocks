import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireArea } from "@/lib/auth";
import { Avatar, PageHeader, Pill, EmptyState, StatCard } from "@/components/ui";
import { Icon } from "@/components/icons";
import { Pagination } from "@/components/pagination";
import { formatINR, formatNumber, formatShortDate, startOfDay } from "@/lib/format";
import { STAGE_ORDER, displayPhone, isFollowUpDue, orDash, stageLabel, stageTone } from "@/lib/leads";

const PAGE_SIZE = 40;

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    stage?: string;
    status?: string;
    due?: string;
    source?: string;
    owner?: string;
    page?: string;
  }>;
}) {
  await requireArea("leads");
  const sp = await searchParams;
  const q = sp?.q?.trim() ?? "";
  const stage = sp?.stage ?? "";
  const status = sp?.status ?? "open";
  const dueOnly = sp?.due === "1";
  // "" means every source / every owner. The owner=unassigned value is the one
  // that matters day to day: a lead ingested from Meta arrives with nobody on
  // it, and nobody calls a lead they do not own.
  const source = sp?.source ?? "";
  const owner = sp?.owner ?? "";
  const today = startOfDay();
  const todayEnd = new Date(today.getTime() + 86400000 - 1);

  const where = {
    ...(status === "all" ? {} : { status }),
    ...(stage ? { quotationStage: stage } : {}),
    ...(dueOnly ? { followUpDate: { lte: todayEnd }, status: "open" } : {}),
    ...(source ? { source } : {}),
    ...(owner === "unassigned" ? { ownerUserId: null } : owner ? { ownerUserId: owner } : {}),
    ...(q
      ? {
          OR: [
            { customerName: { contains: q, mode: "insensitive" as const } },
            { phoneNumber: { contains: q, mode: "insensitive" as const } },
            { phoneMasked: { contains: q, mode: "insensitive" as const } },
            { place: { contains: q, mode: "insensitive" as const } },
            { callId: { contains: q, mode: "insensitive" as const } },
            { notes: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [leads, stageCounts, dueCount, openCount, unassignedCount, convertedCount, users] =
    await Promise.all([
      prisma.lead.findMany({
        where,
        // Newest lead first — a freshly-dispatched call lands at the top of the
        // list. Follow-up prioritisation is still available via the "Due" filter
        // and the "Follow-ups due" button, so nothing is lost by not sorting on it
        // here.
        orderBy: { createdAt: "desc" },
        include: {
          convertedClient: { select: { id: true, name: true } },
          owner: { select: { id: true, name: true } },
        },
      }),
      prisma.lead.groupBy({ by: ["quotationStage"], _count: true, where: { status: "open" } }),
      prisma.lead.count({ where: { status: "open", followUpDate: { lte: todayEnd } } }),
      prisma.lead.count({ where: { status: "open" } }),
      prisma.lead.count({ where: { status: "open", ownerUserId: null } }),
      prisma.lead.count({ where: { status: "converted" } }),
      prisma.user.findMany({
        where: { active: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
    ]);

  const page = Math.max(1, Number(sp?.page) || 1);
  const totalPages = Math.max(1, Math.ceil(leads.length / PAGE_SIZE));
  const pageLeads = leads.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const countFor = (s: string) =>
    stageCounts.find((c) => c.quotationStage === s)?._count ?? 0;

  // Pipeline value: what the open leads are worth if they all land. Falls back
  // to qty × price when the caller didn't state a budget.
  const pipeline = leads
    .filter((l) => l.status === "open")
    .reduce((sum, l) => {
      const value =
        l.totalBudget ?? (l.brickCount && l.costPerBrick ? l.brickCount * l.costPerBrick : 0);
      return sum + value;
    }, 0);

  const qs = (over: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { q, stage, status, due: dueOnly ? "1" : "", source, owner, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const s = params.toString();
    return s ? `/leads?${s}` : "/leads";
  };

  return (
    <>
      <PageHeader
        title="Leads"
        sub="Enquiries captured from recorded calls"
        right={
          <div className="flex items-center gap-2">
            <Link
              href="/leads/board"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-[13px] font-semibold text-ink hover:border-slate-400"
            >
              <Icon.Chart size={16} />
              <span className="hidden sm:inline">Board</span>
            </Link>
            <Link
              href="/leads?due=1"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-brand-red text-white text-[13px] font-semibold shadow-red hover:bg-brand-redDark"
            >
              <Icon.Clock size={16} />
              <span className="hidden sm:inline">Follow-ups due</span>
              <span className="num">{dueCount}</span>
            </Link>
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
        <StatCard label="Open leads" value={formatNumber(openCount)} tone="ink" />
        {/* The number that decides whether any of this pipeline gets worked at
            all: a lead nobody owns is a lead nobody is calling. */}
        <StatCard
          label="Unassigned"
          value={formatNumber(unassignedCount)}
          sub="Open, no owner"
          tone={unassignedCount > 0 ? "red" : "default"}
        />
        <StatCard
          label="Follow-ups due"
          value={formatNumber(dueCount)}
          sub="Today or overdue"
          tone={dueCount > 0 ? "red" : "default"}
        />
        <StatCard
          label="Pipeline value"
          value={formatINR(pipeline, { compact: true })}
          sub="Open leads, budget or qty × rate"
          tone="blue"
        />
        <StatCard label="Converted" value={formatNumber(convertedCount)} tone="success" />
      </div>

      {/* Filters. Plain links, so the whole view is shareable as a URL. */}
      <form className="mb-3" method="get">
        {stage && <input type="hidden" name="stage" value={stage} />}
        {status !== "open" && <input type="hidden" name="status" value={status} />}
        {dueOnly && <input type="hidden" name="due" value="1" />}
        {source && <input type="hidden" name="source" value={source} />}
        {owner && <input type="hidden" name="owner" value={owner} />}
        <div className="relative">
          <Icon.Search
            size={16}
            color="#94A3B8"
            className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
          />
          <input
            name="q"
            defaultValue={q}
            placeholder="Search by name, phone, place, call id or notes…"
            className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-white border border-slate-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-brand-red/30"
          />
        </div>
      </form>

      <div className="flex flex-wrap gap-1.5 mb-2">
        <FilterChip href={qs({ stage: "" })} active={!stage} label="All stages" />
        {STAGE_ORDER.map((s) => (
          <FilterChip
            key={s}
            href={qs({ stage: s })}
            active={stage === s}
            label={`${stageLabel(s)} ${countFor(s)}`}
          />
        ))}
        <span className="w-px bg-slate-200 mx-1" />
        <FilterChip href={qs({ status: "open", due: "" })} active={status === "open" && !dueOnly} label="Open" />
        <FilterChip href={qs({ due: "1", status: "open" })} active={dueOnly} label="Due" />
        <FilterChip href={qs({ status: "converted", due: "" })} active={status === "converted"} label="Converted" />
        <FilterChip href={qs({ status: "discarded", due: "" })} active={status === "discarded"} label="Discarded" />
        <FilterChip href={qs({ status: "all", due: "" })} active={status === "all"} label="All" />
      </div>

      {/* Where the lead came from, and whose job it is. */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        <FilterChip href={qs({ source: "" })} active={!source} label="All sources" />
        <FilterChip href={qs({ source: "meta" })} active={source === "meta"} label="Meta" />
        <FilterChip href={qs({ source: "transcriber" })} active={source === "transcriber"} label="Call" />
        <span className="w-px bg-slate-200 mx-1" />
        <FilterChip href={qs({ owner: "" })} active={!owner} label="All owners" />
        <FilterChip
          href={qs({ owner: "unassigned" })}
          active={owner === "unassigned"}
          label={`Unassigned ${unassignedCount}`}
        />
        {users.map((u) => (
          <FilterChip key={u.id} href={qs({ owner: u.id })} active={owner === u.id} label={u.name} />
        ))}
      </div>

      {leads.length === 0 ? (
        <EmptyState
          title={q ? `No leads matching "${q}"` : "No leads yet"}
          sub="Leads arrive automatically from the Transcriber after each recorded call."
        />
      ) : (
        <div className="space-y-2">
          {pageLeads.map((l) => {
            const due = isFollowUpDue(l);
            const value =
              l.totalBudget ?? (l.brickCount && l.costPerBrick ? l.brickCount * l.costPerBrick : null);
            return (
              <Link
                key={l.id}
                href={`/leads/${l.id}`}
                className="bg-white rounded-2xl p-3.5 border border-slate-200 hover:border-slate-400 transition flex items-center gap-3"
              >
                <Avatar name={l.customerName || "?"} size={40} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-bold text-ink truncate">
                      {l.customerName || <span className="text-slate-400">Name not captured</span>}
                    </span>
                    <Pill tone={stageTone(l.quotationStage)}>{stageLabel(l.quotationStage)}</Pill>
                    {/* A Meta form fill and a recorded call are worked in
                        completely different ways, so the source belongs on the
                        row rather than one click in. */}
                    <Pill tone={l.source === "meta" ? "info" : "slate"}>
                      {l.source === "meta" ? "Meta" : "Call"}
                    </Pill>
                    {l.callSequence > 1 && <Pill tone="blue">Call {l.callSequence}</Pill>}
                    {l.status === "converted" && <Pill tone="success">Converted</Pill>}
                    {l.status === "discarded" && <Pill tone="slate">Discarded</Pill>}
                  </div>
                  <div className="text-[11px] text-slate-500 truncate mt-0.5">
                    {orDash(displayPhone(l))}
                    {l.place ? ` · ${l.place}` : ""}
                    {l.brickCount ? ` · ${formatNumber(l.brickCount)} bricks` : ""}
                    {l.brickType ? ` · ${l.brickType}` : ""}
                    {l.constructionType ? ` · ${l.constructionType}` : ""}
                  </div>
                  <div className="flex gap-1.5 mt-1.5 items-center">
                    <span className="mono text-[10px] text-slate-400">{l.callId}</span>
                    {l.followUpDate && (
                      <Pill tone={due ? "red" : "slate"}>
                        {due ? "Due " : "Follow-up "}
                        {formatShortDate(l.followUpDate)}
                      </Pill>
                    )}
                    {l.convertedClient && (
                      <Pill tone="success">→ {l.convertedClient.name}</Pill>
                    )}
                  </div>
                </div>
                {/* Owner. "Unassigned" is deliberately loud rather than a quiet
                    blank — it is a thing to act on, not a missing value. */}
                <div className="hidden sm:flex flex-shrink-0 w-28 justify-end">
                  {l.owner ? (
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Avatar name={l.owner.name} size={22} />
                      <span className="text-[12px] font-semibold text-slate-700 truncate">
                        {l.owner.name}
                      </span>
                    </div>
                  ) : (
                    <Pill tone="red">Unassigned</Pill>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  {value ? (
                    <div className="num text-[13px] font-bold text-ink">
                      {formatINR(value, { compact: true })}
                    </div>
                  ) : (
                    <div className="text-[11px] text-slate-400">No value</div>
                  )}
                  {l.costPerBrick && (
                    <div className="num text-[10px] text-slate-500">
                      {formatINR(l.costPerBrick)}/brick
                    </div>
                  )}
                </div>
                <Icon.Chevron size={16} color="#94A3B8" />
              </Link>
            );
          })}
        </div>
      )}
      <Pagination page={page} totalPages={totalPages} />
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
