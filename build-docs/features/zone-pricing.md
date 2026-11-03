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


## Rate chart revision — 2026-11-03

Source: `AREA RATE RD BRICKS.pdf- Google Sheets.pdf`.

**Every price is unchanged.** All nine bands' figures match what was already
seeded, so no existing quotation was priced wrongly by a rate. What changed is
which band a place sits in, and one new band.

| Change | Effect |
|---|---|
| **Dindigul moved** from 110-160 km to 160-300 km | 6" Room ₹55 → ₹58, 8" Room ₹67 → ₹73. The old transcription under-quoted every Dindigul job by ₹3-6/brick. |
| **New band: Karnataka (customer's own transport)** — ₹44/₹54 | Previously unquotable. See the assumption below. |
| 160-300 km renamed from "Other districts" | Now names Dindigul, Trichy, Thanjavur, Udamalaipettai, as the sheet does. |
| 300 km & above renamed from "Other districts" | Now names Chennai, Madurai, Ramanathapuram, Tirunelveli. |
| Area names added | Poonachi + Chennampatti (0-40, both were on the sheet and missing), Chinnappampatti (40-60), Kannakurichi (60-90), Salem Puthuchathiram/Thingalur/Pasur/Vellakovil (90-110), Uthangarai (110-160). |

**The 160 km+ question is answered, not a conflict.** MEMORY recorded "the v2.0
chart says one flat rate (₹58/₹73); the seeded data also has a 300 km & above
band at ₹61/₹78 — both are live, needs a ruling". The new sheet lists both
rows explicitly as separate bands. Both were right all along.

**Renames are done in place.** The seeder upserts on `name`, so a renamed zone
would be created fresh and the old row left orphaned — still holding its
ZonePrices and still offered in the dropdown. `ZoneDef.renameFrom` makes the
seeder rename the existing row instead, keeping its id and any quotation
history pointing at it. Verified: 9 zones before, 9 after.

**Assumption, flagged rather than buried.** "Karnataka (Transport own)" is read
as *the customer arranges their own lorry*, so the rate carries no delivery
cost. The figures force that reading — ₹44/₹54 sits just under the 0-20 km band
and far below 300 km+ (₹61/₹78), which only works if nothing is being paid to
move the bricks. If it actually means RD sends its own vehicle to Karnataka,
this row is badly wrong and the price belongs much higher.

**Still not on the sheet:** Godown (so it remains unquotable, refused with a
message naming the fix), 6"H (falls back to the flat matrix), and `masonRate` /
`productionCost` — the sheet is sell-side only, so those stay at 0 on the live
database and the Price matrix page now says so.
