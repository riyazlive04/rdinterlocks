"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin, requireSession } from "@/lib/auth";
import { isAdmin } from "@/lib/access";

const createSchema = z.object({
  title: z.string().min(1),
  details: z.string().optional(),
  assignedToId: z.string().min(1),
  dueDate: z.string().optional(),
});

// Only the admin/owner assigns tasks.
export async function createTask(input: z.infer<typeof createSchema>) {
  const session = await requireAdmin();
  const p = createSchema.parse(input);
  const assignee = await prisma.user.findUnique({ where: { id: p.assignedToId } });
  if (!assignee) throw new Error("Pick who to assign the task to");
  await prisma.task.create({
    data: {
      title: p.title.trim(),
      details: p.details?.trim() || null,
      assignedToId: p.assignedToId,
      createdById: session.userId,
      dueDate: p.dueDate ? new Date(p.dueDate) : null,
    },
  });
  revalidatePath("/tasks");
}

// The assignee (or an admin) says where the task stands: work in progress,
// completed, or not completed. "Not completed" has to say why — that reason is
// the whole point of the status, so it is enforced here and not just in the UI.
const TASK_STATUSES = ["wip", "done", "not_done"];

export async function setTaskStatus(id: string, status: string, reason?: string) {
  const session = await requireSession();
  if (!TASK_STATUSES.includes(status)) throw new Error("Unknown status");
  const task = await prisma.task.findUnique({ where: { id } });
  if (!task) throw new Error("Task not found");
  if (!isAdmin(session.role) && task.assignedToId !== session.userId) {
    throw new Error("You can only update your own tasks");
  }
  const trimmed = reason?.trim() || "";
  if (status === "not_done" && !trimmed) {
    throw new Error("Say why it wasn't completed");
  }
  await prisma.task.update({
    where: { id },
    data: {
      status,
      statusReason: status === "not_done" ? trimmed : null,
      completedAt: status === "wip" ? null : new Date(),
    },
  });
  revalidatePath("/tasks");
}

// Only the admin removes a task.
export async function deleteTask(id: string) {
  await requireAdmin();
  await prisma.task.delete({ where: { id } });
  revalidatePath("/tasks");
}
