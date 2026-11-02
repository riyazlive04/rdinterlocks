"use client";

import { useState, useTransition } from "react";
import { Button, Card, Field, Input, Select } from "@/components/ui";
import { Icon } from "@/components/icons";
import { formatINR } from "@/lib/format";

type Item = {
  brickSizeId: string;
  constructionTypeId: string;
  quantity: number;
  unitPrice: number;
  overridden: boolean;
  transportOnly: boolean;
};

export type QuoteSubmit = {
  leadId?: string;
  clientId?: string;
  customerName?: string;
  customerPhone?: string;
  place?: string;
  zoneId?: string;
  validUntil?: string;
  items: Array<{
    brickSizeId: string;
    constructionTypeId: string;
    quantity: number;
    unitPrice?: number;
    transportOnly?: boolean;
  }>;
};

export type ZoneOption = { id: string; name: string; distanceLabel: string };
export type ZoneRule = { minBricks: number; transportOnly: number | null };

export function QuoteItemForm({
  leadOptions,
  clientOptions,
  sizes,
  ctypes,
  priceMap,
  zones,
  zonePrices,
  zoneRules,
  leadPlaceHint,
  initial,
  submitLabel,
  onSubmit,
}: {
  leadOptions?: Array<{ id: string; label: string }>;
  clientOptions?: Array<{ id: string; label: string }>;
  sizes: Array<{ id: string; label: string }>;
  ctypes: Array<{ id: string; name: string }>;
  priceMap: Record<string, number>;
  // Delivery-zone pricing: zonePrices keyed by `${zoneId}_${brickSizeId}_${constructionTypeId}`,
  // zoneRules keyed by `${zoneId}_${brickSizeId}`. Zone selection is always
  // explicit — never auto-matched from place text.
  zones?: ZoneOption[];
  zonePrices?: Record<string, number>;
  zoneRules?: Record<string, ZoneRule>;
  leadPlaceHint?: string;
  initial?: {
    leadId?: string;
    clientId?: string;
    customerName?: string;
    customerPhone?: string;
    place?: string;
    zoneId?: string;
    validUntil?: string;
    items?: Item[];
  };
  submitLabel?: string;
  onSubmit: (d: QuoteSubmit) => Promise<void>;
}) {
  const fixedLead = initial?.leadId;
  const fixedClient = initial?.clientId;
  const [target, setTarget] = useState<"lead" | "client" | "manual">(
    fixedClient ? "client" : fixedLead ? "lead" : initial?.customerName ? "manual" : "lead"
  );
  const [leadId, setLeadId] = useState(fixedLead ?? leadOptions?.[0]?.id ?? "");
  const [clientId, setClientId] = useState(fixedClient ?? clientOptions?.[0]?.id ?? "");
  const [customerName, setCustomerName] = useState(initial?.customerName ?? "");
  const [customerPhone, setCustomerPhone] = useState(initial?.customerPhone ?? "");
  const [place, setPlace] = useState(initial?.place ?? "");
  const [zoneId, setZoneId] = useState(initial?.zoneId ?? "");
  const [validUntil, setValidUntil] = useState(initial?.validUntil ?? "");
  const firstKey = `${sizes[0]?.id}_${ctypes[0]?.id}`;

  // A picked zone's price wins over the flat matrix; transport-only lines
  // (customer supplies their own bricks) price from that zone's per-size
  // transport rate instead. Mirrors resolveItems() in actions.ts.
  const priceFor = (sizeId: string, ctypeId: string, transportOnly: boolean, zid: string): number => {
    if (transportOnly) return zoneRules?.[`${zid}_${sizeId}`]?.transportOnly ?? 0;
    const zonePrice = zid ? zonePrices?.[`${zid}_${sizeId}_${ctypeId}`] : undefined;
    return zonePrice ?? priceMap[`${sizeId}_${ctypeId}`] ?? 0;
  };

  const [items, setItems] = useState<Item[]>(
    initial?.items && initial.items.length > 0
      ? initial.items
      : [
          {
            brickSizeId: sizes[0]?.id ?? "",
            constructionTypeId: ctypes[0]?.id ?? "",
            quantity: 1000,
            unitPrice: priceMap[firstKey] ?? 0,
            overridden: false,
            transportOnly: false,
          },
        ]
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const setItem = (i: number, patch: Partial<Item>) => {
    setItems((arr) => {
      const next = arr.slice();
      const merged = { ...next[i], ...patch };
      if ((patch.brickSizeId || patch.constructionTypeId || patch.transportOnly !== undefined) && !merged.overridden) {
        merged.unitPrice = priceFor(merged.brickSizeId, merged.constructionTypeId, merged.transportOnly, zoneId);
      }
      next[i] = merged;
      return next;
    });
  };
  const addItem = () =>
    setItems((arr) => [
      ...arr,
      {
        brickSizeId: sizes[0]?.id ?? "",
        constructionTypeId: ctypes[0]?.id ?? "",
        quantity: 1000,
        unitPrice: priceFor(sizes[0]?.id ?? "", ctypes[0]?.id ?? "", false, zoneId),
        overridden: false,
        transportOnly: false,
      },
    ]);
  const removeItem = (i: number) => setItems((arr) => arr.filter((_, idx) => idx !== i));

  const changeZone = (zid: string) => {
    setZoneId(zid);
    setItems((arr) =>
      arr.map((it) =>
        it.overridden ? it : { ...it, unitPrice: priceFor(it.brickSizeId, it.constructionTypeId, it.transportOnly, zid) }
      )
    );
  };

  const total = items.reduce((s, it) => s + it.quantity * it.unitPrice, 0);

  const submit = () => {
    setError(null);
    if (target === "lead" && !leadId) return setError("Pick a lead");
    if (target === "client" && !clientId) return setError("Pick a client");
    if (target === "manual" && !customerName.trim()) return setError("Enter the customer's name");
    if (items.length === 0) return setError("Add at least one item");
    for (const it of items) {
      if (!it.brickSizeId || !it.constructionTypeId) return setError("Pick size + type for all items");
      if (it.quantity <= 0) return setError("Quantity must be > 0");
      if (it.unitPrice < 0) return setError("Price can't be negative");
    }
    startTransition(async () => {
      try {
        await onSubmit({
          leadId: target === "lead" ? leadId : undefined,
          clientId: target === "client" ? clientId : undefined,
          customerName: target === "manual" ? customerName.trim() : undefined,
          customerPhone: target === "manual" ? customerPhone.trim() : undefined,
          place: target === "manual" ? place.trim() : undefined,
          zoneId: zoneId || undefined,
          validUntil: validUntil || undefined,
          items: items.map((it) => ({
            brickSizeId: it.brickSizeId,
            constructionTypeId: it.constructionTypeId,
            quantity: it.quantity,
            unitPrice: it.overridden ? it.unitPrice : undefined,
            transportOnly: it.transportOnly,
          })),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Save failed";
        if (!msg.includes("NEXT_REDIRECT")) setError(msg);
      }
    });
  };

  return (
    <div className="space-y-3">
      <Card>
        <div className="grid sm:grid-cols-3 gap-3">
          {!fixedLead && !fixedClient && (
            <Field label="Quote for">
              <Select value={target} onChange={(e) => setTarget(e.target.value as "lead" | "client" | "manual")}>
                <option value="lead">A lead</option>
                <option value="client">An existing client</option>
                <option value="manual">Type customer details manually</option>
              </Select>
            </Field>
          )}
          {target === "lead" && (
            <Field label="Lead">
              {fixedLead ? (
                <div className="py-2.5 text-[13px] text-ink font-medium">
                  {leadOptions?.find((l) => l.id === fixedLead)?.label ?? fixedLead}
                </div>
              ) : (
                <Select value={leadId} onChange={(e) => setLeadId(e.target.value)}>
                  <option value="">- select lead -</option>
                  {leadOptions?.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          {target === "client" && (
            <Field label="Client">
              {fixedClient ? (
                <div className="py-2.5 text-[13px] text-ink font-medium">
                  {clientOptions?.find((c) => c.id === fixedClient)?.label ?? fixedClient}
                </div>
              ) : (
                <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
                  <option value="">- select client -</option>
                  {clientOptions?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          {target === "manual" && (
            <Field label="Customer name">
              <Input
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="e.g. Abdul"
                autoFocus
              />
            </Field>
          )}
          {zones && zones.length > 0 && (
            <Field
              label="Delivery zone"
              hint={leadPlaceHint ? `Lead's place: ${leadPlaceHint}` : "Optional — drives location-based pricing"}
            >
              <Select value={zoneId} onChange={(e) => changeZone(e.target.value)}>
                <option value="">- no zone (use flat price matrix) -</option>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                    {z.distanceLabel ? ` (${z.distanceLabel})` : ""}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Valid until" hint="Optional">
            <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </Field>
        </div>
        {target === "manual" && (
          <div className="grid sm:grid-cols-2 gap-3 mt-3">
            <Field label="Phone" hint="Optional">
              <Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="e.g. 9944006674" />
            </Field>
            <Field label="Place" hint="Optional">
              <Input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="e.g. Salem" />
            </Field>
          </div>
        )}
      </Card>

      <Card>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Bricks</div>
        <div className="space-y-3">
          {items.map((it, i) => {
            const rule = zoneId ? zoneRules?.[`${zoneId}_${it.brickSizeId}`] : undefined;
            const belowMin = !!rule && rule.minBricks > 0 && it.quantity < rule.minBricks;
            const transportOnlyAvailable = rule?.transportOnly != null;
            return (
              <div key={i}>
                <div className="grid grid-cols-2 lg:grid-cols-6 gap-2 items-end">
                  <Field label="Size">
                    <Select value={it.brickSizeId} onChange={(e) => setItem(i, { brickSizeId: e.target.value })}>
                      {sizes.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Type">
                    <Select
                      value={it.constructionTypeId}
                      onChange={(e) => setItem(i, { constructionTypeId: e.target.value })}
                    >
                      {ctypes.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Quantity">
                    <Input
                      type="number"
                      value={it.quantity}
                      onChange={(e) => setItem(i, { quantity: Number(e.target.value || 0) })}
                    />
                  </Field>
                  <Field label={it.overridden ? "₹/brick (manual)" : zoneId ? "₹/brick (zone)" : "₹/brick (matrix)"}>
                    <Input
                      type="number"
                      step="0.5"
                      value={it.unitPrice}
                      onChange={(e) => setItem(i, { unitPrice: Number(e.target.value || 0), overridden: true })}
                    />
                  </Field>
                  <div className="num font-bold text-ink">{formatINR(it.quantity * it.unitPrice)}</div>
                  <button
                    type="button"
                    onClick={() => removeItem(i)}
                    className="w-8 h-8 rounded-md hover:bg-red-50 flex items-center justify-center text-red-600 justify-self-end"
                  >
                    <Icon.Trash size={14} />
                  </button>
                </div>
                {zoneId && (
                  <div className="flex flex-wrap items-center gap-3 mt-1 pl-0.5">
                    <label
                      className={`flex items-center gap-1.5 text-[12px] ${
                        transportOnlyAvailable ? "text-slate-600" : "text-slate-300"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={it.transportOnly}
                        disabled={!transportOnlyAvailable}
                        onChange={(e) => setItem(i, { transportOnly: e.target.checked, overridden: false })}
                      />
                      Transport only — customer supplies bricks
                    </label>
                    {belowMin && (
                      <span className="text-[11px] text-amber-600 font-medium">
                        Below zone minimum ({rule!.minBricks.toLocaleString("en-IN")})
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={addItem}
          className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 text-[12px] font-semibold"
        >
          <Icon.Plus size={14} /> Add item
        </button>
      </Card>

      <Card>
        <Field label="Quotation total">
          <div className="num display text-2xl font-bold py-1.5">{formatINR(total)}</div>
        </Field>
      </Card>

      {error && <div className="text-xs text-red-600">{error}</div>}

      <div className="flex justify-end">
        <Button onClick={submit} disabled={isPending} variant="primary" size="lg">
          {isPending ? "Saving…" : submitLabel ?? "Generate quotation"}
        </Button>
      </div>
    </div>
  );
}
