import { prisma } from "@/lib/db";
import { Card, PageHeader } from "@/components/ui";
import { formatINR, formatNumber } from "@/lib/format";
import { requireArea } from "@/lib/auth";
import { DieView, type DieRow } from "./die-view";
import { createDie, flipDie, retireDie, deleteDie } from "./actions";

// How many bricks a die face pressed = everything produced between the day it
// went in and the day it came off (still running = up to now). A die tied to a
// brick size only counts that size's production.
function bricksBetween(
  entries: Array<{ date: Date; brickCount: number; brickSizeId: string }>,
  from: Date,
  to: Date | null,
  brickSizeId: string | null
) {
  const end = to ?? new Date();
  return entries
    .filter(
      (e) =>
        e.date >= from && e.date <= end && (!brickSizeId || e.brickSizeId === brickSizeId)
    )
    .reduce((s, e) => s + e.brickCount, 0);
}

export default async function DiePage() {
  await requireArea("die");

  const [dies, sizes, vendors, entries] = await Promise.all([
    prisma.die.findMany({
      include: { brickSize: true, vendor: true, usages: { orderBy: { side: "asc" } } },
      orderBy: { purchasedAt: "desc" },
    }),
    prisma.brickSize.findMany({ orderBy: { order: "asc" } }),
    prisma.vendor.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.productionEntry.findMany({
      select: { date: true, brickCount: true, brickSizeId: true },
    }),
  ]);

  const rows: DieRow[] = dies.map((d) => {
    const sides = d.usages.map((u) => ({
      usageId: u.id,
      side: u.side,
      startedAt: u.startedAt.toISOString(),
      endedAt: u.endedAt ? u.endedAt.toISOString() : null,
      bricks: bricksBetween(entries, u.startedAt, u.endedAt, d.brickSizeId),
    }));
    const open = d.usages.find((u) => !u.endedAt);
    return {
      id: d.id,
      code: d.code,
      brickSize: d.brickSize?.label ?? "-",
      vendor: d.vendor?.name ?? "-",
      cost: d.cost,
      purchasedAt: d.purchasedAt.toISOString(),
      notes: d.notes ?? "",
      sides,
      bricks: sides.reduce((s, x) => s + x.bricks, 0),
      live: !!open,
      currentSide: open?.side ?? null,
      canFlip: !!open && open.side === 1 && !d.usages.some((u) => u.side === 2),
    };
  });

  const sidesUsed = rows.reduce((s, d) => s + d.sides.length, 0);
  const totalCost = rows.reduce((s, d) => s + d.cost, 0);
  const totalBricks = rows.reduce((s, d) => s + d.bricks, 0);

  return (
    <>
      <PageHeader
        title="Dies (moulds)"
        sub="Every die, both its sides, and what each one cost per brick"
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <Card padding="tight">
          <Label>Dies bought</Label>
          <div className="num display text-xl font-bold mt-0.5">{rows.length}</div>
        </Card>
        <Card padding="tight">
          <Label>Sides used</Label>
          <div className="num display text-xl font-bold mt-0.5">{sidesUsed}</div>
        </Card>
        <Card padding="tight">
          <Label>Die expense</Label>
          <div className="num display text-xl font-bold mt-0.5 text-brand-red">
            {formatINR(totalCost)}
          </div>
        </Card>
        <Card padding="tight">
          <Label>Bricks pressed</Label>
          <div className="num display text-xl font-bold mt-0.5">{formatNumber(totalBricks)}</div>
        </Card>
      </div>

      <DieView
        dies={rows}
        sizes={sizes.map((s) => ({ id: s.id, label: s.label }))}
        vendors={vendors.map((v) => ({ id: v.id, label: v.name }))}
        onCreate={async (d) => {
          "use server";
          await createDie(d);
        }}
        onFlip={async (id, date) => {
          "use server";
          await flipDie(id, date);
        }}
        onRetire={async (id, date) => {
          "use server";
          await retireDie(id, date);
        }}
        onDelete={async (id) => {
          "use server";
          await deleteDie(id);
        }}
      />
    </>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
      {children}
    </div>
  );
}
