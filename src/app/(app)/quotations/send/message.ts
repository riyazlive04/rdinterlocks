// The WhatsApp message text a human pastes into a chat for a quotation.
//
// Lives here rather than in src/lib because it is presentation for exactly two
// screens — the quotation detail page and this send list — and both built it
// independently before. Keeping one builder means the text the reviewer saw on
// the detail page is byte-for-byte the text the telecaller sends from the
// queue; two copies drifted the moment either one gained a line.
//
// Nothing here sends anything: the output is clipboard/deep-link text only.

import { formatINR, formatLongDate, formatNumber } from "@/lib/format";

export type QuoteMessageItem = {
  quantity: number;
  unitPrice: number;
  total: number;
  transportOnly: boolean;
  brickSize: { label: string };
  constructionType: { name: string };
};

export type QuoteMessageInput = {
  number: string;
  customerName: string;
  total: number;
  validUntil: Date | null;
  items: QuoteMessageItem[];
};

/**
 * `canRevenue` is NOT cosmetic — a telecaller without `revenue` must not have
 * per-brick rates or the total handed to them through a message they are about
 * to paste, so those lines are dropped entirely rather than blanked.
 */
export function quotationWhatsappText(quotation: QuoteMessageInput, canRevenue: boolean): string {
  return [
    `*${quotation.number}*`,
    quotation.customerName ? `To: ${quotation.customerName}` : "",
    "",
    ...quotation.items.map(
      (it) =>
        `${formatNumber(it.quantity)} × ${it.brickSize.label} ${it.constructionType.name}${
          it.transportOnly ? " (Transport only)" : ""
        }${canRevenue ? ` @ ₹${it.unitPrice} = ${formatINR(it.total)}` : ""}`
    ),
    "",
    canRevenue ? `Total: ${formatINR(quotation.total)}` : "",
    quotation.validUntil ? `Valid until ${formatLongDate(quotation.validUntil)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * A wa.me deep link that opens the customer's chat with the message already
 * typed. `recipient` must already be digits-only with a country code — use
 * `toWhatsAppRecipient` from lib/whatsapp-send on the server, which returns ""
 * for anything that is not a plausible MSISDN (a masked number, most of all).
 * Returns null for that case so the caller renders no link rather than a
 * wa.me URL that opens an empty chat picker.
 */
export function waMeLink(recipient: string, text: string): string | null {
  if (!recipient) return null;
  return `https://wa.me/${recipient}?text=${encodeURIComponent(text)}`;
}
