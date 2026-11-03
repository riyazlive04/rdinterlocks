/**
 * The rate chart, guarded.
 *
 * Source: "AREA RATE RD BRICKS.pdf- Google Sheets.pdf", supplied 2026-11-03.
 *
 * ─── Why this suite exists ────────────────────────────────────────────
 * The zone prices are hand-transcribed from a PDF the owner maintains. A
 * mistyped digit does not fail anything — it produces a plausible-looking
 * quotation at the wrong price, which is only discovered when the customer
 * has already been given the document. (That exact class of error was
 * already found once: Dindigul was transcribed into the 110-160 km band when
 * the sheet puts it in 160-300, a ₹3-6/brick under-quote on every Dindigul
 * job.)
 *
 * So the chart is written out TWICE: once as the application's data
 * (prisma/delivery-zone-defs.ts) and once here, read off the sheet
 * independently. The suite asserts the two agree. A slip in either copy
 * fails, which is the whole point — one copy proves nothing.
 *
 * The pure half needs no database. The query half checks that a quotation
 * actually prices at the chart rate.
 *
 * Run: npx tsx scripts/e2e/run-pricing.ts
 */

import { tc, eq, ok, run } from "./harness";
import { prisma } from "@/lib/db";
import { DELIVERY_ZONE_DEFS } from "../../prisma/delivery-zone-defs";
import { resolveQuotationItems } from "@/lib/quote";

const url = process.env.DATABASE_URL ?? "";
const isLocal = /@(localhost|127\.0\.0\.1|host\.docker\.internal)[:/]/.test(url);
if (!isLocal && process.env.E2E_ALLOW_REMOTE_DB !== "yes") {
  console.error(
    "REFUSING TO RUN: DATABASE_URL is not local.\n" +
      `  got: ${url.replace(/:[^:@/]*@/, ":***@") || "(unset)"}\n` +
      "Point it at a throwaway database."
  );
  process.exit(2);
}

/**
 * The sheet, read off the PDF a second time.
 *
 * [distanceLabel, min6, min8, transportOnly6, transportOnly8,
 *  C6, C8, R6, R8]
 *
 * Deliberately keyed on `distanceLabel` rather than `name`, because the names
 * are ours and the band labels are the sheet's.
 */
const CHART: Array<[string, number, number, number | null, number | null, number, number, number, number]> = [
  ["0-20 km", 0, 0, null, null, 43, 55, 44, 56],
  ["0-40 km", 0, 0, null, null, 43, 56, 45, 57],
  ["40-60 km", 1000, 700, 4, 6, 44, 59, 47, 60],
  ["60-90 km", 1000, 700, 6, 9, 47, 61, 49, 62],
  ["90-110 km", 2500, 2000, 8, 10, 48, 65, 51, 66],
  ["110-160 km", 2500, 2000, null, null, 52, 65, 55, 67],
  // No C/R split on the sheet for these three — same price for both.
  ["160-300 km", 0, 0, null, null, 58, 73, 58, 73],
  ["300 km & above", 0, 0, null, null, 61, 78, 61, 78],
  ["Karnataka", 0, 0, null, null, 44, 54, 44, 54],
];

/** AC: the transcription in the app matches the sheet, cell for cell. */
const transcription = tc("RATE-01", "every zone matches the rate chart", () => {
  eq("the chart has 9 bands", CHART.length, 9);
  eq("and so does the app's data", DELIVERY_ZONE_DEFS.length, CHART.length);

  for (const [label, min6, min8, to6, to8, c6, c8, r6, r8] of CHART) {
    const def = DELIVERY_ZONE_DEFS.find((d) => d.distanceLabel === label);
    ok(`${label}: present`, !!def);
    if (!def) continue;

    eq(`${label}: 6" Compound`, def.compound6, c6);
    eq(`${label}: 8" Compound`, def.compound8, c8);
    eq(`${label}: 6" Room`, def.room6, r6);
    eq(`${label}: 8" Room`, def.room8, r8);
    eq(`${label}: 6" minimum`, def.minBricks6, min6);
    eq(`${label}: 8" minimum`, def.minBricks8, min8);
    eq(`${label}: 6" transport-only`, def.transportOnly6, to6);
    eq(`${label}: 8" transport-only`, def.transportOnly8, to8);
  }
});

/**
 * AC: the prices rise with distance.
 *
 * Not a restatement of the table — an independent sanity property. A
 * transposed pair of digits that happened to match in both copies would still
 * show up as a band that is cheaper than a nearer one.
 */
const monotonic = tc("RATE-02", "price never falls as distance rises", () => {
  // Karnataka is excluded: it is a no-delivery rate, so it is deliberately
  // cheaper than the distance bands around it.
  const bands = DELIVERY_ZONE_DEFS.filter((d) => d.distanceLabel !== "Karnataka");
  for (let i = 1; i < bands.length; i++) {
    const prev = bands[i - 1];
    const cur = bands[i];
    ok(`${cur.distanceLabel}: 6" Compound >= previous`, cur.compound6 >= prev.compound6);
    ok(`${cur.distanceLabel}: 8" Compound >= previous`, cur.compound8 >= prev.compound8);
    ok(`${cur.distanceLabel}: 6" Room >= previous`, cur.room6 >= prev.room6);
    ok(`${cur.distanceLabel}: 8" Room >= previous`, cur.room8 >= prev.room8);
  }
  // Room is never cheaper than Compound anywhere on the sheet.
  for (const d of DELIVERY_ZONE_DEFS) {
    ok(`${d.distanceLabel}: 6" Room >= Compound`, d.room6 >= d.compound6);
    ok(`${d.distanceLabel}: 8" Room >= Compound`, d.room8 >= d.compound8);
    ok(`${d.distanceLabel}: 8" dearer than 6"`, d.compound8 > d.compound6 && d.room8 > d.room6);
  }
});

/**
 * AC: Dindigul is in the 160-300 band, not 110-160.
 *
 * Pinned by name because this is the error the new sheet actually caught, and
 * it is the kind that silently under-quotes rather than failing.
 */
const dindigul = tc("RATE-03", "Dindigul sits in the 160-300 km band", () => {
  const near = DELIVERY_ZONE_DEFS.find((d) => d.distanceLabel === "110-160 km")!;
  const far = DELIVERY_ZONE_DEFS.find((d) => d.distanceLabel === "160-300 km")!;
  ok("not in 110-160", !/dindigul/i.test(near.areas));
  ok("is in 160-300", /dindigul/i.test(far.areas));
  // And the correction is worth money, which is why it matters.
  ok("the far band really is dearer", far.compound6 > near.compound6);
  eq("Dindigul 6\" Compound is 58, not 52", far.compound6, 58);
});

/** AC: the names the sheet now spells out are no longer "other districts". */
const namedBands = tc("RATE-04", "the far bands name their districts", () => {
  const far = DELIVERY_ZONE_DEFS.find((d) => d.distanceLabel === "160-300 km")!;
  const farther = DELIVERY_ZONE_DEFS.find((d) => d.distanceLabel === "300 km & above")!;
  for (const place of ["Dindigul", "Trichy", "Thanjavur", "Udamalaipettai"]) {
    ok(`160-300 names ${place}`, far.areas.includes(place));
  }
  for (const place of ["Chennai", "Madurai", "Ramanathapuram", "Tirunelveli"]) {
    ok(`300+ names ${place}`, farther.areas.includes(place));
  }
  // Renaming must carry the old name, or the seeder creates a duplicate zone
  // and leaves the original selectable.
  ok("160-300 carries its old name", (far.renameFrom ?? []).includes("Other districts (160-300 km)"));
  ok("300+ carries its old name", (farther.renameFrom ?? []).includes("Other districts (300 km & above)"));
});

/** AC: the places the sheet lists twice are present in both bands. */
const knownOverlaps = tc("RATE-05", "overlapping area names are carried, not deduplicated", () => {
  const by = (label: string) => DELIVERY_ZONE_DEFS.find((d) => d.distanceLabel === label)!.areas;
  const overlaps: Array<[string, string, string]> = [
    ["Poonachi", "0-40 km", "40-60 km"],
    ["Ammapettai", "40-60 km", "60-90 km"],
    ["Thoppur", "60-90 km", "90-110 km"],
    ["Vellakovil", "60-90 km", "90-110 km"],
    ["Muthur", "90-110 km", "110-160 km"],
  ];
  for (const [place, a, b] of overlaps) {
    ok(`${place} is in ${a}`, by(a).includes(place));
    ok(`${place} is in ${b}`, by(b).includes(place));
  }
  // The overlaps are exactly why a zone is picked by a human and never
  // inferred from free text — asserted as documentation, not behaviour.
  ok("there are overlaps to be careful about", overlaps.length > 0);
});

/** The additions on this revision of the sheet. */
const additions = tc("RATE-06", "the new sheet's additions are present", () => {
  const by = (label: string) => DELIVERY_ZONE_DEFS.find((d) => d.distanceLabel === label)!;
  ok("Karnataka band exists", !!by("Karnataka"));
  eq("Karnataka 6\"", by("Karnataka").compound6, 44);
  eq("Karnataka 8\"", by("Karnataka").compound8, 54);
  ok("Chennampatti added to 0-40", by("0-40 km").areas.includes("Chennampatti"));
  ok("Poonachi added to 0-40", by("0-40 km").areas.includes("Poonachi"));
  ok("Chinnappampatti added to 40-60", by("40-60 km").areas.includes("Chinnappampatti"));
  ok("Kannakurichi added to 60-90", by("60-90 km").areas.includes("Kannakurichi"));
  ok("Thingalur added to 90-110", by("90-110 km").areas.includes("Thingalur"));
  ok("Pasur added to 90-110", by("90-110 km").areas.includes("Pasur"));
  ok("Uthangarai added to 110-160", by("110-160 km").areas.includes("Uthangarai"));
});

/** Zone names must be unique, since the seeder upserts on them. */
const uniqueNames = tc("RATE-07", "zone names and labels are unique", () => {
  const names = DELIVERY_ZONE_DEFS.map((d) => d.name);
  eq("names are unique", names.length, new Set(names).size);
  const labels = DELIVERY_ZONE_DEFS.map((d) => d.distanceLabel);
  eq("distance labels are unique", labels.length, new Set(labels).size);
  // A rename target must not collide with a name still in use.
  const renames = DELIVERY_ZONE_DEFS.flatMap((d) => d.renameFrom ?? []);
  for (const r of renames) {
    ok(`${r} is not also a current name`, !names.includes(r));
  }
});

// ───────────────────────── against the database ──────────────────────────

/**
 * AC: a quotation actually prices at the chart rate, for every band.
 *
 * The transcription tests above check the DATA. This checks the path a
 * telecaller takes, which is the only thing that reaches a customer.
 */
const quotesAtChartRate = tc("RATE-08", "quotations price at the chart rate", async () => {
  const [sizes, room, compound] = await Promise.all([
    prisma.brickSize.findMany(),
    prisma.constructionType.findFirst({ where: { name: "Room" } }),
    prisma.constructionType.findFirst({ where: { name: "Compound" } }),
  ]);
  const digits = (s: string) => s.replace(/[^0-9]/g, "");
  const size6 = sizes.find((s) => digits(s.label) === "6");
  const size8 = sizes.find((s) => digits(s.label) === "8");
  if (!size6 || !size8 || !room || !compound) {
    return ok("fixtures present (run the zone + price seeds first)", false);
  }

  let checked = 0;
  for (const def of DELIVERY_ZONE_DEFS) {
    const zone = await prisma.deliveryZone.findUnique({ where: { name: def.name } });
    if (!zone) {
      ok(`${def.distanceLabel}: zone seeded`, false, `no DeliveryZone named ${def.name}`);
      continue;
    }
    // Order above the band's own minimum so the quote is not refused for a
    // reason this test is not about.
    const qty = Math.max(def.minBricks6, def.minBricks8, 1) + 500;

    const [c, r] = await Promise.all([
      resolveQuotationItems(
        [{ brickSizeId: size6.id, constructionTypeId: compound.id, quantity: qty }],
        zone.id
      ),
      resolveQuotationItems(
        [{ brickSizeId: size8.id, constructionTypeId: room.id, quantity: qty }],
        zone.id
      ),
    ]);
    eq(`${def.distanceLabel}: 6" Compound quotes at the chart rate`, c[0].unitPrice, def.compound6);
    eq(`${def.distanceLabel}: 8" Room quotes at the chart rate`, r[0].unitPrice, def.room8);
    eq(`${def.distanceLabel}: line total`, c[0].total, def.compound6 * qty);
    checked++;
  }
  eq("every band was priced through the quote path", checked, DELIVERY_ZONE_DEFS.length);
});

/** AC: the band minimums are enforced, and an agreed price releases them. */
const minimums = tc("RATE-09", "a short load is refused at the chart minimum", async () => {
  const sizes = await prisma.brickSize.findMany();
  const compound = await prisma.constructionType.findFirst({ where: { name: "Compound" } });
  const digits = (s: string) => s.replace(/[^0-9]/g, "");
  const size6 = sizes.find((s) => digits(s.label) === "6");
  if (!size6 || !compound) return ok("fixtures present", false);

  // Every band that has a 6" minimum must enforce it.
  let tested = 0;
  for (const def of DELIVERY_ZONE_DEFS.filter((d) => d.minBricks6 > 0)) {
    const zone = await prisma.deliveryZone.findUnique({ where: { name: def.name } });
    if (!zone) continue;
    const line = { brickSizeId: size6.id, constructionTypeId: compound.id };

    let refused = false;
    try {
      await resolveQuotationItems([{ ...line, quantity: def.minBricks6 - 1 }], zone.id);
    } catch (e) {
      refused = /minimum/i.test(e instanceof Error ? e.message : "");
    }
    ok(`${def.distanceLabel}: one brick under the minimum is refused`, refused);

    const atMin = await resolveQuotationItems([{ ...line, quantity: def.minBricks6 }], zone.id);
    eq(`${def.distanceLabel}: exactly the minimum is accepted`, atMin[0].unitPrice, def.compound6);

    // An agreed price is the documented way past the minimum.
    const override = await resolveQuotationItems(
      [{ ...line, quantity: 100, unitPrice: 70 }],
      zone.id
    );
    eq(`${def.distanceLabel}: a typed price releases the minimum`, override[0].unitPrice, 70);
    tested++;
  }
  ok(`bands with a minimum were tested (${tested})`, tested >= 4);
});

/**
 * The flat BrickPrice matrix is the 0-20 km band — an assumption recorded in
 * MEMORY, pinned here so the two cannot drift apart.
 */
const baseMatrix = tc("RATE-10", "the flat matrix matches the 0-20 km band", async () => {
  const [sizes, room, compound] = await Promise.all([
    prisma.brickSize.findMany(),
    prisma.constructionType.findFirst({ where: { name: "Room" } }),
    prisma.constructionType.findFirst({ where: { name: "Compound" } }),
  ]);
  const digits = (s: string) => s.replace(/[^0-9]/g, "");
  const size6 = sizes.find((s) => digits(s.label) === "6");
  const size8 = sizes.find((s) => digits(s.label) === "8");
  if (!size6 || !size8 || !room || !compound) return ok("fixtures present", false);

  const base = DELIVERY_ZONE_DEFS.find((d) => d.distanceLabel === "0-20 km")!;
  const want: Array<[string, string, string, number]> = [
    ['6" Compound', size6.id, compound.id, base.compound6],
    ['8" Compound', size8.id, compound.id, base.compound8],
    ['6" Room', size6.id, room.id, base.room6],
    ['8" Room', size8.id, room.id, base.room8],
  ];
  for (const [label, brickSizeId, constructionTypeId, price] of want) {
    const row = await prisma.brickPrice.findUnique({
      where: { brickSizeId_constructionTypeId: { brickSizeId, constructionTypeId } },
    });
    ok(`${label}: priced`, !!row);
    if (row) eq(`${label}: matches the 0-20 band`, row.sellPrice, price);
  }
});

(async () => {
  try {
    await run("Rate chart", [
      transcription,
      monotonic,
      dindigul,
      namedBands,
      knownOverlaps,
      additions,
      uniqueNames,
      quotesAtChartRate,
      minimums,
      baseMatrix,
    ]);
  } finally {
    await prisma.$disconnect();
  }
})();
