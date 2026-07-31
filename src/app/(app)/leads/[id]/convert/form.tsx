"use client";
import { useState, useTransition } from "react";
import { Button, Card, Field, Input, Select, Pill } from "@/components/ui";
import { formatINR } from "@/lib/format";
import { convertLead } from "../../actions";

type Option = { id: string; label: string };
type ClientOption = { id: string; name: string; location: string | null };

export type ConvertDefaults = {
  customerName: string;
  phone: string;
  place: string;
  brickSizeId: string;
  constructionTypeId: string;
  brickCount: number | null;
  costPerBrick: number | null;
  suggestedClientId: string | null;
};

// Converting is the moment a lead stops being a guess and becomes money owed.
// The form pre-fills everything the call captured, but every value stays
// editable — the extraction is evidence, not truth.
export function ConvertLeadForm({
  id,
  callId,
  defaults,
  clients,
  brickSizes,
  constructionTypes,
}: {
  id: string;
  callId: string;
  defaults: ConvertDefaults;
  clients: ClientOption[];
  brickSizes: Option[];
  constructionTypes: Option[];
}) {
  const [mode, setMode] = useState<"new" | "existing">(
    defaults.suggestedClientId ? "existing" : "new"
  );
  const [clientId, setClientId] = useState(defaults.suggestedClientId ?? "");
  const [name, setName] = useState(defaults.customerName);
  const [location, setLocation] = useState(defaults.place);
  const [phone, setPhone] = useState(defaults.phone);

  const [createOrder, setCreateOrder] = useState(
    !!(defaults.brickSizeId && defaults.constructionTypeId && defaults.brickCount)
  );
  const [brickSizeId, setBrickSizeId] = useState(defaults.brickSizeId);
  const [constructionTypeId, setConstructionTypeId] = useState(defaults.constructionTypeId);
  const [quantity, setQuantity] = useState<number | "">(defaults.brickCount ?? "");
  const [pricePerBrick, setPricePerBrick] = useState<number | "">(defaults.costPerBrick ?? "");
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const orderTotal =
    quantity !== "" && pricePerBrick !== "" ? Number(quantity) * Number(pricePerBrick) : null;

  const submit = () => {
    setError(null);
    if (mode === "existing" && !clientId) return setError("Pick a client");
    if (mode === "new" && !name.trim()) return setError("Enter a client name");
    if (createOrder && (!brickSizeId || !constructionTypeId || !quantity || pricePerBrick === "")) {
      return setError("An order needs brick size, construction type, quantity and price");
    }

    startTransition(async () => {
      try {
        await convertLead(id, {
          clientId: mode === "existing" ? clientId : undefined,
          newClientName: mode === "new" ? name.trim() : undefined,
          newClientLocation: mode === "new" ? location.trim() || undefined : undefined,
          newClientPhone: mode === "new" ? phone.trim() || undefined : undefined,
          createOrder,
          brickSizeId: createOrder ? brickSizeId : undefined,
          constructionTypeId: createOrder ? constructionTypeId : undefined,
          quantity: createOrder ? Number(quantity) : undefined,
          pricePerBrick: createOrder ? Number(pricePerBrick) : undefined,
          expectedDeliveryDate: createOrder ? expectedDeliveryDate || undefined : undefined,
        });
      } catch (e) {
        if (e && typeof e === "object" && "digest" in e) throw e;
        setError(e instanceof Error ? e.message : "Conversion failed");
      }
    });
  };

  return (
    <div className="max-w-2xl space-y-4">
      <Card>
        <div className="text-base font-bold text-ink mb-1">Customer</div>
        <div className="text-[12px] text-slate-500 mb-3">
          Attach this enquiry to an existing client, or create a new one.
        </div>

        <div className="flex gap-2 mb-3">
          <button
            type="button"
            onClick={() => setMode("new")}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold ${
              mode === "new" ? "bg-ink text-white" : "bg-white border border-slate-200 text-slate-600"
            }`}
          >
            New client
          </button>
          <button
            type="button"
            onClick={() => setMode("existing")}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold ${
              mode === "existing"
                ? "bg-ink text-white"
                : "bg-white border border-slate-200 text-slate-600"
            }`}
          >
            Existing client
          </button>
          {defaults.suggestedClientId && mode === "existing" && (
            <Pill tone="blue">Name matched an existing client</Pill>
          )}
        </div>

        {mode === "new" ? (
          <div className="grid sm:grid-cols-3 gap-3">
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Location">
              <Input value={location} onChange={(e) => setLocation(e.target.value)} />
            </Field>
            <Field label="Phone" hint={defaults.phone ? undefined : "Not captured by the call"}>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
          </div>
        ) : (
          <Field label="Client">
            <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">Select a client…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.location ? ` — ${c.location}` : ""}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </Card>

      <Card>
        <label className="flex items-center gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={createOrder}
            onChange={(e) => setCreateOrder(e.target.checked)}
            className="w-4 h-4 accent-brand-red"
          />
          <span className="text-base font-bold text-ink">Raise the first order now</span>
        </label>
        <div className="text-[12px] text-slate-500 mt-1 mb-3">
          Optional. Leave off to create the client only and quote later.
        </div>

        {createOrder && (
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Brick size">
              <Select value={brickSizeId} onChange={(e) => setBrickSizeId(e.target.value)}>
                <option value="">Select…</option>
                {brickSizes.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Construction type">
              <Select
                value={constructionTypeId}
                onChange={(e) => setConstructionTypeId(e.target.value)}
              >
                <option value="">Select…</option>
                {constructionTypes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Quantity">
              <Input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value === "" ? "" : Number(e.target.value))}
              />
            </Field>
            <Field label="Price per brick">
              <Input
                type="number"
                step="0.01"
                value={pricePerBrick}
                onChange={(e) =>
                  setPricePerBrick(e.target.value === "" ? "" : Number(e.target.value))
                }
              />
            </Field>
            <Field label="Expected delivery">
              <Input
                type="date"
                value={expectedDeliveryDate}
                onChange={(e) => setExpectedDeliveryDate(e.target.value)}
              />
            </Field>
            {orderTotal !== null && (
              <div className="flex items-end">
                <div className="text-[13px]">
                  <span className="text-slate-500">Order total </span>
                  <span className="num font-bold text-ink">{formatINR(orderTotal)}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

      <Card className="bg-amber-50 border-amber-200">
        <div className="text-[12px] text-amber-900">
          Converting locks this lead. Call <span className="mono">{callId}</span> can still be
          re-sent by the Transcriber, but the import will be refused with 409 instead of
          overwriting what you record here.
        </div>
      </Card>

      {error && <div className="text-xs text-red-600">{error}</div>}
      <Button onClick={submit} disabled={isPending} variant="primary" size="lg">
        {isPending ? "Converting…" : "Convert to client"}
      </Button>
    </div>
  );
}
