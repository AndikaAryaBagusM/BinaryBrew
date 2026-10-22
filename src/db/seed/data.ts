// Seed content (Schema §7, Plan §7). Menu names are placeholders until the
// real menu is known (PRD Q2); prices are whole rupiah.

// Schema §3.9 default settings.
export const defaultSettings: Record<string, unknown> = {
  shop_name: "Binary Brew",
  timezone: "Asia/Jakarta",
  business_day_cutoff: "04:00",
  ordering_enabled: true,
  tax_rate_bps: 0,
  tax_inclusive: true,
  service_charge_bps: 0,
  order_expiry_minutes: 10,
  ready_auto_complete_minutes: 30,
  cash_enabled: false,
  manual_payment_requires_owner_pin: true,
  reco_min_support: 0.02,
  reco_min_confidence: 0.25,
  reco_min_lift: 1.05,
  reco_min_orders: 300,
  reco_promote_weight: 0.5,
  reco_margin_weight: 0.25,
  reco_max_items: 2,
  low_margin_threshold_pct: 30,
  order_retention_months: 24,
};

export const ownerName = "Pemilik";
export const staffNames = ["Rina", "Dimas"] as const;
export const counterDeviceName = "Tablet kasir";

export const categoryNames = [
  "Kopi",
  "Non-kopi",
  "Makanan",
  "Camilan",
] as const;
export type CategoryName = (typeof categoryNames)[number];

export const modifierGroups = [
  {
    name: "Ukuran",
    minSelect: 1,
    maxSelect: 1,
    options: [
      { name: "Regular", priceDelta: 0, isDefault: true },
      { name: "Large", priceDelta: 5000 },
    ],
  },
  {
    name: "Gula",
    minSelect: 1,
    maxSelect: 1,
    options: [
      { name: "Normal", priceDelta: 0, isDefault: true },
      { name: "Kurang manis", priceDelta: 0 },
      { name: "Tanpa gula", priceDelta: 0 },
    ],
  },
  {
    name: "Es",
    minSelect: 1,
    maxSelect: 1,
    options: [
      { name: "Normal", priceDelta: 0, isDefault: true },
      { name: "Sedikit es", priceDelta: 0 },
      { name: "Tanpa es", priceDelta: 0 },
    ],
  },
  {
    name: "Tambahan",
    minSelect: 0,
    maxSelect: 2,
    options: [
      { name: "Extra shot", priceDelta: 5000 },
      { name: "Susu oat", priceDelta: 6000 },
    ],
  },
] as const;
export type ModifierGroupName = (typeof modifierGroups)[number]["name"];

type SeedMenuItem = {
  name: string;
  category: CategoryName;
  price: number;
  description: string;
  modifierGroups: readonly ModifierGroupName[];
  isPromoted?: boolean;
};

const drink = ["Ukuran", "Gula", "Es"] as const;
const coffee = [...drink, "Tambahan"] as const;

export const menuItems: readonly SeedMenuItem[] = [
  {
    name: "Kopi Susu Gula Aren",
    category: "Kopi",
    price: 22000,
    description: "Espresso, susu segar dan gula aren.",
    modifierGroups: coffee,
  },
  {
    name: "Americano",
    category: "Kopi",
    price: 18000,
    description: "Espresso dengan air.",
    modifierGroups: coffee,
  },
  {
    name: "Latte",
    category: "Kopi",
    price: 25000,
    description: "Espresso dengan susu lembut.",
    modifierGroups: coffee,
  },
  {
    name: "Affogato",
    category: "Kopi",
    price: 28000,
    description: "Es krim vanila disiram espresso.",
    modifierGroups: ["Tambahan"],
  },
  {
    name: "Matcha Latte",
    category: "Non-kopi",
    price: 27000,
    description: "Matcha dengan susu segar.",
    modifierGroups: coffee,
  },
  {
    name: "Es Teh Lemon",
    category: "Non-kopi",
    price: 15000,
    description: "Teh dingin dengan perasan lemon.",
    modifierGroups: drink,
  },
  {
    name: "Es Cokelat",
    category: "Non-kopi",
    price: 22000,
    description: "Cokelat dingin dengan susu.",
    modifierGroups: drink,
  },
  {
    name: "Sandwich Ayam",
    category: "Makanan",
    price: 30000,
    description: "Roti isi ayam panggang dan sayuran.",
    modifierGroups: [],
  },
  {
    // Promoted so the demo can show the owner's boost (Plan §7).
    name: "Roti Bakar",
    category: "Makanan",
    price: 20000,
    description: "Roti bakar mentega dengan selai.",
    modifierGroups: [],
    isPromoted: true,
  },
  {
    name: "Croissant",
    category: "Camilan",
    price: 18000,
    description: "Croissant mentega.",
    modifierGroups: [],
  },
  {
    name: "Brownie",
    category: "Camilan",
    price: 16000,
    description: "Brownie cokelat padat.",
    modifierGroups: [],
  },
  {
    name: "Kentang Goreng",
    category: "Camilan",
    price: 18000,
    description: "Kentang goreng renyah.",
    modifierGroups: [],
  },
];

export const qrLabels = [
  "Pintu masuk",
  "Meja 1",
  "Meja 2",
  "Meja 3",
  "Meja 4",
  "Meja 5",
  "Meja 6",
] as const;
