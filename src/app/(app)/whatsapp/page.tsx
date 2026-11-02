import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireArea } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { Card, EmptyState, PageHeader, Pill, StatCard } from "@/components/ui";
import { Icon } from "@/components/icons";
import { formatNumber } from "@/lib/format";

const statusTone: Record<string, "success" | "danger" | "blue" | "slate" | "warning"> = {
  sent: "blue",
  delivered: "success",
  read: "success",
  failed: "danger",
  queued: "slate",
  received: "slate",
};

export default async function WhatsAppDashboardPage() {
  const session = await requireArea("whatsapp");

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [sentToday, failedToday, activeEnrollments, optOuts, recent] = await Promise.all([
    prisma.waMessage.count({ where: { direction: "out", createdAt: { gte: startOfDay }, status: { not: "failed" } } }),
    prisma.waMessage.count({ where: { direction: "out", createdAt: { gte: startOfDay }, status: "failed" } }),
    prisma.waEnrollment.count({ where: { status: "active" } }),
    prisma.lead.count({ where: { whatsappOptOut: true } }),
    prisma.waMessage.findMany({
      orderBy: { createdAt: "desc" },
      take: 40,
      include: { lead: { select: { id: true, customerName: true, phoneNumber: true, phoneMasked: true } }, template: true },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="WhatsApp"
        sub="Delivery & failure dashboard"
        right={
          isAdmin(session.role) ? (
            <div className="flex gap-2">
              <Link
                href="/whatsapp/templates"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-[13px] font-semibold text-ink hover:border-slate-400"
              >
                Templates
              </Link>
              <Link
                href="/whatsapp/sequences"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-[13px] font-semibold text-ink hover:border-slate-400"
              >
                Sequences
              </Link>
            </div>
          ) : undefined
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatCard label="Sent today" value={formatNumber(sentToday)} tone="ink" />
        <StatCard
          label="Failed today"
          value={formatNumber(failedToday)}
          tone={failedToday > 0 ? "red" : "default"}
        />
        <StatCard label="Active enrollments" value={formatNumber(activeEnrollments)} tone="blue" />
        <StatCard label="Opted out" value={formatNumber(optOuts)} />
      </div>

      {recent.length === 0 ? (
        <EmptyState
          title="No WhatsApp activity yet"
          sub="Messages appear here once a lead is enrolled in a sequence and the cron tick starts sending."
        />
      ) : (
        <div className="space-y-2">
          {recent.map((m) => {
            const failed = m.status === "failed";
            const apiResponse = m.apiResponse as unknown;
            return (
              <Card key={m.id} padding="tight">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {m.lead ? (
                        <Link href={`/leads/${m.lead.id}`} className="font-semibold text-ink hover:underline text-[13px]">
                          {m.lead.customerName || m.lead.phoneNumber || m.lead.phoneMasked || "Lead"}
                        </Link>
                      ) : (
                        <span className="text-[13px] text-slate-400">Unknown lead</span>
                      )}
                      <Pill tone={m.direction === "out" ? "blue" : "slate"}>
                        {m.direction === "out" ? "Sent" : "Received"}
                      </Pill>
                      <Pill tone={statusTone[m.status] ?? "slate"}>{m.status}</Pill>
                      {m.template && <span className="text-[11px] text-slate-500 mono">{m.template.name}</span>}
                    </div>
                    {m.body && (
                      <div className="text-[12px] text-slate-600 mt-1 truncate">{m.body}</div>
                    )}
                    {failed && apiResponse ? (
                      <pre className="text-[10px] text-red-700 bg-red-50 rounded-lg p-2 mt-1.5 overflow-x-auto">
                        {JSON.stringify(apiResponse, null, 2)}
                      </pre>
                    ) : null}
                  </div>
                  <div className="text-[11px] text-slate-400 whitespace-nowrap flex-shrink-0">
                    <Icon.Clock size={12} className="inline -mt-0.5 mr-1" />
                    {m.createdAt.toLocaleString("en-IN")}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
