import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { PageHeader, Card } from "@/components/ui";
import { AutomationForm } from "./form";
import { updateAutomationSettings } from "../actions";

export default async function AutomationSettingsPage() {
  await requireAdmin();
  const [s, stages] = await Promise.all([
    prisma.settings.findUnique({ where: { id: "default" } }),
    // The trigger stage is picked from the real pipeline stages, never typed:
    // a slug that matches no stage turns the whole sweep into a silent no-op.
    // Inactive stages are listed too (and marked), because the saved setting
    // may already point at one.
    prisma.leadStage.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { slug: true, name: true, isActive: true },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Automation"
        sub="Review gate, auto-drafted quotations, lead assignment and quotation expiry"
        back="/settings"
      />
      <Card className="mb-4 border-amber-200 bg-amber-50">
        <div className="text-[12.5px] text-ink leading-relaxed">
          These settings are acted on by a <span className="font-semibold">scheduled sweep</span>,
          not by the app itself — this factory does not run on Vercel, so the schedule is Windows
          Task Scheduler (or a crontab on the VPS) calling{" "}
          <code className="text-[11.5px] bg-white border border-amber-200 rounded px-1 py-0.5">
            node scripts/run-sweep.mjs
          </code>
          . If that is not set up, or <code className="text-[11.5px]">CRON_API_KEY</code> is not in{" "}
          <code className="text-[11.5px]">.env</code>, nothing below will ever run no matter what is
          switched on here.
        </div>
      </Card>
      <AutomationForm
        initial={{
          quoteReviewRequired: s?.quoteReviewRequired ?? false,
          quoteReviewByOwner: s?.quoteReviewByOwner ?? true,
          autoQuoteEnabled: s?.autoQuoteEnabled ?? false,
          autoQuoteOnStage: s?.autoQuoteOnStage ?? "qualified",
          autoQuoteRequiresZone: s?.autoQuoteRequiresZone ?? true,
          leadAutoAssign: s?.leadAutoAssign ?? false,
          quoteExpiryDays: s?.quoteExpiryDays ?? 0,
          stockAllocationEnforced: s?.stockAllocationEnforced ?? false,
        }}
        stages={stages}
        onSave={async (data) => {
          "use server";
          await updateAutomationSettings(data);
        }}
      />
    </>
  );
}
