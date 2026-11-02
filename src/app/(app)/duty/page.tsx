import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireArea } from "@/lib/auth";
import { can } from "@/lib/access";
import { isFullAccess, roleLabel } from "@/lib/roles";
import { dutyDurationLabel, listOnDuty } from "@/lib/duty";
import { Avatar, Card, EmptyState, PageHeader, Pill, StatCard } from "@/components/ui";
import { Icon } from "@/components/icons";
import { formatNumber, formatShortDate, startOfDay } from "@/lib/format";
import { ShiftControl } from "./shift-control";
import { EndShiftForButton } from "./end-shift-for-button";
import { LiveDuration } from "./live-duration";

// The duty board: who is on the phone right now, since when, and from where.
//
// This screen exists because of one sentence from the owner — "before they
// speak, it must be shown in the webapp who is speaking, from when and from
// where, so we provide the leads correctly to them." Everything below is in
// service of that, and of its consequence: an OPEN DutySession is what makes
// a telecaller eligible to receive a lead, so an empty board means incoming
// leads land unassigned. That sentence is on the screen, not in a doc,
// because it is the only reason anyone would clock in.
//
// There is no call counter here. The "rotate every 15 calls" idea the
// requirement started from does not survive contact with the floor — one
// telecaller takes twenty, the next thirty — so the board shows PRESENCE and
// LOAD (open leads owned, calls logged today) and lets the router in
// lib/duty.ts even the load out. Calls today is shown as context for whether
// a shift is actually being worked, never as a rotation threshold.

/** "9:40 am" — the clock time a shift started, which the duration alone can't say. */
function clockTime(d: Date) {
  return d
    .toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true })
    .toLowerCase();
}

export default async function DutyPage() {
  const session = await requireArea("leads");
  const now = new Date();
  const dayStart = startOfDay(now);
  const viewerIsFullAccess = isFullAccess(session.role);

  const [onDuty, allUsers, openCounts, callsToday, lastEnded, lastOwnSession, closedToday, unassignedOpen] =
    await Promise.all([
      listOnDuty(),
      prisma.user.findMany({
        where: { active: true },
        orderBy: [{ name: "asc" }],
        select: { id: true, name: true, role: true, permissions: true },
      }),
      prisma.lead.groupBy({
        by: ["ownerUserId"],
        where: { status: "open", ownerUserId: { not: null } },
        _count: { _all: true },
      }),
      // Calls LOGGED today, per person: LeadActivity rows of kind "call".
      // Scoped to today's local midnight so the number resets with the shift
      // pattern rather than on a rolling 24h window.
      prisma.leadActivity.groupBy({
        by: ["userId"],
        where: { kind: "call", userId: { not: null }, createdAt: { gte: dayStart } },
        _count: { _all: true },
      }),
      // When each person last clocked OUT — the only thing worth saying about
      // somebody who is off duty right now.
      prisma.dutySession.groupBy({
        by: ["userId"],
        where: { endedAt: { not: null } },
        _max: { endedAt: true },
      }),
      // Pre-fill for the viewer's own "from where": almost always the same
      // place as last time, so the common case is a single click.
      prisma.dutySession.findFirst({
        where: { userId: session.userId },
        orderBy: { startedAt: "desc" },
        select: { location: true },
      }),
      // Today's finished shifts, start-ordered, so a GAP in coverage reads
      // off the list directly — the reason closing a shift sets endedAt
      // instead of deleting the row.
      prisma.dutySession.findMany({
        where: { endedAt: { not: null }, startedAt: { gte: dayStart } },
        orderBy: [{ startedAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          startedAt: true,
          endedAt: true,
          location: true,
          user: { select: { id: true, name: true } },
        },
      }),
      prisma.lead.count({ where: { status: "open", ownerUserId: null } }),
    ]);

  const load = new Map<string, number>();
  for (const row of openCounts) if (row.ownerUserId) load.set(row.ownerUserId, row._count._all);
  const calls = new Map<string, number>();
  for (const row of callsToday) if (row.userId) calls.set(row.userId, row._count._all);
  const endedAtByUser = new Map<string, Date>();
  for (const row of lastEnded) {
    if (row.userId && row._max.endedAt) endedAtByUser.set(row.userId, row._max.endedAt);
  }

  const onDutyIds = new Set(onDuty.map((s) => s.userId));
  // The pool the board is about: everyone who could take a lead. `can`
  // rather than a role check, because the `leads` area is what routing
  // actually tests — an owner covering the phones belongs on this board, and
  // a storekeeper does not, whatever their job title says.
  const phoneUsers = allUsers.filter((u) => can(u, "leads"));
  const offDuty = phoneUsers.filter((u) => !onDutyIds.has(u.id));

  const mySession = onDuty.find((s) => s.userId === session.userId) ?? null;
  const callsTodayTotal = [...calls.values()].reduce((a, b) => a + b, 0);

  return (
    <>
      <PageHeader
        title="Duty board"
        sub="Who is on the phone right now, since when and from where — and who the next lead goes to"
        back="/leads"
        right={
          <Link
            href="/leads"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-[12px] font-semibold text-ink hover:border-slate-400"
          >
            <Icon.Phone size={14} /> Leads
          </Link>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <StatCard
          label="On duty"
          value={formatNumber(onDuty.length)}
          sub={onDuty.length === 0 ? "Nobody is taking leads" : "Eligible for new leads"}
          tone={onDuty.length > 0 ? "success" : "red"}
        />
        <StatCard label="Off duty" value={formatNumber(offDuty.length)} sub="Of the phone team" />
        <StatCard
          label="Calls logged today"
          value={formatNumber(callsTodayTotal)}
          sub="Across everyone"
          tone="ink"
        />
        <StatCard
          label="Unassigned open leads"
          value={formatNumber(unassignedOpen)}
          sub={onDuty.length === 0 ? "Nothing can be routed" : "Waiting for the next sweep"}
          tone={unassignedOpen > 0 && onDuty.length === 0 ? "red" : "default"}
        />
      </div>

      {/* My shift. First on the page: it is the only control most people who
          open this screen are here to press. */}
      <Card className="mb-5">
        <div className="text-base font-bold text-ink mb-3">My shift</div>
        <ShiftControl
          lastLocation={lastOwnSession?.location ?? ""}
          open={
            mySession
              ? {
                  startedAt: mySession.startedAt.getTime(),
                  startedLabel: clockTime(mySession.startedAt),
                  durationLabel: dutyDurationLabel(mySession.startedAt, now),
                  location: mySession.location,
                  note: mySession.note,
                }
              : null
          }
        />
      </Card>

      <div className="mb-2 flex items-center justify-between">
        <div>
          <div className="text-base font-bold text-ink">On duty now</div>
          <div className="text-[11px] text-slate-500">
            Longest on duty first — the same order the router reads
          </div>
        </div>
        {onDuty.length > 0 && <Pill tone="success">{onDuty.length} on the phones</Pill>}
      </div>

      {onDuty.length === 0 ? (
        /* The consequence, stated plainly. This is the entire point of the
           board: an empty duty list is not a cosmetic gap, it is intake
           silently piling up with no owner. */
        <EmptyState
          title="Nobody is on duty"
          sub="Incoming leads will be left UNASSIGNED until someone starts a shift — the auto-assign sweep only hands leads to people with an open duty session, and it will not guess. Start your shift above, and the leads waiting in the queue get an owner on the next sweep."
          action={
            <Link
              href="/leads?owner=unassigned"
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-[13px] font-semibold text-ink hover:border-slate-400"
            >
              See the {formatNumber(unassignedOpen)} unassigned leads
            </Link>
          }
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {onDuty.map((s) => {
            const owned = load.get(s.userId) ?? 0;
            const made = calls.get(s.userId) ?? 0;
            return (
              <Card key={s.id}>
                <div className="flex items-start gap-3">
                  <Avatar name={s.user.name} size={44} />
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[15px] font-bold text-ink truncate">{s.user.name}</span>
                      <Pill tone="slate">{roleLabel(s.user.role)}</Pill>
                      {/* A deactivated account with a shift still open is a
                          stale row, not a person answering the phone — and
                          routing already skips them, so say so here. */}
                      {!s.user.active && <Pill tone="danger">Deactivated</Pill>}
                    </div>

                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-slate-600">
                      <span className="inline-flex items-center gap-1">
                        <Icon.Clock size={13} color="#64748B" />
                        Since <span className="font-semibold text-ink">{clockTime(s.startedAt)}</span>
                        <span className="text-slate-400">·</span>
                        <LiveDuration
                          startedAt={s.startedAt.getTime()}
                          initial={dutyDurationLabel(s.startedAt, now)}
                          className="font-semibold text-ink num"
                        />
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Icon.Building size={13} color="#64748B" />
                        {s.location ? (
                          <span className="font-semibold text-ink">{s.location}</span>
                        ) : (
                          <span className="text-amber-700">Location not given</span>
                        )}
                      </span>
                    </div>

                    {s.note && <div className="text-[12px] text-slate-500 mt-1.5">{s.note}</div>}

                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      <Pill tone={owned === 0 ? "blue" : "slate"}>
                        {formatNumber(owned)} open {owned === 1 ? "lead" : "leads"} owned
                      </Pill>
                      <Pill tone="slate">
                        {formatNumber(made)} {made === 1 ? "call" : "calls"} logged today
                      </Pill>
                      {owned === 0 && <Pill tone="success">Next in line</Pill>}
                    </div>
                  </div>

                  {/* Everyone controls their own shift from "My shift" above.
                      Only owner/admin/manager may close another person's. */}
                  {viewerIsFullAccess && s.userId !== session.userId && (
                    <EndShiftForButton userId={s.userId} name={s.user.name} />
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Off duty. Greyed on purpose — the contrast with the cards above is
          what makes "who is actually working" readable at a glance. */}
      <div className="mt-6 mb-2">
        <div className="text-base font-bold text-ink">Off duty</div>
        <div className="text-[11px] text-slate-500">
          Not eligible for new leads. They keep the leads they already own.
        </div>
      </div>

      {offDuty.length === 0 ? (
        <EmptyState title="Everyone on the phone team is on duty" />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {offDuty.map((u) => {
            const ended = endedAtByUser.get(u.id);
            const owned = load.get(u.id) ?? 0;
            return (
              <Card key={u.id} className="opacity-60">
                <div className="flex items-center gap-3">
                  <Avatar name={u.name} size={34} tone="#94A3B8" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-ink truncate">{u.name}</div>
                    <div className="text-[11px] text-slate-500">
                      {roleLabel(u.role)}
                      <span className="text-slate-300"> · </span>
                      {ended ? (
                        <>
                          Last shift ended {formatShortDate(ended)} at {clockTime(ended)}
                        </>
                      ) : (
                        "Has never clocked in"
                      )}
                    </div>
                  </div>
                  {owned > 0 && <Pill tone="slate">{formatNumber(owned)} open</Pill>}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Today's coverage. Closed shifts in start order, with their gaps
          visible: two shifts ending 11:20 and starting 2:05 is three hours
          where nobody answered, and that is only ever obvious as a list. */}
      <div className="mt-6 mb-2">
        <div className="text-base font-bold text-ink">Today&apos;s coverage</div>
        <div className="text-[11px] text-slate-500">
          Shifts already finished today — read the ends and starts for a gap
        </div>
      </div>

      {closedToday.length === 0 ? (
        <EmptyState
          title="No shift has finished today"
          sub="Closed shifts are kept rather than deleted, so the day's coverage can be reconstructed afterwards."
        />
      ) : (
        <div className="bg-white rounded-2xl border border-slate-900/[.06] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-left">
                  <Th>Who</Th>
                  <Th>Started</Th>
                  <Th>Ended</Th>
                  <Th align="right">Duration</Th>
                  <Th>From where</Th>
                </tr>
              </thead>
              <tbody>
                {closedToday.map((s) => (
                  <tr key={s.id} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50">
                    <Td>
                      <div className="flex items-center gap-2">
                        <Avatar name={s.user.name} size={24} />
                        <span className="font-semibold">{s.user.name}</span>
                      </div>
                    </Td>
                    <Td className="num">{clockTime(s.startedAt)}</Td>
                    <Td className="num">{s.endedAt ? clockTime(s.endedAt) : "-"}</Td>
                    <Td align="right" className="num">
                      {s.endedAt ? dutyDurationLabel(s.startedAt, s.endedAt) : "-"}
                    </Td>
                    <Td className="text-slate-600">
                      {s.location || <span className="text-slate-400">-</span>}
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
