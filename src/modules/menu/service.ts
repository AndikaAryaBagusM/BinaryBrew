import { type DbExecutor, getDb } from "@/db/client";
import { AppError } from "@/lib/errors";
import { audit, latestAuditByEntity } from "@/modules/audit/service";
import {
  COUNTER_ROLES,
  requireRole,
  type SessionUser,
} from "@/modules/auth/service";
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

  return {
    shopName: settings.shop_name,
    table: qr.label,
    pricing: {
      taxRateBps: settings.tax_rate_bps,
      taxInclusive: settings.tax_inclusive,
      serviceChargeBps: settings.service_charge_bps,
    },
    categories: await loadCategories(),
  };
}

// Active categories with their active items, options and availability. One
// snapshot, so an item cannot show a group that was just unlinked.
function loadCategories(): Promise<PublicMenu["categories"]> {
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

      return categories.map((category) => ({
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
      }));
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

// Counter menu (S-02, S-08, FR-POS-01, FR-POS-04): the same items and rules
// as self-order, also while self-ordering is closed (Flow E9). A sold-out
// item says who marked it and when.

export type CounterMenuItem = PublicMenuItem & {
  // Who marked it and when; both null for an item sold out without a record.
  soldOut: { byName: string | null; at: Date | null } | null;
};

export type CounterMenu = {
  pricing: PricingRates;
  manualPaymentNeedsOwnerPin: boolean;
  categories: { id: string; name: string; items: CounterMenuItem[] }[];
};

const SOLD_OUT_ACTIONS = ["menu_item.sold_out", "menu_item.available"] as const;

export async function getCounterMenu(
  actor: SessionUser | null,
): Promise<CounterMenu> {
  requireRole(actor, COUNTER_ROLES);
  const [settings, categories] = await Promise.all([
    getSettings([
      "tax_rate_bps",
      "tax_inclusive",
      "service_charge_bps",
      "manual_payment_requires_owner_pin",
    ]),
    loadCategories(),
  ]);
  const soldOutIds = categories.flatMap((category) =>
    category.items.filter((item) => !item.isAvailable).map((item) => item.id),
  );
  const marks = await latestAuditByEntity(
    "menu_item",
    soldOutIds,
    SOLD_OUT_ACTIONS,
  );
  return {
    pricing: {
      taxRateBps: settings.tax_rate_bps,
      taxInclusive: settings.tax_inclusive,
      serviceChargeBps: settings.service_charge_bps,
    },
    manualPaymentNeedsOwnerPin: settings.manual_payment_requires_owner_pin,
    categories: categories.map((category) => ({
      ...category,
      items: category.items.map((item) => {
        if (item.isAvailable) return { ...item, soldOut: null };
        const mark = marks.get(item.id);
        return {
          ...item,
          soldOut:
            mark?.action === "menu_item.sold_out"
              ? { byName: mark.actorName, at: mark.at }
              : { byName: null, at: null },
        };
      }),
    })),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// One tap on S-08 (FR-POS-04). The customer menu and checkout read the flag
// on every request, so the change shows there at once. Audited only when the
// flag actually changes.
export async function setManualSoldOut(
  actor: SessionUser | null,
  input: { menuItemId: string; soldOut: boolean },
  { now = new Date() }: { now?: Date } = {},
): Promise<{ menuItemId: string; soldOut: boolean }> {
  const user = requireRole(actor, COUNTER_ROLES);
  if (!UUID.test(input.menuItemId)) throw new AppError("NOT_FOUND");
  await getDb().transaction(async (tx) => {
    const item = await repo.lockActiveItem(input.menuItemId, tx);
    if (!item) throw new AppError("NOT_FOUND");
    if (item.manualSoldOut === input.soldOut) return;
    await repo.setManualSoldOut(item.id, input.soldOut, now, tx);
    await audit(
      {
        action: input.soldOut ? "menu_item.sold_out" : "menu_item.available",
        actor: user,
        entity: { type: "menu_item", id: item.id },
      },
      { db: tx, now },
    );
  });
  return { menuItemId: input.menuItemId, soldOut: input.soldOut };
}

// O-03 Menu management (FR-OW-02, FR-RC-05): the owner's view of every
// category and item, active or not. Items are never deleted, because order
// history points at them: "Nonaktif" hides them from customers and the
// Counter instead. Every change is audited; an update records each changed
// field with its old and new value.

export type OwnerCategory = {
  id: string;
  name: string;
  isActive: boolean;
  itemCount: number;
};

export type OwnerMenuItem = {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  price: number;
  isActive: boolean;
  isPromoted: boolean;
  soldOut: CounterMenuItem["soldOut"];
};

export type OwnerMenu = {
  categories: OwnerCategory[];
  items: OwnerMenuItem[];
};

export async function getOwnerMenu(
  actor: SessionUser | null,
): Promise<OwnerMenu> {
  requireRole(actor, ["owner"]);
  const [categories, items] = await Promise.all([
    repo.selectAllCategories(),
    repo.selectAllItems(),
  ]);
  const marks = await latestAuditByEntity(
    "menu_item",
    items.filter((item) => item.manualSoldOut).map((item) => item.id),
    SOLD_OUT_ACTIONS,
  );
  const counts = groupBy(items, (item) => item.categoryId);
  return {
    categories: categories.map((category) => ({
      id: category.id,
      name: category.name,
      isActive: category.isActive,
      itemCount: counts.get(category.id)?.length ?? 0,
    })),
    items: items.map(({ manualSoldOut, ...item }) => {
      const mark = manualSoldOut ? marks.get(item.id) : undefined;
      return {
        ...item,
        soldOut: !manualSoldOut
          ? null
          : mark?.action === "menu_item.sold_out"
            ? { byName: mark.actorName, at: mark.at }
            : { byName: null, at: null },
      };
    }),
  };
}

export type MenuItemInput = {
  categoryId: string;
  name: string;
  description: string | null;
  price: number;
  isActive: boolean;
  isPromoted: boolean;
};

export async function createMenuItem(
  actor: SessionUser | null,
  input: MenuItemInput,
  { now = new Date() }: { now?: Date } = {},
): Promise<{ id: string }> {
  const owner = requireRole(actor, ["owner"]);
  return getDb().transaction(async (tx) => {
    if (!(await repo.categoryExists(input.categoryId, tx))) {
      throw new AppError("VALIDATION_FAILED", {
        details: { fields: ["categoryId"] },
      });
    }
    const item = await repo.insertMenuItem({ ...input, now }, tx);
    await audit(
      {
        action: "menu_item.create",
        actor: owner,
        entity: { type: "menu_item", id: item.id },
        metadata: { ...input },
      },
      { db: tx, now },
    );
    return item;
  });
}

export async function updateMenuItem(
  actor: SessionUser | null,
  id: string,
  patch: Partial<MenuItemInput>,
  { now = new Date() }: { now?: Date } = {},
): Promise<{ id: string; changed: string[] }> {
  const owner = requireRole(actor, ["owner"]);
  if (!UUID.test(id)) throw new AppError("NOT_FOUND");
  return getDb().transaction(async (tx) => {
    const item = await repo.lockItem(id, tx);
    if (!item) throw new AppError("NOT_FOUND");
    if (
      patch.categoryId !== undefined &&
      patch.categoryId !== item.categoryId &&
      !(await repo.categoryExists(patch.categoryId, tx))
    ) {
      throw new AppError("VALIDATION_FAILED", {
        details: { fields: ["categoryId"] },
      });
    }
    const changes = changedFields(item, patch);
    const changed = Object.keys(changes);
    if (changed.length === 0) return { id, changed };
    await repo.updateMenuItem(
      id,
      Object.fromEntries(changed.map((key) => [key, changes[key]!.to])),
      now,
      tx,
    );
    await audit(
      {
        action: "menu_item.update",
        actor: owner,
        entity: { type: "menu_item", id },
        metadata: { name: item.name, changes },
      },
      { db: tx, now },
    );
    return { id, changed };
  });
}

export async function createCategory(
  actor: SessionUser | null,
  input: { name: string },
  { now = new Date() }: { now?: Date } = {},
): Promise<{ id: string; name: string; isActive: boolean }> {
  const owner = requireRole(actor, ["owner"]);
  return getDb().transaction(async (tx) => {
    await repo.lockCategoryNames(tx);
    if (await repo.findCategoryByName(input.name, null, tx)) {
      throw new AppError("NAME_TAKEN", { details: { fields: ["name"] } });
    }
    const category = await repo.insertCategory(input.name, tx);
    await audit(
      {
        action: "category.create",
        actor: owner,
        entity: { type: "category", id: category.id },
        metadata: { name: category.name },
      },
      { db: tx, now },
    );
    return category;
  });
}

// A switched-off category hides all its items from customers and the
// Counter; the items keep their own setting for when it comes back.
export async function updateCategory(
  actor: SessionUser | null,
  id: string,
  patch: { name?: string; isActive?: boolean },
  { now = new Date() }: { now?: Date } = {},
): Promise<{ id: string; changed: string[] }> {
  const owner = requireRole(actor, ["owner"]);
  if (!UUID.test(id)) throw new AppError("NOT_FOUND");
  return getDb().transaction(async (tx) => {
    await repo.lockCategoryNames(tx);
    const category = await repo.lockCategory(id, tx);
    if (!category) throw new AppError("NOT_FOUND");
    if (
      patch.name !== undefined &&
      (await repo.findCategoryByName(patch.name, id, tx))
    ) {
      throw new AppError("NAME_TAKEN", { details: { fields: ["name"] } });
    }
    const changes = changedFields(category, patch);
    const changed = Object.keys(changes);
    if (changed.length === 0) return { id, changed };
    await repo.updateCategory(
      id,
      Object.fromEntries(changed.map((key) => [key, changes[key]!.to])),
      tx,
    );
    await audit(
      {
        action: "category.update",
        actor: owner,
        entity: { type: "category", id },
        metadata: { name: category.name, changes },
      },
      { db: tx, now },
    );
    return { id, changed };
  });
}

// The fields of a patch whose value differs from the current row.
function changedFields<T extends Record<string, unknown>>(
  current: T,
  patch: Partial<T>,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [key, to] of Object.entries(patch)) {
    if (to !== undefined && current[key] !== to) {
      changes[key] = { from: current[key], to };
    }
  }
  return changes;
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
