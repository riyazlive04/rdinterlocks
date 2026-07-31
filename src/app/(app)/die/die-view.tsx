"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Input, Pill, Select } from "@/components/ui";
import { Icon } from "@/components/icons";
import { formatINR, formatNumber, formatISODate, formatShortDate } from "@/lib/format";

type Option = { id: string; label: string };
type Method = "cash" | "gpay" | "bank" | "upi" | "cheque";

export type SideRow = {
  usageId: string;
  side: number;
  startedAt: string;
  endedAt: string | null;
  bricks: number;
};

export type DieRow = {
  id: string;
  code: string;
  brickSize: string;
  vendor: string;
  cost: number;
  purchasedAt: string;
  notes: string;
  sides: SideRow[];
  bricks: number;
  live: boolean; // still in service
  currentSide: number | null;
  canFlip: boolean;
};

export function DieView({
  dies,
  sizes,
  vendors,
  onCreate,
  onFlip,
  onRetire,
  onDelete,
}: {
  dies: DieRow[];
  sizes: Option[];
  vendors: Option[];
  onCreate: (d: {
    purchasedAt: string;
    cost: number;
    brickSizeId?: string;
    vendorId?: string;
    notes?: string;
    method: Method;
  }) => Promise<void>;
  onFlip: (dieId: string, date: string) => Promise<void>;
  onRetire: (dieId: string, date: string) => Promise<void>;
  onDelete: (dieId: string) => Promise<void>;
}) {
  const router = useRouter();
  const today = formatISODate(new Date());
  const [adding, setAdding] = useState(false);
  const [purchasedAt, setPurchasedAt] = useState(today);
  const [cost, setCost] = useState<number>(0);
  const [brickSizeId, setBrickSizeId] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [method, setMethod] = useState<Method>("cash");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const run = (fn: () => Promise<void>) =>
    startTransition(async () => {
      try {
        await fn();
        router.refresh();
      } catch (e) {
        alert(e instanceof Error ? e.message : "Something went wrong");
      }
    });

  const save = () => {
    setError(null);
    startTransition(async () => {
      try {
        await onCreate({
          purchasedAt,
          cost,
          brickSizeId: brickSizeId || undefined,
          vendorId: vendorId || undefined,
          notes: notes.trim() || undefined,
          method,
        });
        setAdding(false);
        setCost(0);
        setNotes("");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not add the die");
      }
    });
  };

  const live = dies.filter((d) => d.live);

  return (
    <div className="space-y-4">
      {/* In service right now */}
      {live.length > 0 && (
        <div className="grid sm:grid-cols-2 gap-3">
          {live.map((d) => (
            <Card key={d.id} className="border-2 border-brand-red/25">
              <div className="flex items-baseline justify-between">
                <div>
                  <div className="text-[15px] font-bold text-ink">
                    {d.code}{" "}
                    <span className="text-brand-red">side {d.currentSide}</span>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    In service since{" "}
                    {formatShortDate(
                      new Date(d.sides.find((s) => !s.endedAt)?.startedAt ?? d.purchasedAt)
                    )}
                    {d.brickSize !== "-" ? ` · ${d.brickSize}` : ""}
                  </div>
                </div>
                <Pill tone="warning">Running</Pill>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-3">
                <Mini label="Bricks on this side" value={formatNumber(
                  d.sides.find((s) => !s.endedAt)?.bricks ?? 0
                )} />
                <Mini label="Bricks on this die" value={formatNumber(d.bricks)} />
              </div>
              <div className="flex gap-2 mt-3">
                {d.canFlip && (
                  <Button
                    onClick={() => {
                      if (!confirm(`Turn ${d.code} over to side 2 today?`)) return;
                      run(() => onFlip(d.id, today));
                    }}
                    disabled={isPending}
                    variant="secondary"
                    size="sm"
                  >
                    Change to side 2
                  </Button>
                )}
                <Button
                  onClick={() => {
                    if (!confirm(`${d.code} is finished - close it today?`)) return;
                    run(() => onRetire(d.id, today));
                  }}
                  disabled={isPending}
                  variant="ghost"
                  size="sm"
                >
                  Die finished
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* New die */}
      {adding ? (
        <Card className="border-2 border-brand-red/30">
          <div className="text-[12px] font-bold uppercase tracking-wider text-ink mb-3">
            New die
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            <Field label="Bought on">
              <Input
                type="date"
                value={purchasedAt}
                onChange={(e) => setPurchasedAt(e.target.value)}
              />
            </Field>
            <Field label="Cost ₹" hint="Booked as a Mould (Die) expense">
              <Input
                type="number"
                value={cost || ""}
                onChange={(e) => setCost(Number(e.target.value || 0))}
                autoFocus
              />
            </Field>
            <Field label="Brick size (optional)">
              <Select value={brickSizeId} onChange={(e) => setBrickSizeId(e.target.value)}>
                <option value="">- any -</option>
                {sizes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Bought from (optional)">
              <Select value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
                <option value="">- none -</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Paid by">
              <Select value={method} onChange={(e) => setMethod(e.target.value as Method)}>
                <option value="cash">Cash</option>
                <option value="gpay">GPay</option>
                <option value="upi">UPI</option>
                <option value="bank">Bank</option>
                <option value="cheque">Cheque</option>
              </Select>
            </Field>
            <Field label="Note (optional)">
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </div>
          <div className="text-[11px] text-slate-500 mt-2">
            The die goes in on <b>side 1</b> automatically. Turn it over later with “Change to
            side 2”.
          </div>
          {error && <div className="text-xs text-red-600 mt-2">{error}</div>}
          <div className="flex gap-2 mt-3">
            <Button onClick={save} disabled={isPending} variant="primary">
              {isPending ? "Saving…" : "Add die"}
            </Button>
            <Button onClick={() => setAdding(false)} variant="ghost">
              Cancel
            </Button>
          </div>
        </Card>
      ) : (
        <div className="flex justify-end">
          <Button onClick={() => setAdding(true)} variant="primary">
            <Icon.Plus size={15} stroke={2.4} /> New die
          </Button>
        </div>
      )}

      {/* Full history, die by die, side by side */}
      {dies.length === 0 ? (
        <Card>
          <div className="text-center text-sm text-slate-500 py-8">
            No dies recorded yet. Add the one currently on the machine to start counting.
          </div>
        </Card>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-900/[.06] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <Th>Die</Th>
                  <Th>Size</Th>
                  <Th align="right">Cost</Th>
                  <Th>Side</Th>
                  <Th>From</Th>
                  <Th>To</Th>
                  <Th align="right">Bricks</Th>
                  <Th align="right">₹ / 1000</Th>
                  <Th align="right"></Th>
                </tr>
              </thead>
              <tbody>
                {dies.map((d) =>
                  (d.sides.length > 0 ? d.sides : [null]).map((s, idx) => (
                    <tr
                      key={s ? s.usageId : d.id}
                      className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50"
                    >
                      {idx === 0 ? (
                        <>
                          <Td className="font-semibold text-ink">{d.code}</Td>
                          <Td className="text-slate-600">{d.brickSize}</Td>
                          <Td align="right" className="num">
                            {d.cost > 0 ? formatINR(d.cost) : "-"}
                          </Td>
                        </>
                      ) : (
                        <>
                          <Td />
                          <Td />
                          <Td />
                        </>
                      )}
                      <Td>
                        {s ? (
                          <Pill tone={s.endedAt ? "slate" : "warning"}>Side {s.side}</Pill>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </Td>
                      <Td className="num text-[12px]">
                        {s ? formatShortDate(new Date(s.startedAt)) : "-"}
                      </Td>
                      <Td className="num text-[12px]">
                        {s?.endedAt ? (
                          formatShortDate(new Date(s.endedAt))
                        ) : (
                          <span className="text-emerald-700 font-semibold">running</span>
                        )}
                      </Td>
                      <Td align="right" className="num">
                        {s ? formatNumber(s.bricks) : "-"}
                      </Td>
                      <Td align="right" className="num text-slate-600">
                        {s && s.bricks > 0 && d.cost > 0
                          ? formatINR(Math.round((d.cost / 2 / s.bricks) * 1000))
                          : "-"}
                      </Td>
                      <Td align="right">
                        {idx === 0 && (
                          <button
                            onClick={() => {
                              if (!confirm(`Delete ${d.code} and its purchase expense?`)) return;
                              run(() => onDelete(d.id));
                            }}
                            disabled={isPending}
                            className="w-8 h-8 rounded-md hover:bg-red-50 inline-flex items-center justify-center text-red-600"
                            aria-label="Delete die"
                          >
                            <Icon.Trash size={14} />
                          </button>
                        )}
                      </Td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="text-[11px] text-slate-500 px-1">
        ₹/1000 spreads half the die&apos;s price over the bricks that side pressed — the two sides
        share the cost.
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-50 rounded-xl p-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div className="num display text-base font-bold mt-0.5">{value}</div>
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
        align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"
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
      className={`px-3 py-2.5 ${
        align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"
      } ${className ?? ""}`}
    >
      {children}
    </td>
  );
}
