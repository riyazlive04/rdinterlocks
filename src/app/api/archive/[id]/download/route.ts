import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { getArchiveFile } from "@/lib/archive";

// Download a backup as a JSON file, so the factory keeps a copy outside the
// app. Same audience as the archive console: owner/admin or manager.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || (!isAdmin(session.role) && session.role !== "manager")) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  const { id } = await params;
  const batch = await getArchiveFile(id);
  if (!batch) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const stamp = batch.createdAt.toISOString().slice(0, 10);
  const slug = (batch.label || "backup").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");

  const body = JSON.stringify(
    {
      archivedAt: batch.createdAt,
      archivedBy: batch.createdBy,
      label: batch.label,
      totalRows: batch.totalRows,
      data: JSON.parse(batch.payload),
    },
    null,
    2
  );

  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="rd-${slug}-${stamp}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
