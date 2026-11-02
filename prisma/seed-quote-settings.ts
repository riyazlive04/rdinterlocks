import { PrismaClient } from "@prisma/client";

// One-off, idempotent population of the quotation boilerplate fields on
// Settings, reconstructed from the reference letterhead (RD Interlock
// Quotation Salem 17.pdf) the owner supplied. Only ever sets a field that is
// CURRENTLY BLANK, so re-running this after an admin has edited something in
// Settings never clobbers their edit — same safety shape as
// backfill-lead-stages.ts.
//
// IMPORTANT — proofread before this goes to real customers: the Tamil text
// was reconstructed from OCR'd PDF text (Tamil OCR is failure-prone —
// dropped leading characters, mangled vowel-sign ordering) cross-checked
// against the English page for meaning. One discrepancy was found and
// resolved in favour of the English wording rather than guessed: the source
// PDF's Tamil delivery-time line read "7 to 15 working days" while the
// English page says "7-10 Working Days" — this script uses 7-10 on both.
// Edit directly in Settings (once a UI section exists) if that's wrong.
//
//   npx tsx prisma/seed-quote-settings.ts            # dry run (prints only)
//   npx tsx prisma/seed-quote-settings.ts --apply    # writes

const prisma = new PrismaClient();

const TERMS_EN = [
  "Delivery of bricks: 7-10 Working Days.",
  "Mason work will be started after 2-4 days of delivery.",
  "Full Payment for the Bricks including mason labour should be paid (100%) Before delivery.",
  "Quotation Valid for 7 days.",
  "Once brick Delivered Cannot be taken Back.",
  "If vehicle access to the basement is faraway & Shifting Bricks to 1st Floor or above Floors will be Extra charges.",
  "This is an Approximate Quotation, Brick Quantity may vary (+50 or -50).",
  "If Any additional load is given to the Interlock brick wall, should be informed before.",
].join("\n");

const TERMS_TA = [
  "பிரிக்ஸ் டெலிவரி : ஆர்டர் செய்த 7 முதல் 10 வேலை நாட்களுக்குள்.",
  "கட்டுமான பணி : பிரிக்ஸ் டெலிவரி செய்யப்பட்ட 2 முதல் 4 நாட்களுக்குப் பிறகு மேஸ்திரி வேலைகள் தொடங்கப்படும்.",
  "பணம் செலுத்தும் முறை : பிரிக்ஸ் மற்றும் மேஸ்திரி கூலி உட்பட 100% முழுத் தொகையை டெலிவரிக்கு முன்னதாகவே பணம் செலுத்தப்பட வேண்டும்.",
  "காலாவதி : இந்த மதிப்பீடு வழங்கப்பட்ட தேதியிலிருந்து 7 நாட்களுக்கு மட்டும் செல்லுபடியாகும்.",
  "திரும்பப் பெறுதல் : ஒருமுறை டெலிவரி செய்யப்பட்ட பிரிக்ஸ் எக்காரணம் கொண்டும் திரும்பப் பெறப்பட மாட்டாது.",
  "கூடுதல் கட்டணங்கள் : அடித்தளத்திற்கு வாகனங்கள் செல்ல வழி தூரமாக இருந்தாலோ, அல்லது 1வது மாடி மற்றும் அதற்கு மேற்பட்ட தளங்களுக்கு பிரிக்ஸ் எடுத்துச் செல்ல வேண்டியிருந்தாலோ, அதற்கான கூடுதல் கட்டணம் வசூலிக்கப்படும்.",
  "இது ஒரு தோராயமான மதிப்பீடு (Quotation), செங்கல்களின் அளவு மாறுபடலாம் (+50 அல்லது -50).",
  "இன்டர்லாக் சுவரில் ஏதேனும் கூடுதல் சுமை கொடுப்பதாக இருந்தால், சுமை கொடுப்பதற்கு முன்பே தெரிவிக்க வேண்டும்.",
].join("\n");

const OUR_SCOPE_EN = ["(Interlock bricks + Transport + Loading Charges + Laying)", "Only Interlock Brick Work."].join(
  "\n"
);

const OUR_SCOPE_TA = [
  "இன்டர்லாக் பிரிக்ஸ்",
  "போக்குவரத்து",
  "பிரிக்ஸ் ஏற்றுதல் கட்டணம்",
  "கட்டுமான வேலை (இன்டர்லாக் பிரிக்ஸ் வேலை மட்டும்)",
].join("\n");

const CLIENT_SCOPE_EN = [
  "Basement with Tubelevel.",
  "Cement - 2 Bags",
  "M-Sand - 1/4 unit",
  "Vehicle Access near to the site",
  "Pillars / Pillars Plastering / Top sill concrete / Gate fixing",
  "Doors & windows fixing / Tapper plastering / Lintel Beam / Roof",
  "Food & Accommodation for labour",
  "Scaffolding inner & outer sides",
].join("\n");

const CLIENT_SCOPE_TA = [
  "அடித்தளம் டியூப்லெவலுடன் இருக்க வேண்டும்.",
  "சிமெண்ட் - 2 மூட்டை",
  "எம்-சாண்ட் - 1/4 யூனிட்",
  "இடத்திற்கு அருகில் வாகனங்கள் வந்து செல்ல வழி இருக்க வேண்டும்.",
  "தூண்கள் / தூண்களுக்கு பூச்சு வேலை / மேல் மட்ட கான்கிரீட் / கேட் பொருத்துதல்",
  "கதவுகள் & ஜன்னல்கள் பொருத்துதல் / டேப்பர் பிளாஸ்டரிங் / லிண்டல் பீம் / கூரை போடுதல்",
  "தொழிலாளர்களுக்கான உணவு & தங்குமிடம்",
  "உள் மற்றும் வெளிப் பக்கங்களில் சாரக்கட்டு போடுதல்",
].join("\n");

const ADDRESS_TA = "1/314, KPN பெட்ரோல் பங்க் அருகில், கொளத்தூர் - 636303, மேட்டூர் (தாலுகா), சேலம் (மாவட்டம்)";

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(`Seed quotation Settings content — ${apply ? "APPLY" : "DRY RUN"}\n`);

  const settings = await prisma.settings.findUnique({ where: { id: "default" } });
  if (!settings) {
    console.log('No Settings row with id "default" found — run the app once to create it first.');
    return;
  }

  const candidates: Array<[keyof typeof settings, string]> = [
    ["quoteAddressTa", ADDRESS_TA],
    ["quoteTermsEn", TERMS_EN],
    ["quoteTermsTa", TERMS_TA],
    ["quoteOurScopeEn", OUR_SCOPE_EN],
    ["quoteOurScopeTa", OUR_SCOPE_TA],
    ["quoteClientScopeEn", CLIENT_SCOPE_EN],
    ["quoteClientScopeTa", CLIENT_SCOPE_TA],
    ["quoteUpiPayeeName", settings.factoryName || "RD Interlock Bricks"],
  ];

  const data: Record<string, string> = {};
  for (const [field, value] of candidates) {
    const current = settings[field];
    if (typeof current === "string" && current.trim() === "") {
      data[field as string] = value;
      console.log(`  ${apply ? "setting" : "would set"} ${field}`);
    } else {
      console.log(`  skipping ${field} — already has a value`);
    }
  }

  console.log(
    "\nquoteUpiId is intentionally left blank — I can't safely guess your bank/PSP's UPI handle (e.g. @ybl, @okhdfcbank). Set it in Settings once the UI section exists, or ask me to add the field there directly."
  );

  if (Object.keys(data).length === 0) {
    console.log("\nNothing to do — every field already has a value.");
    return;
  }

  if (apply) {
    await prisma.settings.update({ where: { id: "default" }, data });
    console.log(`\nUpdated ${Object.keys(data).length} field(s).`);
  } else {
    console.log("\nDry run only — re-run with --apply to write these changes.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
