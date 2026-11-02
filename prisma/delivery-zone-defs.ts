// Transcribed from the owner-supplied "AREA RATE RD BRICKS" reference sheet.
// Only 6" and 8" bricks appear on that sheet (6"H is not covered — it falls
// back to the flat BrickPrice matrix for any zone, same as any size with no
// ZonePrice row). "C" = Compound, "R" = Room (existing ConstructionType
// names) — confirmed with the owner, not a guess. The last two rows have no
// C/R split in the source sheet, so the same price is used for both.
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
    areas: "Kunjandiyur, Guruvarediyur, Nangavalli, Jalagandapuram",
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
      "Tharamangalam, Elampillai, Mecheri, Anthiyur, Nerinjpettai, Pottaneri, Omalur, Edappadi, Chithar, Konaganapuram, Ennamangalam, Ammapettai, Konganapuram, Koneripattai, Poonachi",
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
      "Salem, Erode, Sankagiri, Veppadi, Pallipalayam, Nariyanur, Kakapalayam, Karuppur, Vaikundam, Komarapalayam, Erumapalayam, Thoppur, Bhavani, Athani, Vellakovil, Pannapatti, Appakudal, Udaiyapatti, Kavindapadi, Gobi, Ammapettai (Salem), Chittode, Ariyanur, Uthukuli, Thindal, Chinnathirupathi, Vellode, Magundansaradi, Modamangalam",
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
      "Kunnathur, Avinashi, Perundurai, Valapadi, Ayothayapattinam, Annur, Sathyamangalam, Nambiyur, Thiruchengode, Modakurichi, Pennagaram, Thoppur, Rasipuram, Chennaimalai, Muthur, Archalur, Solar, Kangeyam, Sivagiri, Mallasamuthiram, Kodumudai, Vaiyappamalai, Hasthampatti, Mallur, Vennadur, Perumanallur, Chengapalli, Paramathivelur, Gorimedu, Attayampatti, Panamarathupattai, Bommidi, Eriyur",
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
    areas:
      "Coimbatore, Dharmapuri, Hosur, Krishnagiri, Namakkal, Tirupur, Attur, Puliyampatti, Karumandurai, Muthur, Ranipettai, Harur, Karur, Pollachi, Thalaivasal, Dindigul",
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
    name: "Other districts (160-300 km)",
    distanceLabel: "160-300 km",
    areas: "Other districts",
    minBricks6: 0,
    minBricks8: 0,
    transportOnly6: null,
    transportOnly8: null,
    compound6: 58,
    compound8: 73,
    room6: 58,
    room8: 73,
  },
  {
    name: "Other districts (300 km & above)",
    distanceLabel: "300 km & above",
    areas: "Other districts",
    minBricks6: 0,
    minBricks8: 0,
    transportOnly6: null,
    transportOnly8: null,
    compound6: 61,
    compound8: 78,
    room6: 61,
    room8: 78,
  },
];
