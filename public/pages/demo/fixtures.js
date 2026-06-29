/** @file Seed RSVP rows for the admin-table preview harness (table-host.js).
 *  Shape matches Types.RSVPsResponse.rsvps so the REAL rsvps.js renders them.
 *  Local demo data only — no real guests. */

export const SEED_RSVPS = [
  {
    name: "Alice Thompson",
    attending: true,
    actual_party_size: 2,
    dietary_restrictions: "Vegetarian",
    message: "Can't wait to celebrate with you both!",
    submitted_at: "2026-03-02T18:30:00Z",
  },
  {
    name: "Marcus & Dana Lee",
    attending: true,
    actual_party_size: 4,
    dietary_restrictions: "Nut allergy (one guest)",
    message: "The kids are so excited for the dance floor.",
    submitted_at: "2026-03-05T14:05:00Z",
  },
  {
    name: "Priya Nair",
    attending: false,
    actual_party_size: 1,
    dietary_restrictions: "",
    message: "So sorry to miss it — sending all my love!",
    submitted_at: "2026-03-06T09:12:00Z",
  },
  {
    name: "Tom Becker",
    attending: true,
    actual_party_size: 1,
    dietary_restrictions: "Gluten-free",
    message: "",
    submitted_at: "2026-03-07T20:48:00Z",
  },
  {
    name: "The Okafor Family",
    attending: true,
    actual_party_size: 5,
    dietary_restrictions: "No shellfish",
    message: "Three generations coming — thank you for having us!",
    submitted_at: "2026-03-09T11:00:00Z",
  },
  {
    name: "Jordan Riley",
    attending: false,
    actual_party_size: 2,
    dietary_restrictions: "",
    message: "Travel fell through at the last minute, gutted to miss it.",
    submitted_at: "2026-03-10T16:20:00Z",
  },
]
