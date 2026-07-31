import Link from "next/link";
import { prisma } from "@/lib/db";
import { Avatar, Card, PageHeader, Pill, EmptyState } from "@/components/ui";
import { Icon } from "@/components/icons";
import { formatINR } from "@/lib/format";
import { ORDER_STATUSES } from "@/lib/order-status";
import { Pagination } from "@/components/pagination";

const PAGE_SIZE = 50;

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; status?: string }>;
}) {
  const sp = await searchParams;
  const q = sp?.q?.trim() ?? "";
  const status = ORDER_STATUSES.some((s) => s.key === sp?.status) ? sp!.status! : "";

  const all = await prisma.client.findMany({
    where: {
      active: true,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { location: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: {
      payments: true,
      orders: {
        include: { items: true, slabItems: true, payments: true, deliveries: { include: { items: true } } },
      },
    },
    orderBy: { name: "asc" },
  });

  // Status chips filter the customer list down to whoever has an order sitting
  // in that state right now — the same three states as the register.
  const counts = {
    upcoming: all.filter((c) => c.orders.some((o) => o.status === "upcoming")).length,
    active: all.filter((c) => c.orders.some((o) => o.status === "active")).length,
    completed: all.filter((c) => c.orders.some((o) => o.status === "completed")).length,
  };
  const clients = status
    ? all.filter((c) => c.orders.some((o) => o.status === status))
    : all;

  const page = Math.max(1, Number(sp?.page) || 1);
  const totalPages = Math.max(1, Math.ceil(clients.length / PAGE_SIZE));
  const pageClients = clients.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const statusHref = (s?: string) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    if (s) u.set("status", s);
    return `/clients${u.toString() ? `?${u.toString()}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="Clients & Sales"
        sub="Customers + their orders, deliveries, payments"
        right={
          <div className="flex gap-2">
            <Link
              href="/clients/register"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-ink text-white text-[13px] font-semibold"
            >
              <Icon.Receipt size={16} stroke={2.2} /> Register
            </Link>
            <Link
              href="/clients/new"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-brand-red text-white text-[13px] font-semibold shadow-red"
            >
              <Icon.Plus size={16} stroke={2.4} /> Add client
            </Link>
          </div>
        }
      />

      <div className="flex flex-wrap gap-1.5 mb-3">
        <Link
          href={statusHref(undefined)}
          className={`px-3 py-1.5 rounded-full text-[12px] font-semibold ${
            !status ? "bg-ink text-white" : "bg-white text-slate-700 border border-slate-200"
          }`}
        >
          All
        </Link>
        {ORDER_STATUSES.map((s) => (
          <Link
            key={s.key}
            href={statusHref(s.key)}
            className={`px-3 py-1.5 rounded-full text-[12px] font-semibold ${
              status === s.key
                ? "bg-ink text-white"
                : "bg-white text-slate-700 border border-slate-200"
            }`}
          >
            {s.label}
            <span className="opacity-60 ml-1.5 num">{counts[s.key as keyof typeof counts]}</span>
          </Link>
        ))}
      </div>

      <form className="mb-4" method="get">
        {status && <input type="hidden" name="status" value={status} />}
        <div className="relative">
          <Icon.Search
            size={16}
            color="#94A3B8"
            className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
          />
          <input
            name="q"
            defaultValue={q}
            placeholder="Search clients by name or location…"
            className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-white border border-slate-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-brand-red/30"
          />
        </div>
      </form>

      {clients.length === 0 ? (
        <EmptyState
          title={q ? `No clients matching "${q}"` : "No clients yet"}
          sub="Add a client to start tracking orders and payments."
          action={
            <Link
              href="/clients/new"
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-brand-red text-white text-[13px] font-semibold"
            >
              <Icon.Plus size={16} /> Add client
            </Link>
          }
        />
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {pageClients.map((c) => {
            const ordered = c.orders.reduce(
              (s, o) =>
                s +
                o.items.reduce((x, i) => x + i.total, 0) +
                o.slabItems.reduce((x, i) => x + i.total, 0),
              0
            );
            const paid = c.orders.reduce(
              (s, o) => s + o.payments.reduce((x, p) => x + p.amount, 0),
              0
            );
            const due = Math.max(0, ordered - paid);
            const openOrders = c.orders.filter(
              (o) => o.status !== "completed" && o.status !== "cancelled"
            ).length;
            return (
              <Link
                key={c.id}
                href={`/clients/${c.id}`}
                className="bg-white rounded-2xl p-4 border border-slate-200 hover:border-slate-400 transition flex items-center gap-3"
              >
                <Avatar name={c.name} size={42} tone="#0E2143" />
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-bold text-ink">{c.name}</div>
                  <div className="text-[11px] text-slate-500 truncate">
                    {c.location ?? "-"} {c.phone ? `· ${c.phone}` : ""}
                  </div>
                  <div className="flex gap-1.5 mt-1.5">
                    <Pill tone="slate">{c.orders.length} orders</Pill>
                    {openOrders > 0 && <Pill tone="blue">{openOrders} active</Pill>}
                    {due > 0 && <Pill tone="red">{formatINR(due, { compact: true })} due</Pill>}
                  </div>
                </div>
                <Icon.Chevron size={16} color="#94A3B8" />
              </Link>
            );
          })}
        </div>
      )}
      <Pagination page={page} totalPages={totalPages} />
    </>
  );
}
