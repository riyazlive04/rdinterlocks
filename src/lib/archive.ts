import { Prisma } from "@prisma/client";
import { prisma } from "./db";

/**
 * "Hide the data, keep it as a backup" — a full-snapshot archive.
 *
 * Taking an archive serialises every table into a single ArchiveBatch row and
 * then clears the live tables, so every screen in the app reads empty while
 * nothing is actually lost. Restoring re-inserts the snapshot as it was.
 *
 * Three tables are never touched: User (otherwise nobody could log back in),
 * Settings (the app reads the singleton on every page) and ArchiveBatch itself
 * (that's where the backup lives). Settings.cashOpening IS zeroed, since a
 * stale opening balance against an empty cashbook would show phantom cash; the
 * old value travels in the snapshot and comes back on restore.
 *
 * The table list and the order to walk it in are derived from Prisma's DMMF
 * rather than hand-maintained, so new models are picked up automatically.
 */

const NEVER_ARCHIVED = new Set(["User", "Settings", "ArchiveBatch"]);

type ModelPlan = {
  name: string;
  delegate: string;
  /** Models this one holds a REQUIRED foreign key to — these fix insert order. */
  deps: string[];
  dateFields: string[];
  /** Nullable Json columns, which need Prisma.DbNull rather than null. */
  nullableJsonFields: string[];
  /**
   * Nullable foreign-key columns. Nulled on insert and patched in a second
   * pass, which is what lets self-references (Quotation.supersededById) and
   * mutual references (a cash entry and the row that owns it) restore without
   * needing a valid insert order between them.
   */
  softFks: string[];
};

let cachedPlans: ModelPlan[] | null = null;

function buildPlans(): ModelPlan[] {
  if (cachedPlans) return cachedPlans;

  const plans: ModelPlan[] = Prisma.dmmf.datamodel.models
    .filter((m) => !NEVER_ARCHIVED.has(m.name))
    .map((m) => {
      // Only the side of a relation that holds the FK columns constrains us.
      const owning = m.fields.filter(
        (f) => f.kind === "object" && (f.relationFromFields?.length ?? 0) > 0
      );

      const softFks: string[] = [];
      for (const f of owning) {
        for (const col of f.relationFromFields ?? []) {
          const scalar = m.fields.find((x) => x.name === col);
          if (scalar && !scalar.isRequired) softFks.push(col);
        }
      }

      return {
        name: m.name,
        delegate: m.name.charAt(0).toLowerCase() + m.name.slice(1),
        // Required FKs cannot form a cycle, so a topological sort over just
        // these is always well defined. Optional ones are handled by softFks.
        deps: owning
          .filter((f) => f.isRequired)
          .map((f) => f.type)
          .filter((t) => t !== m.name && !NEVER_ARCHIVED.has(t)),
        dateFields: m.fields.filter((f) => f.type === "DateTime").map((f) => f.name),
        nullableJsonFields: m.fields
          .filter((f) => f.type === "Json" && !f.isRequired)
          .map((f) => f.name),
        softFks,
      };
    });

  cachedPlans = topoSort(plans);
  return cachedPlans;
}

/** Parents first. Insert in this order, delete in reverse. */
function topoSort(plans: ModelPlan[]): ModelPlan[] {
  const byName = new Map(plans.map((p) => [p.name, p]));
  const settled = new Set<string>();
  const onPath = new Set<string>();
  const out: ModelPlan[] = [];

  const visit = (p: ModelPlan) => {
    if (settled.has(p.name) || onPath.has(p.name)) return;
    onPath.add(p.name);
    for (const d of p.deps) {
      const dep = byName.get(d);
      if (dep) visit(dep);
    }
    onPath.delete(p.name);
    settled.add(p.name);
    out.push(p);
  };

  for (const p of plans) visit(p);
  return out;
}

// Prisma's generated client has no index signature, so the generic walk over
// "every model" needs one narrow escape hatch.
type AnyDelegate = {
  findMany: (args?: unknown) => Promise<Record<string, unknown>[]>;
  createMany: (args: unknown) => Promise<{ count: number }>;
  deleteMany: (args?: unknown) => Promise<{ count: number }>;
  updateMany: (args: unknown) => Promise<{ count: number }>;
  update: (args: unknown) => Promise<unknown>;
  count: (args?: unknown) => Promise<number>;
};

function delegate(client: unknown, name: string): AnyDelegate {
  return (client as Record<string, AnyDelegate>)[name];
}

/** JSON round-trips dates to strings and loses Prisma's null-vs-DbNull split. */
function revive(plan: ModelPlan, key: string, value: unknown) {
  if (value === null) {
    return plan.nullableJsonFields.includes(key) ? Prisma.DbNull : null;
  }
  if (typeof value === "string" && plan.dateFields.includes(key)) return new Date(value);
  return value;
}

/**
 * The derived walk order, exposed so it can be asserted against the schema
 * (see scripts/check-archive-order.ts) rather than trusted blindly.
 */
export function archivePlan() {
  return buildPlans().map((p) => ({
    name: p.name,
    deps: p.deps,
    softFks: p.softFks,
    dateFields: p.dateFields,
  }));
}

export type ArchiveSummary = {
  id: string;
  label: string;
  createdAt: Date;
  createdBy: string;
  totalRows: number;
  rowCounts: Record<string, number>;
  restoredAt: Date | null;
  restoredBy: string | null;
};

function parseCounts(raw: string): Record<string, number> {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export async function listArchives(): Promise<ArchiveSummary[]> {
  const rows = await prisma.archiveBatch.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      label: true,
      createdAt: true,
      createdBy: true,
      totalRows: true,
      rowCounts: true,
      restoredAt: true,
      restoredBy: true,
    },
  });
  return rows.map((r) => ({ ...r, rowCounts: parseCounts(r.rowCounts) }));
}

/** How many live rows are sitting in the app right now, per table. */
export async function liveRowCounts(): Promise<{
  total: number;
  byModel: Record<string, number>;
}> {
  const plans = buildPlans();
  const byModel: Record<string, number> = {};
  let total = 0;
  for (const p of plans) {
    const n = await delegate(prisma, p.delegate).count();
    if (n > 0) {
      byModel[p.name] = n;
      total += n;
    }
  }
  return { total, byModel };
}

export async function createArchive(label: string, byName: string) {
  const plans = buildPlans();

  return prisma.$transaction(
    async (tx) => {
      const models: Record<string, Record<string, unknown>[]> = {};
      const rowCounts: Record<string, number> = {};
      let totalRows = 0;

      for (const p of plans) {
        const rows = await delegate(tx, p.delegate).findMany();
        if (rows.length === 0) continue;
        models[p.name] = rows;
        rowCounts[p.name] = rows.length;
        totalRows += rows.length;
      }

      if (totalRows === 0) throw new Error("There is no data to hide yet.");

      const settings = await tx.settings.findFirst({ select: { cashOpening: true } });

      const batch = await tx.archiveBatch.create({
        data: {
          label: label.trim(),
          createdBy: byName,
          totalRows,
          rowCounts: JSON.stringify(rowCounts),
          payload: JSON.stringify({ models, cashOpening: settings?.cashOpening ?? 0 }),
        },
        select: { id: true },
      });

      // Drop every optional link first so nothing blocks the deletes below —
      // a cash entry and the row that owns it point at each other.
      for (const p of plans) {
        if (p.softFks.length === 0) continue;
        const data: Record<string, null> = {};
        for (const col of p.softFks) data[col] = null;
        await delegate(tx, p.delegate).updateMany({ data });
      }

      // Children before parents.
      for (const p of [...plans].reverse()) {
        await delegate(tx, p.delegate).deleteMany({});
      }

      await tx.settings.updateMany({ data: { cashOpening: 0 } });

      return { id: batch.id, totalRows, rowCounts };
    },
    { timeout: 120_000, maxWait: 20_000 }
  );
}

export async function restoreArchive(id: string, byName: string) {
  const plans = buildPlans();

  const batch = await prisma.archiveBatch.findUnique({
    where: { id },
    select: { id: true, payload: true, totalRows: true },
  });
  if (!batch) throw new Error("That backup no longer exists.");

  const parsed = JSON.parse(batch.payload) as {
    models: Record<string, Record<string, unknown>[]>;
    cashOpening?: number;
  };

  return prisma.$transaction(
    async (tx) => {
      // Never merge a backup into live data — restoring on top would duplicate
      // everything. The app has to be empty first.
      for (const p of plans) {
        if ((await delegate(tx, p.delegate).count()) > 0) {
          throw new Error(
            "There is live data in the app. Hide the current data first, then bring this backup back."
          );
        }
      }

      // Pass 1: insert with optional links nulled, parents before children.
      for (const p of plans) {
        const rows = parsed.models[p.name];
        if (!rows?.length) continue;
        const data = rows.map((row) => {
          const out: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(row)) {
            out[key] = p.softFks.includes(key) ? null : revive(p, key, value);
          }
          return out;
        });
        await delegate(tx, p.delegate).createMany({ data });
      }

      // Pass 2: put the optional links back now that every row exists.
      for (const p of plans) {
        const rows = parsed.models[p.name];
        if (!rows?.length || p.softFks.length === 0) continue;
        for (const row of rows) {
          const patch: Record<string, unknown> = {};
          for (const col of p.softFks) {
            if (row[col] != null) patch[col] = row[col];
          }
          if (Object.keys(patch).length === 0) continue;
          await delegate(tx, p.delegate).update({ where: { id: row.id }, data: patch });
        }
      }

      if (typeof parsed.cashOpening === "number") {
        await tx.settings.updateMany({ data: { cashOpening: parsed.cashOpening } });
      }

      await tx.archiveBatch.update({
        where: { id },
        data: { restoredAt: new Date(), restoredBy: byName },
      });

      return { totalRows: batch.totalRows };
    },
    { timeout: 180_000, maxWait: 20_000 }
  );
}

/** The raw snapshot, for the "download a copy" route. */
export async function getArchiveFile(id: string) {
  const batch = await prisma.archiveBatch.findUnique({
    where: { id },
    select: { id: true, label: true, createdAt: true, createdBy: true, totalRows: true, payload: true },
  });
  if (!batch) return null;
  return batch;
}
