# Feature 2 — District rate chart pricing

## Purpose

The price matrix was empty — `brickPrice: 0` rows, `deliveryZone: 0`. No
quotation could be generated at all. The owner's District Rate Chart prices
per brick by distance band, size (6"/8") and construction type
(Compound/Room), with minimum order quantities beyond 40 km.

## Architecture

`DELIVERY_ZONE_DEFS` already held the chart, transcribed from the owner's
sheet, but had **never been written**: the seeder looked up BrickSize `6"`
while the database stores `6`, and aborted on that punctuation. Matching is
now on digits only.

- 8 zones, 32 `ZonePrice` rows, 16 `ZoneBrickRule` rows (per-size minimums
  and transport-only rates).
- Flat `BrickPrice` matrix seeded from the 0–20 km band, used when no zone is
  picked. Stated as an assumption — the chart has no factory-gate column.
- `Lead.zoneId` plus a picker on the lead screen, so the telecaller records
  the zone they established on the call.

**Zones are never inferred from `place`.** The bands' area lists overlap —
"Ammapettai" and "Thoppur" each appear in two — so a guess is a ₹4–6/brick
error on a priced document.

## Impact map

| Touches | What could break |
|---|---|
| `resolveQuotationItems` | Every quotation prices through it. Zone price wins over the flat matrix; transport-only lines price from `ZoneBrickRule.transportOnly`. |
| `lib/auto-quote.ts` | Reads `Lead.zoneId`, then `extra.zoneId`. With `autoQuoteRequiresZone` on (default), a lead with no zone is skipped and the reason counted. |
| New-quotation form | Preselects the lead's zone and opens the line at the zone price — otherwise the office sees one rate and saves another. |
| `masonRate` | Not on the chart. Seeded 0, so mason payouts compute as zero until filled in. |

## Edge cases and failure modes

- **Below the zone minimum** is refused with the numbers and three ways out.
  Checked only for auto-priced lines: typing a price is the office
  deliberately overriding, and must release the minimum too.
- **No price configured** (e.g. Godown) is refused naming the row to fill in,
  never a silent ₹0 line on a customer document.
- **Re-running the seeders is safe** — upserts keyed on name, and on
  size+type.
- **Above 160 km is ambiguous.** The v2.0 chart says one flat rate; the
  seeded data also has a 300 km+ band from the older sheet. Open question in
  MEMORY.md.

## Acceptance criteria

1. 6" Room ×2000 in 60–90 km prices at ₹49 → ₹98,000. ✅ `QUOTE-01`
2. The same line ×500 is refused (minimum 1000). ✅
3. A typed price releases the minimum. ✅
4. No zone falls back to the flat matrix. ✅
5. An unpriced size+type combination is refused by name. ✅

Tests: `scripts/e2e/run-rbac.ts` case `QUOTE-01`.
