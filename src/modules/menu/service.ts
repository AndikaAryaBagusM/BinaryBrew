import { type DbExecutor, getDb } from "@/db/client";
import { AppError } from "@/lib/errors";
import type { PricingItem, PricingRates } from "@/modules/orders/pricing";
import { getSettings } from "@/modules/settings/service";
import * as repo from "./repo";

// Public menu for a table or entrance QR code (FR-CO-01, FR-CO-02, FR-CO-07).
// Read from the database on every call: no cache for prices or availability.

export type PublicModifierOption = {
  id: string;
  name: string;
  priceDelta: number;
  isDefault: boolean;
};

export type PublicModifierGroup = {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: PublicModifierOption[];
};

export type PublicMenuItem = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  imageUrl: string | null;
  isAvailable: boolean;
  modifierGroups: PublicModifierGroup[];
};

export type PublicMenu = {
  shopName: string;
  table: string;
  // Current rates, so the cart shows the total the server will charge.
  pricing: PricingRates;
  categories: { id: string; name: string; items: PublicMenuItem[] }[];
};

// QR tokens are 128-bit base64url (lib/ids.ts); anything else is not looked up.
const QR_TOKEN = /^[A-Za-z0-9_-]{22}$/;

export async function getPublicMenu(qrToken: string): Promise<PublicMenu> {
  if (!QR_TOKEN.test(qrToken)) throw new AppError("QR_INVALID");

  const [qr, settings] = await Promise.all([
    repo.selectActiveQr(qrToken),
    getSettings([
      "shop_name",
      "ordering_enabled",
      "tax_rate_bps",
      "tax_inclusive",
      "service_charge_bps",
    ]),
  ]);
  // A rotated or unknown code (Flow E15) is reported before "closed" (E9).
  if (!qr) throw new AppError("QR_INVALID");
  if (!settings.ordering_enabled) throw new AppError("ORDERING_CLOSED");

  // One snapshot, so an item cannot show a group that was just unlinked.
  return getDb().transaction(
    async (tx) => {
      const [categories, items] = await Promise.all([
        repo.selectActiveCategories(tx),
        repo.selectActiveItems(tx),
      ]);
      const links = await repo.selectItemGroups(
        items.map((item) => item.id),
        tx,
      );
      const options = await repo.selectActiveOptions(
        [...new Set(links.map((link) => link.id))],
        tx,
      );

      const optionsByGroup = groupBy(options, (option) => option.groupId);
      const groupsByItem = groupBy(links, (link) => link.menuItemId);
      const itemsByCategory = groupBy(items, (item) => item.categoryId);

      return {
        shopName: settings.shop_name,
        table: qr.label,
        pricing: {
          taxRateBps: settings.tax_rate_bps,
          taxInclusive: settings.tax_inclusive,
          serviceChargeBps: settings.service_charge_bps,
        },
        categories: categories.map((category) => ({
          id: category.id,
          name: category.name,
          items: (itemsByCategory.get(category.id) ?? []).map((item) => ({
            id: item.id,
            name: item.name,
            description: item.description,
            price: item.price,
            imageUrl: item.imageUrl,
            // P2-03 switches this to the availability view (stock).
            isAvailable: !item.manualSoldOut,
            modifierGroups: (groupsByItem.get(item.id) ?? []).map((group) => ({
              id: group.id,
              name: group.name,
              minSelect: group.minSelect,
              maxSelect: group.maxSelect,
              options: (optionsByGroup.get(group.id) ?? []).map((option) => ({
                id: option.id,
                name: option.name,
                priceDelta: option.priceDelta,
                isDefault: option.isDefault,
              })),
            })),
          })),
        })),
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const list = map.get(key(row));
    if (list) list.push(row);
    else map.set(key(row), [row]);
  }
  return map;
}

// Checkout (Schema §5.1 step 1): the same QR and "ordering on" rules as the
// menu. Returns the QR code's id for the order.
export async function requireOrderingQr(
  qrToken: string,
): Promise<{ qrTokenId: string }> {
  if (!QR_TOKEN.test(qrToken)) throw new AppError("QR_INVALID");
  const [qr, ordering] = await Promise.all([
    repo.selectActiveQr(qrToken),
    getSettings(["ordering_enabled"]),
  ]);
  if (!qr) throw new AppError("QR_INVALID");
  if (!ordering.ordering_enabled) throw new AppError("ORDERING_CLOSED");
  return { qrTokenId: qr.id };
}

export type OrderableItem = PricingItem & { isAvailable: boolean };

// Checkout (Schema §5.1 steps 3-4): current prices, active modifier groups and
// availability for the requested items, read inside the caller's transaction.
// Ids that do not exist are left out. Availability uses the manual flag until
// P2-03 adds stock.
export async function getOrderableItems(
  ids: readonly string[],
  db: DbExecutor,
): Promise<OrderableItem[]> {
  const items = await repo.selectItemsForOrder([...new Set(ids)], db);
  const links = await repo.selectItemGroups(
    items.map((item) => item.id),
    db,
  );
  const options = await repo.selectActiveOptions(
    [...new Set(links.map((link) => link.id))],
    db,
  );
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    price: item.price,
    isAvailable: item.isActive && item.categoryActive && !item.manualSoldOut,
    modifierGroups: links
      .filter((link) => link.menuItemId === item.id)
      .map((group) => ({
        id: group.id,
        name: group.name,
        minSelect: group.minSelect,
        maxSelect: group.maxSelect,
        options: options
          .filter((option) => option.groupId === group.id)
          .map(({ id, name, priceDelta }) => ({ id, name, priceDelta })),
      })),
  }));
}
