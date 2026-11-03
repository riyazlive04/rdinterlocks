import { prisma } from "@/lib/db";
import { Card, PageHeader, Pill, EmptyState } from "@/components/ui";
import { formatINR, formatShortDate, formatISODate, startOfDay } from "@/lib/format";
import { DateRangeFilter } from "@/components/date-range-filter";
import { requireArea } from "@/lib/auth";
import { VendorPaymentForm } from "./payment-form";
import { DeleteVendorPayment } from "./delete-payment";
import { createVendorPayment, deleteVendorPayment } from "./actions";

// The AVM page answers one question the office asks every week: for each rented
// tipper vendor, how much rent have we run up, how much have we handed over
// (advance + settlements), and what is still owed.
export default async function AvmPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requireArea("tipper");
  const sp = await searchParams;
  const today = startOfDay();
  const from = sp?.from ? new Date(sp.from) : new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);
  const to = sp?.to ? new Date(sp.to) : today;
  to.setHours(23, 59, 59, 999);
  const range = { gte: from, lte: to };

  const [vendors, tippers, loads, payments] = await Promise.all([
    prisma.vendor.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.tipper.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.tipperLoad.findMany({
      where: { date: range, rentDirection: "out" },
      include: { tipper: true, vendor: true },
      orderBy: { date: "desc" },
    }),
    prisma.vendorPayment.findMany({
      where: { date: range },
      include: { vendor: true, tipper: true },
      orderBy: { date: "desc" },
    }),
  ]);

  // Per vendor: rent charged by their trips vs money actually handed over.
  const summary = vendors
    .map((v) => {
      const charged = loads
        .filter((l) => l.vendorId === v.id)
        .reduce((s, l) => s + l.rentAmount, 0);
      const advance = payments
        .filter((p) => p.vendorId === v.id && p.kind === "advance")
        .reduce((s, p) => s + p.amount, 0);
      const settled = payments
        .filter((p) => p.vendorId === v.id && p.kind === "rent")
        .reduce((s, p) => s + p.amount, 0);
      const trips = loads.filter((l) => l.vendorId === v.id).length;
      return { vendor: v, charged, advance, settled, paid: advance + settled, trips };
    })
    .filter((s) => s.charged > 0 || s.paid > 0);

  const totals = summary.reduce(
    (t, s) => ({
      charged: t.charged + s.charged,
      advance: t.advance + s.advance,
      settled: t.settled + s.settled,
      paid: t.paid + s.paid,
    }),
    { charged: 0, advance: 0, settled: 0, paid: 0 }
  );
  const balance = totals.charged - totals.paid;

  return (
    <>
      <PageHeader
        title="AVM - advance & rent"
        sub="Rented tippers: what they charged, what we paid, what's left"
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <Card padding="tight">
          <Label>Rent charged</Label>
          <div className="num display text-xl font-bold mt-0.5">{formatINR(totals.charged)}</div>
        </Card>
        <Card padding="tight">
          <Label>Advance paid</Label>
          <div className="num display text-xl font-bold mt-0.5 text-brand-blue">
            {formatINR(totals.advance)}
          </div>
        </Card>
        <Card padding="tight">
          <Label>Balance settled</Label>
          <div className="num display text-xl font-bold mt-0.5 text-emerald-700">
            {formatINR(totals.settled)}
          </div>
        </Card>
        <Card padding="tight">
          <Label>{balance >= 0 ? "Still to pay" : "Paid ahead"}</Label>
          <div
            className={`num display text-xl font-bold mt-0.5 ${
              balance > 0 ? "text-brand-red" : "text-emerald-700"
            }`}
          >
            {formatINR(Math.abs(balance))}
          </div>
        </Card>
      </div>

      <DateRangeFilter from={formatISODate(from)} to={formatISODate(to)} />

      <div className="mb-4">
        {vendors.length === 0 ? (
          <Card>
            <div className="text-[13px] text-slate-500">
              No vendors yet.{" "}
              <a href="/settings/vendors" className="text-brand-blue underline">
                Add AVM
              </a>{" "}
              to start tracking advances.
            </div>
          </Card>
        ) : (
          <VendorPaymentForm
            vendors={vendors.map((v) => ({ id: v.id, label: v.name }))}
            tippers={tippers
              .filter((t) => t.ownership !== "own")
              .map((t) => ({ id: t.id, label: t.name, vendorId: t.vendorId }))}
            onSubmit={async (d) => {
              "use server";
              await createVendorPayment(d);
            }}
          />
        )}
      </div>

      {/* Per-vendor position */}
      {summary.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-900/[.06] overflow-hidden mb-5">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <Th>Vendor</Th>
                  <Th align="right">Trips</Th>
                  <Th align="right">Rent charged</Th>
                  <Th align="right">Advance</Th>
                  <Th align="right">Settled</Th>
                  <Th align="right">Balance due</Th>
                </tr>
              </thead>
              <tbody>
                {summary.map((s) => {
                  const due = s.charged - s.paid;
                  return (
                    <tr key={s.vendor.id} className="border-b border-slate-100 last:border-b-0">
                      <Td className="font-semibold text-ink">{s.vendor.name}</Td>
                      <Td align="right" className="num">
                        {s.trips}
                      </Td>
                      <Td align="right" className="num">
                        {formatINR(s.charged)}
                      </Td>
                      <Td align="right" className="num text-brand-blue">
                        {formatINR(s.advance)}
                      </Td>
                      <Td align="right" className="num text-emerald-700">
                        {formatINR(s.settled)}
                      </Td>
                      <Td
                        align="right"
                        className={`num font-bold ${
                          due > 0 ? "text-brand-red" : "text-emerald-700"
                        }`}
                      >
                        {due > 0 ? formatINR(due) : `+${formatINR(-due)}`}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Payment history */}
      <div className="text-[12px] font-bold uppercase tracking-wider text-ink mb-2">
        Payments to vendors
      </div>
      {payments.length === 0 ? (
        <EmptyState
          title="No advances or settlements yet"
          sub="Record what you hand over to AVM and the balance keeps itself."
        />
      ) : (
        <div className="bg-white rounded-2xl border border-slate-900/[.06] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <Th>Date</Th>
                  <Th>Vendor</Th>
                  <Th>Kind</Th>
                  <Th>Tipper</Th>
                  <Th>Method</Th>
                  <Th>Note</Th>
                  <Th align="right">Amount</Th>
                  <Th align="right"></Th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50">
                    <Td className="num text-[12px]">{formatShortDate(p.date)}</Td>
                    <Td className="font-semibold">{p.vendor.name}</Td>
                    <Td>
                      <Pill tone={p.kind === "advance" ? "blue" : "success"}>
                        {p.kind === "advance" ? "Advance" : "Rent balance"}
                      </Pill>
                    </Td>
                    <Td className="text-slate-600">{p.tipper?.name ?? "-"}</Td>
                    <Td className="text-slate-500 capitalize">{p.method}</Td>
                    <Td className="text-slate-500">{p.notes ?? "-"}</Td>
                    <Td align="right" className="num font-bold text-brand-red">
                      −{formatINR(p.amount)}
                    </Td>
                    <Td align="right">
                      <DeleteVendorPayment
                        id={p.id}
                        onDelete={async (id) => {
                          "use server";
                          await deleteVendorPayment(id);
                        }}
                      />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
      {children}
    </div>
  );
}

function Th({
  children,
  align,
}: {
  children?: React.ReactNode;
  align?: "right" | "left" | "center";
}) {
  return (
    <th
      className={`px-3 py-2.5 font-semibold text-slate-600 uppercase tracking-wider text-[10px] ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align,
  className,
}: {
  children?: React.ReactNode;
  align?: "right" | "left" | "center";
  className?: string;
}) {
  return (
    <td
      className={`px-3 py-2.5 ${align === "right" ? "text-right" : "text-left"} ${className ?? ""}`}
    >
      {children}
    </td>
  );
}
