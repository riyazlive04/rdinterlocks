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

// The assignee (or an admin) flips a task done / open.
export async function setTaskStatus(id: string, done: boolean) {
  const session = await requireSession();
  const task = await prisma.task.findUnique({ where: { id } });
  if (!task) throw new Error("Task not found");
  if (!isAdmin(session.role) && task.assignedToId !== session.userId) {
    throw new Error("You can only update your own tasks");
  }
  await prisma.task.update({
    where: { id },
    data: {
      status: done ? "done" : "open",
      completedAt: done ? new Date() : null,
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
