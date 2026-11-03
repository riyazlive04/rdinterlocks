import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { canViewTask } from "@/lib/roles";
import { isInlineSafe, safeFileName } from "@/lib/task-attachments";

/**
 * Serve a task attachment.
 *
 * ─── Why a route handler and not a server action ──────────────────────
 * A browser has to be able to follow a plain link to a file, and an action
 * cannot produce a response with headers. This is the same shape as
 * api/quote/[id]/pdf.
 *
 * ─── Authorization ────────────────────────────────────────────────────
 * The id is a cuid, which is unguessable but NOT a permission. The security
 * review on this branch found exactly this mistake twice — /api/export had no
 * area check, and the quotation PDF was open to any quoteReview holder
 * unscoped — so the check here is the same one the task screen uses:
 * canViewTask, against the assignee's role read from the database. A
 * telecaller cannot fetch the photo attached to another telecaller's task
 * just by holding its id.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const file = await prisma.taskAttachment.findUnique({
    where: { id },
    include: {
      task: {
        select: {
          assignedToId: true,
          createdById: true,
          assignedTo: { select: { role: true } },
        },
      },
    },
  });

  // 404 for both "no such file" and "not yours", so the response cannot be
  // used to discover which attachment ids exist.
  if (!file) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const allowed = canViewTask(
    { userId: session.userId, role: session.role },
    {
      assignedToId: file.task.assignedToId,
      createdById: file.task.createdById,
      assigneeRole: file.task.assignedTo.role,
    }
  ).allowed;
  if (!allowed) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  // Re-sanitised at serve time, not trusted from the row: this value goes
  // into a header, and a name stored before the sanitiser existed (or by
  // anything else writing the table) would otherwise ride straight into it.
  const name = safeFileName(file.name) || "attachment";

  // Only images and PDFs are ever shown inline. Everything else is forced as
  // a download, so a file whose bytes contain markup cannot execute in this
  // app's origin even if its declared type was wrong.
  const disposition = isInlineSafe(file.mimeType) ? "inline" : "attachment";

  return new NextResponse(new Uint8Array(file.data), {
    status: 200,
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(file.byteSize),
      "Content-Disposition": `${disposition}; filename="${name}"`,
      // Belt and braces for the inline case: no sniffing past the declared
      // type, and no embedding this response in another site's page.
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; object-src 'none'",
      // Private: a signed-in user's file must not sit in a shared cache.
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
}
