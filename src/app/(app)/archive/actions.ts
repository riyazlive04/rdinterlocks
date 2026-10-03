"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdminOrManager } from "@/lib/auth";
import { createArchive, restoreArchive } from "@/lib/archive";

// Typing the factory name is the guard against an accidental press — both the
// manager and the owner can hide the books, so the confirmation is the only
// thing standing between a stray tap and an empty-looking app.
const hideSchema = z.object({
  label: z.string().max(120).default(""),
  confirm: z.string(),
  expected: z.string(),
});

export async function hideAllData(input: z.infer<typeof hideSchema>) {
  const session = await requireAdminOrManager();
  const p = hideSchema.parse(input);

  if (p.confirm.trim().toLowerCase() !== p.expected.trim().toLowerCase()) {
    throw new Error(`Type "${p.expected}" exactly to confirm.`);
  }

  const result = await createArchive(p.label, session.name);

  // Everything is empty now, so every cached screen is stale.
  revalidatePath("/", "layout");
  return result;
}

const restoreSchema = z.object({ id: z.string().min(1) });

export async function bringBackData(input: z.infer<typeof restoreSchema>) {
  const session = await requireAdminOrManager();
  const p = restoreSchema.parse(input);

  const result = await restoreArchive(p.id, session.name);

  revalidatePath("/", "layout");
  return result;
}
