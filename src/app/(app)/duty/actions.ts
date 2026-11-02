"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireArea } from "@/lib/auth";
import { isFullAccess } from "@/lib/roles";
import { endDuty, startDuty } from "@/lib/duty";

// Clocking on and off the phones. Thin wrappers: every rule that matters
// (one open session per user, closing a crashed one first) lives in
// lib/duty.ts so the scheduler and the UI cannot drift apart.

const shiftSchema = z.object({
  // Free text by design — see DutySession.location in prisma/schema.prisma:
  // the factory adds desks and branches faster than a migration would ship.
  // Capped only so a paste accident cannot fill the board with a paragraph.
  location: z.string().max(80).default(""),
  note: z.string().max(200).default(""),
});

/**
 * Start the caller's own shift.
 *
 * Gated on `leads`, not on a role: ANYONE who works the phones clocks
 * themselves in, which is the only version of this that gets used. A
 * telecaller who had to ask the owner to mark them present would simply not
 * be marked present, and the board would then route leads to nobody.
 */
export async function startShift(location: string, note = "") {
  const s = await requireArea("leads");
  const p = shiftSchema.parse({ location, note });
  await startDuty(s.userId, p.location, p.note);
  revalidatePath("/duty");
}

/** End the caller's own shift. A no-op when they were already off duty. */
export async function endShift() {
  const s = await requireArea("leads");
  await endDuty(s.userId);
  revalidatePath("/duty");
}

/**
 * End somebody else's shift — the telecaller who went home at six without
 * clocking out and is still shown as covering the phones at midnight.
 *
 * isFullAccess only (owner/admin/manager). This is the one duty action that
 * is not self-service, because it rewrites another person's record of when
 * they were working; a peer must not be able to do it. Throws rather than
 * redirecting so the inline error lands next to the button that was pressed.
 */
export async function endShiftFor(userId: string) {
  const s = await requireArea("leads");
  if (!isFullAccess(s.role)) {
    throw new Error("Only the owner or a manager can end someone else's shift.");
  }
  await endDuty(userId);
  revalidatePath("/duty");
}
