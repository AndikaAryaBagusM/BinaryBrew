// Seed content (Schema §7, Plan §7). Menu names are placeholders until the
// real menu is known (PRD Q2); prices are whole rupiah.

// Schema §3.9 default settings, defined once in the settings module.
export { defaultSettings } from "@/modules/settings/definitions";

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

// Phase 2 (Schema §7 step 4): suppliers and ingredients with opening stock.
// Names and quantities follow the Figma O-05 table; base units only (g, ml,
// pcs). The total is what the opening stock cost, so the average cost per
// unit starts right (docs/05 §3.5). Quantities are well above the minimum
// except Susu UHT, so the demo shows one "Menipis".
export const supplierNames = [
  "Roastery Kawan",
  "Toko Susu Sejahtera",
  "Bakery Pagi",
] as const;

type SeedIngredient = {
  name: string;
  kind: "raw" | "resale";
  unit: "g" | "ml" | "pcs";
  minStockQty: string;
  openingQty: string;
  openingTotalCost: number;
};

export const ingredients: readonly SeedIngredient[] = [
  {
    name: "Biji kopi arabika",
    kind: "raw",
    unit: "g",
    minStockQty: "1000",
    openingQty: "3250",
    openingTotalCost: 926_250,
  },
  {
    name: "Susu UHT",
    kind: "raw",
    unit: "ml",
    minStockQty: "2000",
    openingQty: "1800",
    openingTotalCost: 32_220,
  },
  {
    name: "Oat milk",
    kind: "raw",
    unit: "ml",
    minStockQty: "1000",
    openingQty: "2400",
    openingTotalCost: 91_200,
  },
  {
    name: "Gula aren cair",
    kind: "raw",
    unit: "ml",
    minStockQty: "500",
    openingQty: "1500",
    openingTotalCost: 67_500,
  },
  {
    name: "Matcha bubuk",
    kind: "raw",
    unit: "g",
    minStockQty: "100",
    openingQty: "500",
    openingTotalCost: 450_000,
  },
  {
    name: "Cokelat bubuk",
    kind: "raw",
    unit: "g",
    minStockQty: "300",
    openingQty: "1000",
    openingTotalCost: 120_000,
  },
  {
    name: "Es krim vanila",
    kind: "raw",
    unit: "g",
    minStockQty: "500",
    openingQty: "2000",
    openingTotalCost: 120_000,
  },
  {
    name: "Teh celup",
    kind: "raw",
    unit: "pcs",
    minStockQty: "20",
    openingQty: "100",
    openingTotalCost: 70_000,
  },
  {
    name: "Lemon",
    kind: "raw",
    unit: "pcs",
    minStockQty: "10",
    openingQty: "30",
    openingTotalCost: 60_000,
  },
  {
    name: "Es batu",
    kind: "raw",
    unit: "g",
    minStockQty: "5000",
    openingQty: "18000",
    openingTotalCost: 36_000,
  },
  {
    name: "Cup + tutup",
    kind: "raw",
    unit: "pcs",
    minStockQty: "50",
    openingQty: "300",
    openingTotalCost: 360_000,
  },
  {
    name: "Sedotan kertas",
    kind: "raw",
    unit: "pcs",
    minStockQty: "50",
    openingQty: "300",
    openingTotalCost: 45_000,
  },
  {
    name: "Roti tawar",
    kind: "raw",
    unit: "pcs",
    minStockQty: "10",
    openingQty: "40",
    openingTotalCost: 60_000,
  },
  {
    name: "Mentega",
    kind: "raw",
    unit: "g",
    minStockQty: "250",
    openingQty: "1000",
    openingTotalCost: 100_000,
  },
  {
    name: "Ayam fillet",
    kind: "raw",
    unit: "g",
    minStockQty: "1000",
    openingQty: "3000",
    openingTotalCost: 270_000,
  },
  {
    name: "Kentang beku",
    kind: "raw",
    unit: "g",
    minStockQty: "1000",
    openingQty: "5000",
    openingTotalCost: 200_000,
  },
  {
    name: "Croissant Butter",
    kind: "resale",
    unit: "pcs",
    minStockQty: "5",
    openingQty: "20",
    openingTotalCost: 220_000,
  },
  {
    name: "Brownie",
    kind: "resale",
    unit: "pcs",
    minStockQty: "5",
    openingQty: "20",
    openingTotalCost: 150_000,
  },
];
