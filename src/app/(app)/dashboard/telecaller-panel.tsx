import Link from "next/link";
import type { Session } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Avatar, Card, EmptyState, PageHeader, Pill, StatCard } from "@/components/ui";
import { Icon } from "@/components/icons";
import {
  formatINR,
  formatNumber,
  formatLongDate,
  formatShortDate,
  relativeTime,
  startOfDay,
  endOfDay,
} from "@/lib/format";
import { can } from "@/lib/access";
import { displayPhone, orDash, stageLabel, stageTone } from "@/lib/leads";
import { QUOTE_STATUSES, statusLabel, statusTone } from "@/lib/quote-review";

// The statuses worth a tile — the shared list minus the terminal ones, which
// are history rather than work. The labels and tones come from the same
// helpers the Quotations screens use, so a status cannot be called one thing
// here and another there.
const LIVE_STATUSES = QUOTE_STATUSES.filter((s) => s !== "rejected" && s !== "expired");

/**
 * The telecaller's dashboard — their own desk, and only their own desk.
 *
 * Every query here is filtered to this user: leads they own, quotations they
 * raised or that sit on their leads, calls they logged, tasks assigned to
 * them. A telecaller must not see another telecaller's leads, so there is no
 * "all leads" number anywhere on this panel — not even a count, because a
 * count is the first step to asking whose they are.
 *
 * Duty status leads, because a shift that was never started is the one thing
 * that makes everything else on this screen unrecorded.
 */
export default async function TelecallerPanel({ session }: { session: Session }) {
  const canRevenue = can(session, "revenue");
  const today = startOfDay();
  const todayEnd = endOfDay();

  // Quotations "theirs": ones they submitted for review, plus ones raised on a
  // lead they own (auto-drafted quotes have no submitter until someone sends
  // them in, and those are still this telecaller's to chase).
  const myQuotesWhere = {
    supersededById: null,
    OR: [{ submittedByUserId: session.userId }, { lead: { ownerUserId: session.userId } }],
  };

  const [duty, myLeads, openLeadCount, dueTodayCount, quoteGroups, callsToday, callCount, myTasks] =
    await Promise.all([
      // endedAt: null is "on duty now" — see DutySession in the schema.
      prisma.dutySession.findFirst({
        where: { userId: session.userId, endedAt: null },
        orderBy: { startedAt: "desc" },
      }),
      prisma.lead.findMany({
        where: { ownerUserId: session.userId, status: "open" },
        // Due first, earliest first; leads with no follow-up date trail.
        orderBy: [{ followUpDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
        take: 8,
        include: { stage: { select: { name: true } } },
      }),
      prisma.lead.count({ where: { ownerUserId: session.userId, status: "open" } }),
      prisma.lead.count({
        where: {
          ownerUserId: session.userId,
          status: "open",
          // Today or earlier — an overdue follow-up is still today's job.
          followUpDate: { lte: todayEnd },
        },
      }),
      prisma.quotation.groupBy({
        by: ["status"],
        where: myQuotesWhere,
        _count: true,
        _sum: { total: true },
      }),
      prisma.leadActivity.findMany({
        where: {
          userId: session.userId,
          kind: "call",
          createdAt: { gte: today, lte: todayEnd },
        },
        orderBy: { createdAt: "desc" },
        take: 8,
        include: { lead: { select: { id: true, customerName: true, place: true } } },
      }),
      prisma.leadActivity.count({
        where: {
          userId: session.userId,
          kind: "call",
          createdAt: { gte: today, lte: todayEnd },
        },
      }),
      prisma.task.findMany({
        where: { assignedToId: session.userId, status: "open" },
        orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
        take: 8,
        include: { createdBy: { select: { name: true } } },
      }),
    ]);

  const quoteCount = new Map(quoteGroups.map((g) => [g.status, g._count]));
  const quoteValue = new Map(quoteGroups.map((g) => [g.status, g._sum.total ?? 0]));
  // LIVE_STATUSES, not every status: "live" means still in play, so a
  // rejected or expired quotation must not inflate the telecaller's count of
  // what they still have working.
  const liveQuoteTotal = LIVE_STATUSES.reduce((s, status) => s + (quoteCount.get(status) ?? 0), 0);

  const connected = callsToday.filter((a) => a.outcome === "connected").length;
  const overdueTasks = myTasks.filter((t) => t.dueDate && t.dueDate < today).length;

  return (
    <>
      <PageHeader
        title={`Hi, ${session.name}`}
        sub={formatLongDate(new Date())}
        right={
          <Link
            href="/leads?due=1"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-brand-red text-white text-[13px] font-semibold shadow-red hover:bg-brand-redDark"
          >
            <Icon.Clock size={16} />
            <span className="hidden sm:inline">Follow-ups due</span>
            <span className="num">{dueTodayCount}</span>
          </Link>
        }
      />

      {/* Duty first. Nothing else on this screen is being credited to anybody
          if the shift was never started. */}
      {duty ? (
        <div className="bg-white rounded-2xl p-4 border border-emerald-200 mb-5 flex items-center gap-3">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-bold text-ink">On duty</div>
            <div className="text-[12px] text-slate-500 truncate">
              Since{" "}
              {duty.startedAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} (
              {relativeTime(duty.startedAt)})
              {duty.location ? ` · ${duty.location}` : " · location not recorded"}
              {duty.note ? ` · ${duty.note}` : ""}
            </div>
          </div>
          <Link
            href="/duty"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-[12px] font-semibold text-ink hover:border-slate-400 flex-shrink-0"
          >
            <Icon.Clock size={14} /> Duty log
          </Link>
        </div>
      ) : (
        <div className="bg-white rounded-2xl p-4 border border-brand-red/30 shadow-card mb-5 flex items-center gap-3">
          <span className="w-2.5 h-2.5 rounded-full bg-brand-red flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-bold text-ink">Not on duty</div>
            <div className="text-[12px] text-slate-500">
              Start your shift so today&apos;s calls are recorded against it.
            </div>
          </div>
          <Link
            href="/duty"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-brand-red text-white text-[12px] font-semibold shadow-red hover:bg-brand-redDark flex-shrink-0"
          >
            <Icon.Clock size={14} /> Start shift
          </Link>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatCard label="My open leads" value={formatNumber(openLeadCount)} tone="ink" />
        <StatCard
          label="Follow-ups due"
          value={formatNumber(dueTodayCount)}
          sub="Today or overdue"
          tone={dueTodayCount > 0 ? "red" : "default"}
        />
        <StatCard
          label="Calls logged today"
          value={formatNumber(callCount)}
          sub={`${connected} connected`}
          tone="blue"
        />
        <StatCard
          label="My open tasks"
          value={formatNumber(myTasks.length)}
          sub={overdueTasks > 0 ? `${overdueTasks} overdue` : "Nothing overdue"}
          tone={overdueTasks > 0 ? "red" : "default"}
        />
      </div>

      {/* Their quotations, by status — where each one is stuck and who with. */}
      <Card className="mb-4">
        <div className="flex items-baseline justify-between mb-3">
          <div>
            <div className="text-base font-bold text-ink">My quotations</div>
            <div className="text-xs text-slate-500">
              {formatNumber(liveQuoteTotal)} live · raised by me or on my leads
            </div>
          </div>
          <Link href="/quotations" className="text-xs font-semibold text-brand-blue">
            All quotations →
          </Link>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
          {QUOTE_STATUSES.map((status) => {
            const n = quoteCount.get(status) ?? 0;
            return (
              <Link
                key={status}
                href={`/quotations?status=${status}`}
                className="bg-slate-50 rounded-xl p-3 text-center hover:bg-slate-100 transition"
              >
                <div className={`num display text-lg font-bold ${n > 0 ? "text-ink" : "text-slate-300"}`}>
                  {formatNumber(n)}
                </div>
                <div className="mt-1 flex justify-center">
                  <Pill tone={statusTone(status)}>{statusLabel(status)}</Pill>
                </div>
                {canRevenue && n > 0 && (
                  <div className="num text-[10px] text-slate-500 mt-1">
                    {formatINR(quoteValue.get(status) ?? 0, { compact: true })}
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      </Card>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* My leads. Owner-filtered in the query, not in the render — nobody
            else's lead is ever fetched here in the first place. */}
        <Card className="lg:col-span-2">
          <div className="flex items-baseline justify-between mb-3">
            <div>
              <div className="text-base font-bold text-ink">My leads</div>
              <div className="text-xs text-slate-500">Open, soonest follow-up first</div>
            </div>
            <Link href="/leads" className="text-xs font-semibold text-brand-blue">
              My list →
            </Link>
          </div>
          {myLeads.length === 0 ? (
            <EmptyState
              title="No leads assigned to you"
              sub="A lead reaches you when it is assigned an owner on the Leads screen."
            />
          ) : (
            <div className="divide-y divide-slate-100">
              {myLeads.map((l) => {
                const due = !!l.followUpDate && l.followUpDate <= todayEnd;
                const value =
                  l.totalBudget ??
                  (l.brickCount && l.costPerBrick ? l.brickCount * l.costPerBrick : null);
                return (
                  <Link
                    key={l.id}
                    href={`/leads/${l.id}`}
                    className="flex items-center gap-3 py-2.5 hover:bg-slate-50 -mx-2 px-2 rounded-lg"
                  >
                    <Avatar name={l.customerName || "?"} size={32} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-semibold text-ink truncate">
                          {l.customerName || (
                            <span className="text-slate-400">Name not captured</span>
                          )}
                        </span>
                        <Pill tone={stageTone(l.quotationStage)}>
                          {l.stage?.name ?? stageLabel(l.quotationStage)}
                        </Pill>
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {orDash(displayPhone(l))}
                        {l.place ? ` · ${l.place}` : ""}
                        {l.brickCount ? ` · ${formatNumber(l.brickCount)} bricks` : ""}
                      </div>
                    </div>
                    {l.followUpDate ? (
                      <Pill tone={due ? "red" : "slate"}>
                        {due ? "Due " : "Follow-up "}
                        {formatShortDate(l.followUpDate)}
                      </Pill>
                    ) : (
                      <Pill tone="slate">No follow-up</Pill>
                    )}
                    {canRevenue && value ? (
                      <div className="num text-[12px] font-bold text-ink flex-shrink-0 hidden sm:block">
                        {formatINR(value, { compact: true })}
                      </div>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          )}
        </Card>

        {/* Calls they logged today. */}
        <Card className="lg:col-span-1">
          <div className="flex items-baseline justify-between mb-3">
            <div>
              <div className="text-base font-bold text-ink">My calls today</div>
              <div className="text-xs text-slate-500">
                {formatNumber(callCount)} logged · {connected} connected
              </div>
            </div>
          </div>
          {callsToday.length === 0 ? (
            <div className="text-[12px] text-slate-500 py-6 text-center">
              No calls logged yet today.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {callsToday.map((a) => (
                <Link
                  key={a.id}
                  href={`/leads/${a.leadId}`}
                  className="block py-2 hover:bg-slate-50 -mx-2 px-2 rounded-lg"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-semibold text-ink truncate flex-1 min-w-0">
                      {a.lead.customerName || "Name not captured"}
                    </span>
                    {a.outcome && (
                      <Pill tone={a.outcome === "connected" ? "success" : "slate"}>
                        {a.outcome}
                      </Pill>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-500 truncate">
                    {relativeTime(a.createdAt)}
                    {a.note ? ` · ${a.note}` : ""}
                  </div>
                </Link>
              ))}
              {callCount > callsToday.length && (
                <div className="text-[11px] text-slate-500 pt-2">
                  {callCount - callsToday.length} more logged today.
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Their tasks. */}
        <Card className="lg:col-span-3">
          <div className="flex items-baseline justify-between mb-3">
            <div>
              <div className="text-base font-bold text-ink">My tasks</div>
              <div className="text-xs text-slate-500">Open and assigned to me</div>
            </div>
            <Link href="/tasks" className="text-xs font-semibold text-brand-blue">
              All tasks →
            </Link>
          </div>
          {myTasks.length === 0 ? (
            <div className="text-[12px] text-slate-500 py-6 text-center">
              Nothing assigned to you.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {myTasks.map((t) => {
                const overdue = !!t.dueDate && t.dueDate < today;
                return (
                  <Link
                    key={t.id}
                    href="/tasks"
                    className="flex items-center gap-3 py-2.5 hover:bg-slate-50 -mx-2 px-2 rounded-lg"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold text-ink truncate">{t.title}</div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {t.createdBy ? `From ${t.createdBy.name}` : "No sender recorded"}
                        {t.details ? ` · ${t.details}` : ""}
                      </div>
                    </div>
                    {t.dueDate ? (
                      <Pill tone={overdue ? "red" : "slate"}>
                        {overdue ? "Overdue " : "Due "}
                        {t.dueDate.toLocaleDateString("en-IN")}
                      </Pill>
                    ) : (
                      <Pill tone="slate">No date</Pill>
                    )}
                  </Link>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
