"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Input, Textarea } from "@/components/ui";
import { isValidVpa } from "@/lib/upi-vpa";

type Content = {
  quoteAddressTa: string;
  quoteTermsEn: string;
  quoteTermsTa: string;
  quoteOurScopeEn: string;
  quoteOurScopeTa: string;
  quoteClientScopeEn: string;
  quoteClientScopeTa: string;
  quoteUpiId: string;
  quoteUpiPayeeName: string;
  quoteSignatureImage: string;
};

// Matches the server-side cap in settings/actions.ts (700KB of encoded
// data: URL text, ~500KB source file) — checked here too so a rejection
// shows up immediately instead of after a round-trip to the server.
const MAX_SIGNATURE_FILE_BYTES = 500_000;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

export function QuoteContentForm({ initial, onSave }: { initial: Content; onSave: (data: Content) => Promise<void> }) {
  const router = useRouter();
  const [form, setForm] = useState<Content>(initial);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const set = (patch: Partial<Content>) => setForm((f) => ({ ...f, ...patch }));

  const onSignatureFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError("Signature must be an image file (PNG or JPG).");
      return;
    }
    if (file.size > MAX_SIGNATURE_FILE_BYTES) {
      setError(`That image is too large (${Math.round(file.size / 1000)}KB) — please use one under 500KB.`);
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      set({ quoteSignatureImage: dataUrl });
    } catch {
      setError("Could not read that file — try again.");
    }
  };

  const submit = () => {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      try {
        await onSave(form);
        setSaved(true);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
      }
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="text-base font-bold text-ink mb-1">Payment QR</div>
        <div className="text-[11px] text-slate-500 mb-3">
          A QR code encoding this UPI ID and the exact quoted amount is generated fresh on every PDF —
          nothing is stored as a static image.
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="UPI ID (VPA)" hint="e.g. 8870714655@ybl — ask your bank/PSP for the exact handle">
            <Input value={form.quoteUpiId} onChange={(e) => set({ quoteUpiId: e.target.value })} placeholder="phone@bank" />
            {form.quoteUpiId.trim() !== "" && !isValidVpa(form.quoteUpiId) && (
              <div className="text-[11px] font-semibold text-red-600 mt-1">
                Missing the bank handle — no QR will be printed until this reads
                &quot;{form.quoteUpiId.trim().split("@")[0] || "number"}@bank&quot;.
              </div>
            )}
          </Field>
          <Field label="Payee name shown to the payer">
            <Input value={form.quoteUpiPayeeName} onChange={(e) => set({ quoteUpiPayeeName: e.target.value })} />
          </Field>
        </div>
      </Card>

      <Card>
        <div className="text-base font-bold text-ink mb-1">Signature</div>
        <div className="text-[11px] text-slate-500 mb-3">
          Shown at the bottom of every quotation PDF, under &quot;For {"{Factory name}"}&quot;. PNG or JPG,
          under 500KB.
        </div>
        <div className="flex items-center gap-4">
          {form.quoteSignatureImage ? (
            <img
              src={form.quoteSignatureImage}
              alt="Signature preview"
              className="h-16 border border-slate-200 rounded-lg bg-white px-2"
            />
          ) : (
            <div className="h-16 w-32 border border-dashed border-slate-300 rounded-lg flex items-center justify-center text-[11px] text-slate-400">
              No signature set
            </div>
          )}
          <div className="flex flex-col gap-2">
            <input
              type="file"
              accept="image/*"
              onChange={(e) => onSignatureFile(e.target.files?.[0])}
              className="text-[12px]"
            />
            {form.quoteSignatureImage && (
              <button
                type="button"
                onClick={() => set({ quoteSignatureImage: "" })}
                className="text-[12px] text-red-600 font-semibold self-start"
              >
                Remove signature
              </button>
            )}
          </div>
        </div>
      </Card>

      <Card>
        <div className="text-base font-bold text-ink mb-1">Factory address (Tamil)</div>
        <div className="text-[11px] text-slate-500 mb-3">
          The Factory profile page holds the English address; this is only the Tamil rendering shown on the
          Tamil quotation page.
        </div>
        <Textarea rows={2} value={form.quoteAddressTa} onChange={(e) => set({ quoteAddressTa: e.target.value })} />
      </Card>

      <Card>
        <div className="text-base font-bold text-ink mb-1">Terms and Conditions</div>
        <div className="text-[11px] text-slate-500 mb-3">One bullet point per line.</div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="English">
            <Textarea rows={9} value={form.quoteTermsEn} onChange={(e) => set({ quoteTermsEn: e.target.value })} />
          </Field>
          <Field label="தமிழ் (Tamil)">
            <Textarea
              rows={9}
              value={form.quoteTermsTa}
              onChange={(e) => set({ quoteTermsTa: e.target.value })}
              className="ta"
            />
          </Field>
        </div>
      </Card>

      <Card>
        <div className="text-base font-bold text-ink mb-1">Our Scope</div>
        <div className="text-[11px] text-slate-500 mb-3">One bullet point per line.</div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="English">
            <Textarea rows={4} value={form.quoteOurScopeEn} onChange={(e) => set({ quoteOurScopeEn: e.target.value })} />
          </Field>
          <Field label="தமிழ் (Tamil)">
            <Textarea
              rows={4}
              value={form.quoteOurScopeTa}
              onChange={(e) => set({ quoteOurScopeTa: e.target.value })}
              className="ta"
            />
          </Field>
        </div>
      </Card>

      <Card>
        <div className="text-base font-bold text-ink mb-1">Client Scope</div>
        <div className="text-[11px] text-slate-500 mb-3">One bullet point per line.</div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="English">
            <Textarea
              rows={8}
              value={form.quoteClientScopeEn}
              onChange={(e) => set({ quoteClientScopeEn: e.target.value })}
            />
          </Field>
          <Field label="தமிழ் (Tamil)">
            <Textarea
              rows={8}
              value={form.quoteClientScopeTa}
              onChange={(e) => set({ quoteClientScopeTa: e.target.value })}
              className="ta"
            />
          </Field>
        </div>
      </Card>

      {error && <div className="text-xs text-red-600">{error}</div>}
      {saved && <div className="text-xs text-emerald-700">✓ Saved</div>}
      <Button onClick={submit} disabled={isPending} variant="primary">
        {isPending ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}
