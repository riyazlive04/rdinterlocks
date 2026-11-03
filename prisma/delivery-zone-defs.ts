// Transcribed from the owner-supplied "AREA RATE RD BRICKS" reference sheet.
//
// CURRENT SOURCE: "AREA RATE RD BRICKS.pdf- Google Sheets.pdf", supplied
// 2026-11-03. Every price below was re-checked against it cell by cell.
// `scripts/e2e/run-pricing.ts` carries the same table transcribed a second
// time and asserts the two agree, so a slip in either copy fails a test
// rather than reaching a customer-facing quotation.
//
// Only 6" and 8" bricks appear on that sheet (6"H is not covered — it falls
// back to the flat BrickPrice matrix for any zone, same as any size with no
// ZonePrice row). "C" = Compound, "R" = Room (existing ConstructionType
// names) — confirmed with the owner, not a guess. The last three rows have no
// C/R split in the source sheet, so the same price is used for both.
//
// ─── Overlapping area names are REAL ──────────────────────────────────
// The sheet genuinely lists several places in two bands: Poonachi (0-40 and
// 40-60), Ammapettai (40-60 and 60-90), Thoppur (60-90 and 90-110),
// Vellakovil (60-90 and 90-110), Muthur (90-110 and 110-160). That is why
// Lead.zoneId is set explicitly by whoever took the call and is never
// inferred from the free-text `place` — guessing wrong is a ₹4-6/brick error
// on a priced document.
export type ZoneDef = {
  name: string;
  distanceLabel: string;
  areas: string;
  minBricks6: number;
  minBricks8: number;
  transportOnly6: number | null;
  transportOnly8: number | null;
  compound6: number;
  compound8: number;
  room6: number;
  room8: number;
  /**
   * Names this zone has been saved under before.
   *
   * The seeder upserts by `name`, so renaming a zone would otherwise CREATE a
   * second row and leave the old one orphaned — still holding its ZonePrices
   * and still selectable in the dropdown, which on a priced document is worse
   * than a stale name. The seeder renames in place instead.
   */
  renameFrom?: string[];
};

export const DELIVERY_ZONE_DEFS: ZoneDef[] = [
  {
    name: "Kolathur, Mettur",
    distanceLabel: "0-20 km",
    areas: "Kolathur, Mettur",
    minBricks6: 0,
    minBricks8: 0,
    transportOnly6: null,
    transportOnly8: null,
    compound6: 43,
    compound8: 55,
    room6: 44,
    room8: 56,
  },
  {
    name: "Kunjandiyur, Guruvarediyur, Nangavalli, Jalagandapuram",
    distanceLabel: "0-40 km",
    // Poonachi and Chennampatti were on the sheet but missing from the first
    // transcription of this row.
    areas:
      "Kunjandiyur, Guruvarediyur, Nangavalli, Jalagandapuram, Poonachi, Chennampatti",
    minBricks6: 0,
    minBricks8: 0,
    transportOnly6: null,
    transportOnly8: null,
    compound6: 43,
    compound8: 56,
    room6: 45,
    room8: 57,
  },
  {
    name: "Tharamangalam, Elampillai, Mecheri and nearby",
    distanceLabel: "40-60 km",
    areas:
      "Tharamangalam, Elampillai, Mecheri, Anthiyur, Nerinjpettai, Pottaneri, Omalur, Edappadi, Chithar, Konaganapuram, Ennamangalam, Ammapettai, Konganapuram, Koneripattai, Poonachi, Chinnappampatti",
    minBricks6: 1000,
    minBricks8: 700,
    transportOnly6: 4,
    transportOnly8: 6,
    compound6: 44,
    compound8: 59,
    room6: 47,
    room8: 60,
  },
  {
    name: "Salem, Erode, Sankagiri and nearby",
    distanceLabel: "60-90 km",
    areas:
      "Salem, Erode, Sankagiri, Veppadi, Pallipalayam, Nariyanur, Kakapalayam, Karuppur, Vaikundam, Komarapalayam, Erumapalayam, Thoppur, Bhavani, Athani, Vellakovil, Pannapatti, Appakudal, Udaiyapatti, Kavindapadi, Gobi, Ammapettai (Salem), Chittode, Ariyanur, Uthukuli, Thindal, Chinnathirupathi, Vellode, Magundansaradi, Modamangalam, Kannakurichi",
    minBricks6: 1000,
    minBricks8: 700,
    transportOnly6: 6,
    transportOnly8: 9,
    compound6: 47,
    compound8: 61,
    room6: 49,
    room8: 62,
  },
  {
    name: "Kunnathur, Avinashi, Perundurai and nearby",
    distanceLabel: "90-110 km",
    areas:
      "Kunnathur, Avinashi, Perundurai, Valapadi, Ayothayapattinam, Annur, Sathyamangalam, Nambiyur, Thiruchengode, Modakurichi, Pennagaram, Thoppur, Rasipuram, Chennaimalai, Muthur, Archalur, Solar, Kangeyam, Sivagiri, Mallasamuthiram, Kodumudai, Vaiyappamalai, Hasthampatti, Mallur, Vennadur, Perumanallur, Chengapalli, Paramathivelur, Gorimedu, Attayampatti, Panamarathupattai, Bommidi, Eriyur, Salem Puthuchathiram, Thingalur, Pasur, Vellakovil",
    minBricks6: 2500,
    minBricks8: 2000,
    transportOnly6: 8,
    transportOnly8: 10,
    compound6: 48,
    compound8: 65,
    room6: 51,
    room8: 66,
  },
  {
    name: "Coimbatore, Dharmapuri, Hosur and nearby",
    distanceLabel: "110-160 km",
    // DINDIGUL MOVED OUT of this band. The first transcription had it here;
    // the sheet lists it under 160-300 km, which is ₹58/₹73 rather than
    // ₹52-55/₹65-67 — a ₹3-6/brick under-quote on every Dindigul job.
    // Uthangarai added, also from the sheet.
    areas:
      "Coimbatore, Dharmapuri, Hosur, Krishnagiri, Namakkal, Tirupur, Attur, Puliyampatti, Karumandurai, Muthur, Ranipettai, Harur, Karur, Pollachi, Thalaivasal, Uthangarai",
    minBricks6: 2500,
    minBricks8: 2000,
    transportOnly6: null,
    transportOnly8: null,
    compound6: 52,
    compound8: 65,
    room6: 55,
    room8: 67,
  },
  {
    name: "Dindigul, Trichy, Thanjavur and nearby",
    distanceLabel: "160-300 km",
    // The sheet names these four outright, so the band is no longer "other
    // districts" — and this is where Dindigul actually belongs.
    areas: "Dindigul, Trichy, Thanjavur, Udamalaipettai",
    minBricks6: 0,
    minBricks8: 0,
    transportOnly6: null,
    transportOnly8: null,
    compound6: 58,
    compound8: 73,
    room6: 58,
    room8: 73,
    renameFrom: ["Other districts (160-300 km)"],
  },
  {
    name: "Chennai, Madurai, Tirunelveli and nearby",
    distanceLabel: "300 km & above",
    areas: "Chennai, Madurai, Ramanathapuram, Tirunelveli",
    minBricks6: 0,
    minBricks8: 0,
    transportOnly6: null,
    transportOnly8: null,
    compound6: 61,
    compound8: 78,
    room6: 61,
    room8: 78,
    renameFrom: ["Other districts (300 km & above)"],
  },
  {
    // New on the 2026-11-03 sheet: "Karnataka (Transport own)" at 44/54.
    //
    // ASSUMPTION, FLAGGED: "transport own" is read as the customer arranging
    // their own lorry, so the rate carries no delivery cost. The figures are
    // what make that reading the only sensible one — ₹44/₹54 for Karnataka
    // sits just under the 0-20 km band (₹43-44/₹55-56) and far below the
    // 300 km+ band (₹61/₹78), which only works if nothing is being paid to
    // move the bricks. If it instead means RD sends its own vehicle, this row
    // is wrong and the price belongs much higher — ask before quoting it.
    name: "Karnataka (customer's own transport)",
    distanceLabel: "Karnataka",
    areas: "Karnataka",
    minBricks6: 0,
    minBricks8: 0,
    transportOnly6: null,
    transportOnly8: null,
    compound6: 44,
    compound8: 54,
    room6: 44,
    room8: 54,
  },
];
