import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { requireAdminOrManager } from "@/lib/auth";
import { listArchives, liveRowCounts } from "@/lib/archive";
import { ArchiveConsole } from "./console";

export default async function ArchivePage() {
  const session = await requireAdminOrManager();
  const [live, batches, settings] = await Promise.all([
    liveRowCounts(),
    listArchives(),
    prisma.settings.findFirst({ select: { factoryName: true } }),
  ]);

  const factoryName = settings?.factoryName?.trim() || "RD Interlock Bricks";

  return (
    <>
      <PageHeader
        title="Hide data & backups"
        sub="Clear the books for a fresh start - nothing is deleted, every backup can be brought back"
      />
      <ArchiveConsole
        role={session.role}
        factoryName={factoryName}
        live={live}
        batches={batches.map((b) => ({
          id: b.id,
          label: b.label,
          createdAt: b.createdAt.toISOString(),
          createdBy: b.createdBy,
          totalRows: b.totalRows,
          rowCounts: b.rowCounts,
          restoredAt: b.restoredAt ? b.restoredAt.toISOString() : null,
          restoredBy: b.restoredBy,
        }))}
      />
    </>
  );
}
