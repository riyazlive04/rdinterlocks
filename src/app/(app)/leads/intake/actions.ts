"use server";

import { revalidatePath } from "next/cache";
import { requireArea } from "@/lib/auth";
import { replayDelivery, type ReplayResult } from "@/lib/lead-webhook-replay";

// The one write the intake screen can make. Everything else on that page is a
// read of the delivery log; replaying is the only operator action, and it is
// gated on the same area as seeing the log at all.

export async function replayDeliveryAction(id: string): Promise<ReplayResult> {
  const session = await requireArea("leadIntake");
  // Who replayed it is recorded on the LeadImport audit row as
  // `replay:<name>`, so a lead that appeared hours after its delivery is
  // traceable to the person who re-ran it rather than looking like the
  // provider sent it twice.
  const result = await replayDelivery(id, session.name);
  revalidatePath("/leads/intake");
  return result;
}
