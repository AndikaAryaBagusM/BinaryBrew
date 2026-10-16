// Tables, columns, enums, keys and plain indexes from docs/05 §3.
// Check constraints, partial/expression indexes, functions, triggers and views
// live in the hand-written SQL migration. Constraint names match docs/05, or
// the PostgreSQL default name where docs/05 leaves one unnamed, so that
// tests/db/schema.test.ts can compare the migrated database with the doc DDL.
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// Foreign key with the PostgreSQL default name: <table>_<column>_fkey.
function fk(table: string, column: AnyPgColumn, target: AnyPgColumn) {
  return foreignKey({
    name: `${table}_${column.name}_fkey`,
    columns: [column],
    foreignColumns: [target],
  });
}

const id = () => uuid("id").primaryKey().defaultRandom();
const ledgerId = () =>
  bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity();
const timestamptz = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => timestamptz("created_at").notNull().defaultNow();
const updatedAt = () => timestamptz("updated_at").notNull().defaultNow();
const qty = (name: string) => numeric(name, { precision: 14, scale: 3 });

// ============================================================
// 3.1 Enums
// ============================================================
export const userRole = pgEnum("user_role", ["owner", "staff", "barista"]);
export const deviceKind = pgEnum("device_kind", [
  "counter",
  "kitchen",
  "other",
]);
export const orderChannel = pgEnum("order_channel", ["self_order", "counter"]);
export const orderStatus = pgEnum("order_status", [
  "awaiting_payment",
  "paid",
  "preparing",
  "ready",
  "completed",
  "expired",
  "voided",
]);
export const paymentMethod = pgEnum("payment_method", [
  "qris_dynamic",
  "qris_static_manual",
  "cash",
]);
export const paymentStatus = pgEnum("payment_status", [
  "pending",
  "paid",
  "failed",
  "expired",
  "refunded",
]);
export const refundStatus = pgEnum("refund_status", ["requested", "processed"]);
export const ingredientKind = pgEnum("ingredient_kind", ["raw", "resale"]);
export const stockMovementType = pgEnum("stock_movement_type", [
  "opening",
  "restock",
  "sale_deduction",
  "void_return",
  "waste",
  "count_adjustment",
]);
export const recoAction = pgEnum("reco_action", [
  "shown",
  "accepted",
  "rejected",
]);

// ============================================================
// 3.2 Access
// ============================================================
export const users = pgTable("users", {
  id: id(),
  name: text("name").notNull(),
  role: userRole("role").notNull(),
  email: text("email"),
  passwordHash: text("password_hash"),
  pinHash: text("pin_hash").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  failedPinAttempts: integer("failed_pin_attempts").notNull().default(0),
  lockedUntil: timestamptz("locked_until"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const devices = pgTable(
  "devices",
  {
    id: id(),
    name: text("name").notNull(),
    kind: deviceKind("kind").notNull().default("counter"),
    tokenHash: text("token_hash").notNull().unique("devices_token_hash_key"),
    registeredBy: uuid("registered_by"),
    registeredAt: timestamptz("registered_at").notNull().defaultNow(),
    lastSeenAt: timestamptz("last_seen_at"),
    revokedAt: timestamptz("revoked_at"),
  },
  (t) => [fk("devices", t.registeredBy, users.id)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id").notNull(),
    deviceId: uuid("device_id"),
    tokenHash: text("token_hash").notNull().unique("sessions_token_hash_key"),
    createdAt: createdAt(),
    lastActivityAt: timestamptz("last_activity_at").notNull().defaultNow(),
    expiresAt: timestamptz("expires_at").notNull(),
    revokedAt: timestamptz("revoked_at"),
  },
  (t) => [
    fk("sessions", t.userId, users.id).onDelete("cascade"),
    fk("sessions", t.deviceId, devices.id),
    index("sessions_user_idx").on(t.userId),
  ],
);

export const elevations = pgTable(
  "elevations",
  {
    id: id(),
    sessionId: uuid("session_id").notNull(),
    ownerUserId: uuid("owner_user_id").notNull(),
    scope: text("scope").notNull(),
    expiresAt: timestamptz("expires_at").notNull(),
    usedAt: timestamptz("used_at"),
    createdAt: createdAt(),
  },
  (t) => [
    fk("elevations", t.sessionId, sessions.id).onDelete("cascade"),
    fk("elevations", t.ownerUserId, users.id),
  ],
);

// ============================================================
// 3.3 Catalog
// ============================================================
export const categories = pgTable("categories", {
  id: id(),
  name: text("name").notNull().unique("categories_name_key"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
});

export const menuItems = pgTable(
  "menu_items",
  {
    id: id(),
    categoryId: uuid("category_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    price: integer("price").notNull(),
    imageUrl: text("image_url"),
    isActive: boolean("is_active").notNull().default(true),
    isPromoted: boolean("is_promoted").notNull().default(false),
    manualSoldOut: boolean("manual_sold_out").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    fk("menu_items", t.categoryId, categories.id),
    index("menu_items_category_idx").on(t.categoryId, t.sortOrder),
  ],
);

export const ingredients = pgTable("ingredients", {
  id: id(),
  name: text("name").notNull().unique("ingredients_name_key"),
  kind: ingredientKind("kind").notNull().default("raw"),
  unit: text("unit").notNull(),
  stockQty: qty("stock_qty")
    .notNull()
    .default(sql`0`),
  avgCost: numeric("avg_cost", { precision: 14, scale: 4 })
    .notNull()
    .default(sql`0`),
  minStockQty: qty("min_stock_qty")
    .notNull()
    .default(sql`0`),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const recipeItems = pgTable(
  "recipe_items",
  {
    menuItemId: uuid("menu_item_id").notNull(),
    ingredientId: uuid("ingredient_id").notNull(),
    qty: numeric("qty", { precision: 12, scale: 3 }).notNull(),
  },
  (t) => [
    primaryKey({
      name: "recipe_items_pkey",
      columns: [t.menuItemId, t.ingredientId],
    }),
    fk("recipe_items", t.menuItemId, menuItems.id).onDelete("cascade"),
    fk("recipe_items", t.ingredientId, ingredients.id),
  ],
);

export const modifierGroups = pgTable("modifier_groups", {
  id: id(),
  name: text("name").notNull(),
  minSelect: smallint("min_select").notNull().default(0),
  maxSelect: smallint("max_select").notNull().default(1),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
});

export const modifierOptions = pgTable(
  "modifier_options",
  {
    id: id(),
    groupId: uuid("group_id").notNull(),
    name: text("name").notNull(),
    priceDelta: integer("price_delta").notNull().default(0),
    isDefault: boolean("is_default").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    fk("modifier_options", t.groupId, modifierGroups.id).onDelete("cascade"),
    index("modifier_options_group_idx").on(t.groupId, t.sortOrder),
  ],
);

export const menuItemModifierGroups = pgTable(
  "menu_item_modifier_groups",
  {
    menuItemId: uuid("menu_item_id").notNull(),
    groupId: uuid("group_id").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    primaryKey({
      name: "menu_item_modifier_groups_pkey",
      columns: [t.menuItemId, t.groupId],
    }),
    fk("menu_item_modifier_groups", t.menuItemId, menuItems.id).onDelete(
      "cascade",
    ),
    fk("menu_item_modifier_groups", t.groupId, modifierGroups.id).onDelete(
      "cascade",
    ),
  ],
);

export const modifierOptionIngredients = pgTable(
  "modifier_option_ingredients",
  {
    optionId: uuid("option_id").notNull(),
    ingredientId: uuid("ingredient_id").notNull(),
    qtyDelta: numeric("qty_delta", { precision: 12, scale: 3 }).notNull(),
  },
  (t) => [
    primaryKey({
      name: "modifier_option_ingredients_pkey",
      columns: [t.optionId, t.ingredientId],
    }),
    fk("modifier_option_ingredients", t.optionId, modifierOptions.id).onDelete(
      "cascade",
    ),
    fk("modifier_option_ingredients", t.ingredientId, ingredients.id),
  ],
);

// ============================================================
// 3.4 Orders and payments
// ============================================================
export const qrTokens = pgTable("qr_tokens", {
  id: id(),
  label: text("label").notNull(),
  token: text("token").notNull().unique("qr_tokens_token_key"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
  rotatedAt: timestamptz("rotated_at"),
});

export const queueCounters = pgTable("queue_counters", {
  businessDate: date("business_date").primaryKey(),
  lastNumber: integer("last_number").notNull().default(0),
});

export const orders = pgTable(
  "orders",
  {
    id: id(),
    publicToken: text("public_token")
      .notNull()
      .unique("orders_public_token_key"),
    businessDate: date("business_date").notNull(),
    queueNumber: integer("queue_number"),
    channel: orderChannel("channel").notNull(),
    status: orderStatus("status").notNull().default("awaiting_payment"),
    qrTokenId: uuid("qr_token_id"),
    createdBy: uuid("created_by"),
    clientSession: text("client_session"),
    subtotal: integer("subtotal").notNull(),
    serviceChargeBps: integer("service_charge_bps").notNull().default(0),
    serviceCharge: integer("service_charge").notNull().default(0),
    taxRateBps: integer("tax_rate_bps").notNull().default(0),
    taxAmount: integer("tax_amount").notNull().default(0),
    taxInclusive: boolean("tax_inclusive").notNull().default(true),
    total: integer("total").notNull(),
    expiresAt: timestamptz("expires_at"),
    paidAt: timestamptz("paid_at"),
    preparingAt: timestamptz("preparing_at"),
    readyAt: timestamptz("ready_at"),
    completedAt: timestamptz("completed_at"),
    voidedAt: timestamptz("voided_at"),
    voidedBy: uuid("voided_by"),
    voidReason: text("void_reason"),
    isSeed: boolean("is_seed").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    fk("orders", t.qrTokenId, qrTokens.id),
    fk("orders", t.createdBy, users.id),
    fk("orders", t.voidedBy, users.id),
    index("orders_status_idx").on(t.status, t.createdAt),
    index("orders_business_date_idx").on(t.businessDate),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: id(),
    orderId: uuid("order_id").notNull(),
    menuItemId: uuid("menu_item_id").notNull(),
    nameSnapshot: text("name_snapshot").notNull(),
    unitPrice: integer("unit_price").notNull(),
    modifiersTotal: integer("modifiers_total").notNull().default(0),
    quantity: smallint("quantity").notNull(),
    lineTotal: integer("line_total").notNull(),
    unitCogs: integer("unit_cogs"),
  },
  (t) => [
    fk("order_items", t.orderId, orders.id).onDelete("cascade"),
    fk("order_items", t.menuItemId, menuItems.id),
    index("order_items_order_idx").on(t.orderId),
    index("order_items_menu_idx").on(t.menuItemId),
  ],
);

export const orderItemModifiers = pgTable(
  "order_item_modifiers",
  {
    id: id(),
    orderItemId: uuid("order_item_id").notNull(),
    modifierOptionId: uuid("modifier_option_id"),
    groupNameSnapshot: text("group_name_snapshot").notNull(),
    optionNameSnapshot: text("option_name_snapshot").notNull(),
    priceDeltaSnapshot: integer("price_delta_snapshot").notNull().default(0),
    ingredientDeltas: jsonb("ingredient_deltas")
      .notNull()
      .default(sql`'[]'::jsonb`),
  },
  (t) => [
    fk("order_item_modifiers", t.orderItemId, orderItems.id).onDelete(
      "cascade",
    ),
    fk("order_item_modifiers", t.modifierOptionId, modifierOptions.id).onDelete(
      "set null",
    ),
    index("order_item_modifiers_item_idx").on(t.orderItemId),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: id(),
    orderId: uuid("order_id").notNull(),
    method: paymentMethod("method").notNull(),
    status: paymentStatus("status").notNull().default("pending"),
    amount: integer("amount").notNull(),
    provider: text("provider"),
    providerRef: text("provider_ref"),
    qrString: text("qr_string"),
    expiresAt: timestamptz("expires_at"),
    paidAt: timestamptz("paid_at"),
    confirmedBy: uuid("confirmed_by"),
    elevationId: uuid("elevation_id"),
    manualReference: text("manual_reference"),
    manualNote: text("manual_note"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    fk("payments", t.orderId, orders.id),
    fk("payments", t.confirmedBy, users.id),
    fk("payments", t.elevationId, elevations.id),
    index("payments_order_idx").on(t.orderId),
  ],
);

export const paymentEvents = pgTable(
  "payment_events",
  {
    id: ledgerId(),
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    payload: jsonb("payload").notNull(),
    receivedAt: timestamptz("received_at").notNull().defaultNow(),
    processedAt: timestamptz("processed_at"),
    outcome: text("outcome"),
  },
  (t) => [
    unique("payment_events_provider_event_id_key").on(t.provider, t.eventId),
  ],
);

export const refunds = pgTable(
  "refunds",
  {
    id: id(),
    orderId: uuid("order_id").notNull(),
    paymentId: uuid("payment_id").notNull(),
    amount: integer("amount").notNull(),
    reason: text("reason").notNull(),
    status: refundStatus("status").notNull().default("requested"),
    requestedBy: uuid("requested_by").notNull(),
    approvedBy: uuid("approved_by").notNull(),
    gatewayRef: text("gateway_ref"),
    createdAt: createdAt(),
    processedAt: timestamptz("processed_at"),
  },
  (t) => [
    fk("refunds", t.orderId, orders.id),
    fk("refunds", t.paymentId, payments.id),
    fk("refunds", t.requestedBy, users.id),
    fk("refunds", t.approvedBy, users.id),
    index("refunds_order_idx").on(t.orderId),
  ],
);

// ============================================================
// 3.5 Inventory
// ============================================================
export const suppliers = pgTable("suppliers", {
  id: id(),
  name: text("name").notNull().unique("suppliers_name_key"),
  note: text("note"),
  isActive: boolean("is_active").notNull().default(true),
});

export const restocks = pgTable(
  "restocks",
  {
    id: id(),
    ingredientId: uuid("ingredient_id").notNull(),
    supplierId: uuid("supplier_id"),
    quantity: qty("quantity").notNull(),
    totalCost: integer("total_cost").notNull(),
    unitCost: numeric("unit_cost", {
      precision: 14,
      scale: 4,
    }).generatedAlwaysAs(sql`total_cost / quantity`),
    purchasedOn: date("purchased_on")
      .notNull()
      .default(sql`current_date`),
    createdBy: uuid("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    fk("restocks", t.ingredientId, ingredients.id),
    fk("restocks", t.supplierId, suppliers.id),
    fk("restocks", t.createdBy, users.id),
    index("restocks_ingredient_idx").on(t.ingredientId, t.purchasedOn),
  ],
);

export const stockMovements = pgTable(
  "stock_movements",
  {
    id: ledgerId(),
    ingredientId: uuid("ingredient_id").notNull(),
    type: stockMovementType("type").notNull(),
    qtyDelta: qty("qty_delta").notNull(),
    refType: text("ref_type"),
    refId: text("ref_id"),
    note: text("note"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
  },
  (t) => [
    fk("stock_movements", t.ingredientId, ingredients.id),
    fk("stock_movements", t.createdBy, users.id),
    index("stock_movements_ingredient_idx").on(t.ingredientId, t.createdAt),
    index("stock_movements_ref_idx").on(t.refType, t.refId),
  ],
);

export const stockCounts = pgTable(
  "stock_counts",
  {
    id: id(),
    countedAt: timestamptz("counted_at").notNull().defaultNow(),
    countedBy: uuid("counted_by").notNull(),
    note: text("note"),
  },
  (t) => [fk("stock_counts", t.countedBy, users.id)],
);

export const stockCountItems = pgTable(
  "stock_count_items",
  {
    id: id(),
    stockCountId: uuid("stock_count_id").notNull(),
    ingredientId: uuid("ingredient_id").notNull(),
    systemQty: qty("system_qty").notNull(),
    countedQty: qty("counted_qty").notNull(),
    varianceQty: qty("variance_qty").generatedAlwaysAs(
      sql`counted_qty - system_qty`,
    ),
    reason: text("reason"),
  },
  (t) => [
    fk("stock_count_items", t.stockCountId, stockCounts.id).onDelete("cascade"),
    fk("stock_count_items", t.ingredientId, ingredients.id),
    unique("stock_count_items_stock_count_id_ingredient_id_key").on(
      t.stockCountId,
      t.ingredientId,
    ),
  ],
);

// ============================================================
// 3.6 Recommendations
// ============================================================
export const associationRuleRuns = pgTable("association_rule_runs", {
  id: id(),
  startedAt: timestamptz("started_at").notNull().defaultNow(),
  finishedAt: timestamptz("finished_at"),
  status: text("status").notNull().default("running"),
  transactionsCount: integer("transactions_count"),
  minSupport: numeric("min_support", { precision: 6, scale: 5 }).notNull(),
  minConfidence: numeric("min_confidence", {
    precision: 6,
    scale: 5,
  }).notNull(),
  minLift: numeric("min_lift", { precision: 8, scale: 4 }).notNull(),
  algorithm: text("algorithm").notNull().default("apriori"),
  library: text("library"),
  note: text("note"),
});

export const associationRules = pgTable(
  "association_rules",
  {
    id: id(),
    runId: uuid("run_id").notNull(),
    antecedent: uuid("antecedent").array().notNull(),
    consequentId: uuid("consequent_id").notNull(),
    support: numeric("support", { precision: 6, scale: 5 }).notNull(),
    confidence: numeric("confidence", { precision: 6, scale: 5 }).notNull(),
    lift: numeric("lift", { precision: 8, scale: 4 }).notNull(),
    isActive: boolean("is_active").notNull().default(false),
  },
  (t) => [
    fk("association_rules", t.runId, associationRuleRuns.id).onDelete(
      "cascade",
    ),
    fk("association_rules", t.consequentId, menuItems.id),
    index("association_rules_run_idx").on(t.runId),
  ],
);

export const recommendationEvents = pgTable(
  "recommendation_events",
  {
    id: ledgerId(),
    clientSession: text("client_session").notNull(),
    orderId: uuid("order_id"),
    ruleId: uuid("rule_id"),
    itemId: uuid("item_id").notNull(),
    source: text("source").notNull(),
    score: numeric("score", { precision: 8, scale: 4 }),
    action: recoAction("action").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    fk("recommendation_events", t.orderId, orders.id).onDelete("set null"),
    fk("recommendation_events", t.ruleId, associationRules.id).onDelete(
      "set null",
    ),
    fk("recommendation_events", t.itemId, menuItems.id),
    index("recommendation_events_item_idx").on(t.itemId, t.createdAt),
    index("recommendation_events_order_idx").on(t.orderId),
  ],
);

// ============================================================
// 3.7 System
// ============================================================
export const settings = pgTable(
  "settings",
  {
    key: text("key").primaryKey(),
    value: jsonb("value").notNull(),
    updatedBy: uuid("updated_by"),
    updatedAt: updatedAt(),
  },
  (t) => [fk("settings", t.updatedBy, users.id)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: ledgerId(),
    actorUserId: uuid("actor_user_id"),
    deviceId: uuid("device_id"),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    reason: text("reason"),
    metadata: jsonb("metadata")
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [
    fk("audit_logs", t.actorUserId, users.id),
    fk("audit_logs", t.deviceId, devices.id),
    index("audit_logs_entity_idx").on(t.entityType, t.entityId),
    index("audit_logs_created_idx").on(t.createdAt),
  ],
);
