import QRCode from "qrcode";
import { isValidVpa } from "./upi-vpa";

// A dynamic UPI QR, generated fresh per quotation so it always encodes the
// exact amount and current payee details — never a static uploaded image
// that can go stale if the VPA changes.

export function buildUpiLink(opts: { vpa: string; payeeName: string; amount: number; note?: string }): string {
  // Deliberately NOT URLSearchParams: it serializes a space as "+", which UPI
  // apps read as a literal plus (RFC 3986 reserves "+" only in the
  // application/x-www-form-urlencoded reading of a query). The payer then sees
  // "RD+Interlock+Bricks" as the payee name. encodeURIComponent gives %20.
  //
  // Both text fields are trimmed because they come from admin-typed settings,
  // where a trailing space pasted alongside a UPI ID would otherwise be
  // encoded into the `pa` value and make the QR reference a non-existent VPA —
  // a quotation the customer cannot pay, with nothing on screen to show why.
  const vpa = opts.vpa.trim();
  const payeeName = opts.payeeName.trim() || "RD Interlock Bricks";

  const parts = [
    `pa=${encodeURIComponent(vpa)}`,
    `pn=${encodeURIComponent(payeeName)}`,
    `am=${opts.amount.toFixed(2)}`,
    "cu=INR",
  ];
  const note = opts.note?.trim();
  if (note) parts.push(`tn=${encodeURIComponent(note)}`);
  return `upi://pay?${parts.join("&")}`;
}

/**
 * Returns a base64 PNG data: URL, or null when no usable UPI ID is
 * configured.
 *
 * A malformed VPA returns null rather than a QR, because the two failures are
 * not equally bad: a quotation with no QR still carries the payment line for
 * the customer to type, while a quotation with an unresolvable QR invites them
 * to scan it, fail, and conclude the business is not serious. Settings
 * validation (isValidVpa, enforced in settings/actions.ts) is the real fix;
 * this is the backstop for rows written before that validation existed.
 */
export async function upiQrDataUrl(opts: {
  vpa: string;
  payeeName: string;
  amount: number;
  note?: string;
}): Promise<string | null> {
  const vpa = opts.vpa.trim();
  if (!vpa) return null;
  if (!isValidVpa(vpa)) {
    console.warn(
      `[upi-qr] refusing to render a QR for malformed UPI ID ${JSON.stringify(vpa)} — ` +
        `expected "handle@psp". Fix it in Settings -> Quotation content.`
    );
    return null;
  }
  const link = buildUpiLink(opts);
  return QRCode.toDataURL(link, { margin: 1, width: 240 });
}
