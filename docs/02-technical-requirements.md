# Binary Brew — Technical Requirements

| | |
|---|---|
| Version | 0.1 (draft) |
| Date | 2026-10-08 |
| Related | [01 PRD](01-product-requirements.md) · [03 App Flow](03-app-flow.md) · [05 Backend Schema](05-backend-schema.md) · [06 Implementation Plan](06-implementation-plan.md) |

Goal: a secure, maintainable web app for one small shop, built and run by one developer, using widely supported tools, with room to grow. It runs **locally first**; GitHub is used for source control only (D8).

---

## 1. Architecture

A **modular monolith**: one Next.js application plus one small worker process, one PostgreSQL database, one Python job.

```mermaid
flowchart LR
  subgraph Clients
    C["Customer phone browser"]
    T["Counter tablet browser"]
    B["TV board browser"]
    O["Owner browser"]
  end
  subgraph App["Next.js app (Node)"]
    UI["Pages and components"]
    API["Route handlers: public, staff, owner, webhooks, SSE"]
    SVC["Module services: orders, payments, inventory, menu, recommendations, auth, reports, settings, audit"]
    UI --> API --> SVC
  end
  W["Worker (Node): expiry sweep, auto-complete, nightly job trigger"]
  J["Apriori job (Python)"]
  PAY["Payment provider: mock now, gateway later"]
  DB[("PostgreSQL 16 in Docker")]

  C --> UI
  T --> UI
  B --> UI
  O --> UI
  SVC --> DB
  W --> DB
  J --> DB
  SVC --> PAY
  PAY -- "webhook" --> API
  DB -. "LISTEN / NOTIFY" .-> API
```

Principles:

- **Business logic lives in module services**, never in route handlers or React components. Route handlers parse input, call a service, and format the response.
- **PostgreSQL is the single source of truth** and the message bus (LISTEN/NOTIFY), so there is no Redis or queue server to run.
- **Money and stock changes are transactional** (see [05 Backend Schema §5](05-backend-schema.md)).
- **Boundaries for growth:** payment provider interface, module folders, and plain SQL migrations. Anything that must change to host, add a screen, or add an outlet is listed in §14.

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node.js (current even-numbered LTS) | Long support window, one language for front and back end. |
| Framework | Next.js (App Router) with TypeScript in `strict` mode | One codebase for customer, counter, board and owner screens; very widely documented. |
| UI | React, Tailwind CSS, a small set of accessible primitives (Radix UI) | Fast, consistent, accessible controls without a heavy design system. |
| Data fetching | Server components for reads; TanStack Query on the counter and status pages | Counter and status pages need live updates and optimistic feedback. |
| Validation | Zod for every request body, query and environment variable | One schema gives types and runtime checks. |
| Database | PostgreSQL 16 | Constraints, partial indexes, `LISTEN/NOTIFY`, array and JSON types are all used. |
| ORM and migrations | Drizzle ORM and drizzle-kit, plus hand-written SQL migrations for constraints/views/triggers | Close to SQL; supports check constraints and partial indexes; typed queries. |
| Auth | Small custom module: opaque server-side sessions in a table | See §9; Auth.js credentials flow cannot give revocable database sessions plus device binding without workarounds. |
| Password/PIN hashing | argon2id (`argon2` package) | Current best practice. |
| Realtime | Server-Sent Events (SSE) fed by Postgres `LISTEN/NOTIFY` | One-way updates only; works through proxies; no extra server. |
| Recommendation job | Python 3 with `mlxtend` (Apriori), `pandas`, `psycopg` | Well-documented and easy to explain in the course FSD. |
| Testing | Vitest (unit, integration), Playwright (end-to-end) | Standard and fast. |
| Quality | ESLint, Prettier, TypeScript `strict`, Husky + lint-staged pre-commit | Keeps one-person code consistent without CI servers. |
| Logging | pino (JSON), redacting secrets | Simple and structured. |
| Containers | Docker Compose for PostgreSQL only | App runs with `npm run dev` for fast iteration. |

Pin exact versions in the lockfile at the end of Phase 0 and record them in `docs/versions.md`. Do not hard-code version claims elsewhere.

## 3. Local environment

`docker-compose.yml` (PostgreSQL only):

```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: binarybrew
      POSTGRES_PASSWORD: binarybrew_dev
      POSTGRES_DB: binarybrew
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U binarybrew"]
      interval: 5s
      retries: 10
volumes:
  pgdata:
```

`.env.example` (copy to `.env`, never commit `.env`):

| Key | Example | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgres://binarybrew:binarybrew_dev@localhost:5432/binarybrew` | App connection |
| `TEST_DATABASE_URL` | `…/binarybrew_test` | Integration tests use a separate database |
| `APP_BASE_URL` | `http://192.168.1.20:3000` | Used in QR codes and receipts; set to the PC's LAN address to test on phones |
| `TOKEN_HASH_PEPPER` | 32+ random bytes | Peppers session/device token hashes |
| `PAYMENT_PROVIDER` | `mock` | `mock` or a real adapter name |
| `PAYMENT_WEBHOOK_SECRET` | random | Signs/verifies webhook payloads |
| `SEED_OWNER_EMAIL`, `SEED_OWNER_PASSWORD`, `SEED_OWNER_PIN`, `SEED_STAFF_PIN`, `SEED_COUNTER_DEVICE_TOKEN` | local only | Used by `db:seed`; the device token is the seeded counter tablet's cookie value (only its hash is stored) |
| `TZ` | `Asia/Jakarta` | Process timezone |

Daily commands (all defined in `package.json`): `npm run dev`, `npm run worker`, `npm run db:up`, `npm run db:migrate`, `npm run db:seed`, `npm run db:reset`, `npm run seed:orders`, `npm run import:orders`, `npm run reco:setup`, `npm run reco:run`, `npm test`, `npm run test:reco`, `npm run test:e2e`, `npm run perf:menu`, `npm run load:test`, `npm run demo:replay-webhook`, `npm run lint`, `npm run typecheck`.

Testing on real phones: phone and PC on the same Wi-Fi; open `http://<PC-LAN-IP>:3000`. Camera QR scanning of `APP_BASE_URL` links works without HTTPS.

## 4. Code structure

```
binary-brew/
├─ docs/                      # these documents
├─ src/
│  ├─ app/                    # Next.js routes (thin): (customer)/, (counter)/, (owner)/, board/, api/
│  ├─ modules/
│  │  ├─ orders/              # service.ts, repo.ts, schemas.ts, pricing.ts, state.ts
│  │  ├─ payments/            # service.ts, repo.ts, provider.ts (interface), providers/mock.ts
│  │  ├─ menu/                # items, categories, modifiers
│  │  ├─ inventory/           # ingredients, recipes, movements, restock, count
│  │  ├─ recommendations/     # service.ts (job, suggestions, events), scoring.ts, schemas.ts, repo.ts
│  │  ├─ auth/                # sessions, pin, devices, elevation, rate-limit
│  │  ├─ reports/
│  │  ├─ settings/
│  │  └─ audit/
│  ├─ db/                     # schema.ts (Drizzle), client.ts, migrations/*.sql, seed/
│  ├─ lib/                    # money.ts, time.ts, errors.ts, logger.ts, ids.ts, sse.ts, use-event-stream.ts
│  ├─ i18n/id.json            # all UI text (Indonesian)
│  └─ components/             # shared UI components
├─ jobs/apriori/              # run.py, job.py, mining.py, db.py, requirements*.txt, tests/
├─ scripts/                   # worker.ts, generate-seed-orders.ts, import-orders-csv.ts
├─ tests/                     # unit/, integration/, e2e/
├─ docker-compose.yml
├─ CLAUDE.md                  # instructions for Claude Code (see plan §3)
└─ package.json
```

Rules:

1. A module may call another module only through its exported service functions (no importing another module's repo).
2. Repos contain SQL/Drizzle queries only; services contain rules; route handlers contain neither.
3. `lib/money.ts` is the only place that does tax and rounding arithmetic.
4. No user-facing text outside `i18n/id.json`.

## 5. Conventions

| Topic | Rule |
|---|---|
| Money | Integer rupiah. Rounding: `Math.round` half-up on non-negative numbers, in `money.ts` only. Format for display with `Intl.NumberFormat('id-ID')`. |
| Time | Store UTC. Convert with `Asia/Jakarta` in `lib/time.ts`. `businessDate(ts, cutoff)` mirrors the SQL function `business_date_of`; a test keeps them equal. |
| IDs | UUID in URLs for staff/owner screens; customers only ever see `public_token` and the queue number. |
| Errors | Typed `AppError` with a stable `code` (`ITEM_SOLD_OUT`, `ORDER_EXPIRED`, `FORBIDDEN`, …). Route handlers map codes to HTTP status and Indonesian messages. |
| Responses | JSON `{ data }` or `{ error: { code, message } }`. |
| Validation | Zod at every boundary; reject unknown fields. |
| Idempotency | Webhooks by `(provider, event_id)`; client order creation by a client-generated `Idempotency-Key` header stored on the order (`orders.idempotency_key`, unique per `client_session`); a retry returns the same order. |
| Feature flags | Settings table, not environment variables, for anything the owner may change. |

## 6. API surface

Auth column: **Public** (no login), **Token** (random link token), **Staff** (any logged-in user with the role), **Owner**, **Elev** (also needs a valid owner elevation, see §9). Names are indicative; keep the structure.

### Customer / public

| Method and path | Auth | Purpose |
|---|---|---|
| `GET /api/public/menu?qr=<token>` | Public | Categories, items (with availability and the promote flag for the "Rekomendasi" tag), modifier groups. Rejects invalid/rotated token. `isAvailable` is false when the item is marked sold out or a recipe ingredient cannot cover one serving (`v_menu_item_availability`, FR-IV-04). |
| `POST /api/public/orders` | Public + rate limit | Create order and payment charge. Body: `qrToken`, `clientSession`, `items[{menuItemId, quantity, modifierOptionIds[]}]`, `recommendationEventIds[]` (optional). Returns `publicToken`, `status`, `total`, `expiresAt` and `payment` (`id`, `qrString`, `amount`, `expiresAt`); the charge is created after the order commits, and a retry with the same key creates it if that failed. 409 `ITEM_SOLD_OUT` (`details.items` `[{menuItemId, name}]`) when an item is inactive, marked sold out or cannot cover one serving; 409 `NOT_ENOUGH_STOCK` (same `details.items`) when the whole order needs more of an ingredient than is in stock (docs/05 §5.1 step 4). |
| `GET /api/public/orders/{publicToken}` | Token | Status, items with options, totals, queue number, payment (QR string only while it can be paid), menu path. `no-store`; 404 for an unknown token. |
| `POST /api/public/orders/{publicToken}/cancel` | Token, same origin | C-05 "Kembali ke keranjang": an unpaid self-order expires now with its pending charge (charge cancelled at the provider, best effort). Any other order is left unchanged (BR-06). Returns `{status}`. |
| `GET /api/stream/orders/{publicToken}` | Token | SSE: `order` events `{status, queueNumber}` for that order, the current state first. 404 for an unknown token. |
| `POST /api/public/recommendations` | Public + rate limit | C-04. Body: `clientSession`, `itemIds[]` (the cart's items), optional `shownEventIds[]`. Returns up to `reco_max_items` `suggestions[{eventId, menuItemId, name, price, source, because[]}]` (`because`: names of the cart items the rule starts from; empty for `promoted`), each logged as `shown`; a suggestion for the same item and rule as one of `shownEventIds` reuses that event. `no-store`. 30 per minute per IP, 20 per `clientSession`. |
| `POST /api/public/recommendations/events` | Public + rate limit | `accepted` or `rejected` for a `shown` event: `clientSession`, `eventId`, `action`. The item, rule, source and score are copied from the shown event; the first answer wins (a repeat returns it). 404 for an event of another client, already linked to an order, or not `shown`. 201 with `{eventId}`. 60 per minute per IP, 30 per `clientSession`. |
| `GET /api/public/board` | Public | `{preparing: number[], ready: number[]}`: queue numbers only (D19), Preparing oldest first, Ready newest first. Every unfinished order, like the Counter queue. Never cached. |
| `GET /api/stream/board` | Public | SSE for the TV board: an empty `change` event when an order enters, moves on or leaves the board, and `sync` once listening; no order data. The board then refetches `GET /api/public/board`. |

### Payments

| Method and path | Auth | Purpose |
|---|---|---|
| `POST /api/webhooks/payments/{provider}` | Signature | Receive payment events. 200 once the event is recorded and processed, duplicates and unknown references included; 401 for a bad signature; 404 for a provider that is not configured; 5xx if processing failed (nothing is kept, so the gateway retries). |
| `POST /api/dev/mock-pay/{paymentId}` | Dev only, same origin | Mock provider: simulate "customer paid". 404 when `PAYMENT_PROVIDER` is not `mock`. |
| `GET /api/dev/counter-device` | Dev only | Sets the counter device cookie from `SEED_COUNTER_DEVICE_TOKEN` and redirects to `/counter/login`. 404 unless `NODE_ENV` is `development` and the variable is set. |

### Auth

| Method and path | Auth | Purpose |
|---|---|---|
| `POST /api/auth/owner-login` | Public + rate limit | Email and password. |
| `GET /api/auth/pin-users` | Registered device | Active users (id, name, role only) for the S-01 name picker. |
| `POST /api/auth/pin-login` | Registered device + rate limit | `userId` + PIN. |
| `POST /api/auth/unlock` | Staff + rate limit | PIN of the signed-in user; clears the S-01 lock overlay on the same session. Wrong PINs count toward the same lockout as `pin-login`. |
| `POST /api/auth/logout` | Staff | End session. |
| `POST /api/auth/elevate` | Staff | Owner PIN → short-lived elevation for one scope. |
| `POST /api/devices/register` | Owner | Register this browser as a counter device. |

### Counter (staff, barista, owner)

| Method and path | Auth | Purpose |
|---|---|---|
| `GET /api/counter/orders?status=` | Staff | Paid queue (`paid`, `preparing`, `ready`), oldest payment first, never cached. The `status` filter for recent orders is not built yet. |
| `GET /api/counter/menu` | Staff | Menu for the POS grid and S-08: categories, items with modifier groups, availability, who marked an item sold out by hand (`soldOut` `{byName, at}`) and the ingredients that cannot cover one serving (`stockShort`, names; P2-03), pricing settings and whether manual confirmation needs the owner PIN. Never cached; ignores `ordering_enabled`. |
| `POST /api/counter/orders` | Staff | Create a walk-in order (same service as self-order, channel `counter`, `created_by` the staff user) and its QRIS charge. `Idempotency-Key` header; 201 for a new order, 200 for a repeat. No open-order cap (BR-11 is per customer device). Optional `recommendationEventIds[]`, as for self-order. The same `ITEM_SOLD_OUT` and `NOT_ENOUGH_STOCK` refusals. |
| `POST /api/counter/recommendations` | Staff | S-02 suggestion row: the same body and service as `POST /api/public/recommendations`, top suggestion only. Answers go to `POST /api/public/recommendations/events`. |
| `GET /api/counter/orders/{id}` | Staff | One order for S-04 and S-06: lines, totals, status times, channel, table label, creator, payment (method, status, QR string while pending, reference). |
| `POST /api/counter/orders/{id}/cancel` | Staff | Cancel an unpaid counter order from S-04 (it becomes `expired`, its charge is cancelled). Any other order is returned unchanged with its status. |
| `POST /api/counter/orders/{id}/status` | Staff/Barista | `preparing`, `ready`, `completed`, one step forward only. 409 `ORDER_STATUS_CHANGED` (with the current status) if the order already moved. |
| `POST /api/counter/orders/{id}/manual-payment` | Staff + Elev (if setting) | Confirm a static-QR payment: `reference` (1–64 chars, required), optional `note`, and `elevationId` (scope `manual_payment`) when `manual_payment_requires_owner_pin` is on. Returns the queue number. 409 `ORDER_STATUS_CHANGED` if the order is no longer awaiting payment; an expired order is revived only if its items are still available (else 409 `ITEM_SOLD_OUT`). Writes `payment.manual_confirm` to `audit_logs`. |
| `POST /api/counter/orders/{id}/void` | Elev | Void with reason (Phase 3). |
| `POST /api/counter/menu-items/{id}/sold-out` | Staff | Set manual sold-out: `{soldOut: boolean}`. Writes `menu_item.sold_out` or `menu_item.available` to `audit_logs` when the flag changes. The customer menu and checkout read it on every request. Only the manual flag: an item sold out by stock stays sold out until a restock covers one serving. |
| `GET /api/counter/restock-options` | Staff (not Barista) | S-09 and O-07 pickers: active ingredients (`id`, `name`, `unit`, `stockQty`, `avgCost`, for the preview) and active suppliers (`id`, `name`). Never cached. |
| `POST /api/counter/restocks` | Staff (not Barista) | S-09 and O-07 (P2-05): `lines[]` (1–20) of `ingredientId`, `quantity` (> 0, up to 3 decimals), `totalCost` (whole rupiah, 0–100,000,000), optional `supplierId` and `purchasedOn` (`YYYY-MM-DD`, default today in the shop's calendar, never later). One transaction (Schema §5.5); the owner uses it too. 201 with each line's `avgCostBefore`, `avgCostAfter` and new `stockQty`. 400 `VALIDATION_FAILED` with `reason` `inactive_ingredient`, `inactive_supplier` or `future_date`. Audits `restock.create` per line (average and stock `from`/`to`). |
| `GET /api/stream/counter` | Staff | SSE: `order` events `{orderId, status, queueNumber}` for new and changed orders, plus one `sync` event once the stream is listening, so a refetch then misses nothing. |

### Owner

Built in Phase 1 (P1-13). Owner only; every change checks the origin, runs in one transaction and writes `audit_logs`. GETs are never cached.

| Method and path | Auth | Purpose |
|---|---|---|
| `GET /api/owner/menu-items` | Owner | O-03: every category (with item count) and every item, active or not, with `isPromoted`, `isAvailable`, who marked it sold out and `stockShort` (ingredients below one serving), and `cost` `{status, hpp}` (P2-06: `complete`, `incomplete` while a recipe ingredient has no cost, or `no_recipe` with a null `hpp`). |
| `POST /api/owner/menu-items` | Owner | Create an item: `categoryId`, `name` (1–60), `price` (whole rupiah, 0–10,000,000), optional `description` (≤ 200), `isActive`, `isPromoted`. 201. Audits `menu_item.create`. |
| `PATCH /api/owner/menu-items/{id}` | Owner | Any subset of those fields (the "Promosikan" switch sends `isPromoted`). Returns `{id, changed}`; audits `menu_item.update` with each changed field's `from` and `to`, only when something changed. Items are never deleted: `isActive: false` hides them. A new price is refused with 409 `PRICE_NEGATIVE` when the item's cheapest allowed option mix would take it below zero. |
| `POST /api/owner/categories` | Owner | Create a category (`name`, unique ignoring case, else 409 `NAME_TAKEN`); it goes last. Audits `category.create`. |
| `PATCH /api/owner/categories/{id}` | Owner | Rename or switch off (`name`, `isActive`); a switched-off category hides its items. 409 `NAME_TAKEN`. Audits `category.update`. |
| `GET /api/owner/users` | Owner | O-13: users (id, name, role, active, last activity). Never PIN or password hashes. |
| `POST /api/owner/users` | Owner | Add a `staff` or `barista` user: `name` (1–40, unique among active users ignoring case, else 409 `NAME_TAKEN`), `role`, `pin` (4–6 digits). 201. Audits `user.create` (name and role only). |
| `POST /api/owner/users/{id}/pin` | Owner | Reset a PIN (`pin`); clears any lockout and ends the user's open sessions. Audits `user.pin_reset`. |
| `GET /api/owner/devices` | Owner | O-13: registered devices with kind, who registered them, last seen and revoked time. Registering uses `POST /api/devices/register`; revoking comes with P3-05. |
| `GET /api/owner/settings` | Owner | O-14: all settings with their current values. |
| `PUT /api/owner/settings` | Owner | Any subset of the O-14 basic keys (`shop_name`, `business_day_cutoff`, `ordering_enabled`, `tax_rate_bps`, `tax_inclusive`, `service_charge_bps`, `order_expiry_minutes`, `manual_payment_requires_owner_pin`, `ready_auto_complete_minutes`, `order_retention_months`, `low_margin_threshold_pct`); other keys are refused. All values are checked before any is written; one `setting.update` row per key that changed. Returns `{changed}`. |
| `GET /api/owner/ingredients` | Owner | O-05: every ingredient, active or not (`kind`, `unit`, `stockQty`, `minStockQty`, `avgCost` as decimal strings, `unitLocked`), and every supplier. |
| `POST /api/owner/ingredients` | Owner | Create an ingredient: `name` (1–60, unique ignoring case, else 409 `NAME_TAKEN`), `kind` (`raw`, `resale`), `unit` (`g`, `ml`, `pcs`), `minStockQty`, `isActive`, optional `opening` `{quantity > 0, totalCost}` (whole rupiah). With an opening, one `opening` movement is written in the same transaction and `avg_cost` = total ÷ quantity (docs/05 §5.5). 201. Audits `ingredient.create`. |
| `PATCH /api/owner/ingredients/{id}` | Owner | Any subset of `name`, `kind`, `unit`, `minStockQty`, `isActive`; stock and cost never change here. The unit is locked once the ingredient has a stock movement or is used in a recipe or modifier (409 `UNIT_LOCKED`). Ingredients are never deleted. Returns `{id, changed}`; audits `ingredient.update` when something changed. |
| `POST /api/owner/suppliers` | Owner | Create a supplier: `name` (1–60, unique ignoring case, else 409 `NAME_TAKEN`), optional `note` (≤ 200), `isActive`. 201. Audits `supplier.create`. |
| `PATCH /api/owner/suppliers/{id}` | Owner | Any subset of those fields; suppliers are switched off, never deleted. 409 `NAME_TAKEN`. Audits `supplier.update`. |
| `GET /api/owner/menu-items/{id}` | Owner | O-06: the item's recipe `[{ingredientId, qty}]` (qty a decimal string in the ingredient's base unit, per serving) and the `groupIds` it offers, in order. `no-store`. |
| `PUT /api/owner/menu-items/{id}/recipe` | Owner | Replace the recipe: `lines` (≤ 30, ingredient ids unique), each `qty` > 0 with up to 3 decimals. A new line needs an active ingredient (else 400 `unknown_ingredient`); a line already in the recipe may keep a switched-off one. An empty list removes the recipe. Returns `{id, changed}`; audits `recipe.update` with `from` and `to` when something changed. |
| `PUT /api/owner/menu-items/{id}/modifier-groups` | Owner | Replace the groups the item offers: `groupIds` (≤ 10, unique), in the order the customer sees them. 409 `MODIFIER_RULE` if a required group has fewer active options than its minimum; 409 `PRICE_NEGATIVE` (with the item names) if any item offering the group could then reach a unit price below zero with its cheapest allowed choice. Audits `menu_item.groups_update` with group names. |
| `GET /api/owner/modifier-groups` | Owner | O-04: every group, active or not, with its options (price change, default, active, `ingredientDeltas`) and the items that offer it. `no-store`. |
| `POST /api/owner/modifier-groups` | Owner | Create a group: `name` (1–60, unique ignoring case, else 409 `NAME_TAKEN`), `minSelect` (0–10), `maxSelect` (1–10, ≥ `minSelect`), `isActive`. It goes last. 201. Audits `modifier_group.create`. |
| `PATCH /api/owner/modifier-groups/{id}` | Owner | Any subset of those fields, checked against the stored values. 409 `MODIFIER_RULE` when the group would have more defaults than `maxSelect`, or (while items offer it) fewer active options than `minSelect`; 409 `PRICE_NEGATIVE` (with the item names) if any item offering the group could then reach a unit price below zero with its cheapest allowed choice. Groups are switched off, never deleted. Audits `modifier_group.update`. |
| `POST /api/owner/modifier-groups/{id}/options` | Owner | Add an option: `name` (unique in the group ignoring case), `priceDelta` (whole rupiah, ±10,000,000), `isDefault`, `isActive`, `ingredientDeltas` `[{ingredientId, qtyDelta}]` (≤ 10, `qtyDelta` ≠ 0 with up to 3 decimals, negative = uses less; active ingredients only). In a single-choice group a new default replaces the old one. Same 409s as above. 201. Audits `modifier_option.create`. |
| `PATCH /api/owner/modifier-options/{id}` | Owner | Any subset of those fields; `ingredientDeltas` replaces the set. Same rules and 409s; options are switched off, never deleted. Audits `modifier_option.update` (with `clearedDefaults` when another default was cleared). |
| `GET /api/owner/low-stock` | Owner | O-02 "Stok menipis" and the nav badge (P2-07, FR-IV-06): `items`, every active ingredient at or below its minimum (`id`, `name`, `unit`, `stockQty`, `minStockQty`, `status` `minus`, `empty` or `low`), Minus first, then Habis, then Menipis, each by name. `no-store`. |
| `GET /api/stream/owner` | Owner | SSE for owner pages (P2-07): `stock` `{ingredientIds}` when a paid sale takes active ingredients from above their minimum to at or below it (`stock.low` on the `stock_events` channel, sent once per crossing), plus one `sync` once listening. Pages then refetch `GET /api/owner/low-stock`; they poll every 60 s, every 10 s while the stream is down. |
| `GET /api/owner/reports/hpp` | Owner | O-09 (P2-06, FR-HP-01, 02, 04): optional `month` (`YYYY-MM`, default the current business month; must be one of `period.months`, the current month back to the first sale, at most 24, else 400). Returns `thresholdPct`; `summary` (`averagePermille` over items with a recipe, `withRecipe`, `lowMargin`, `incomplete`); `items`, every active item with `price`, `status` (`complete`, `incomplete`, `no_recipe`), `hpp`, `margin`, `marginPermille` (tenths of a percent) and `lowMargin` (below the threshold), from the current recipes and average costs, lowest margin first and items without a recipe last; `period` `{month, months, rows, totals}` with the month's paid, non-voided sales per item (`quantity`, `revenue`, `cogs` from `order_items.unit_cogs`, `uncostedQuantity`, and `margin` only when every portion has a cost). `no-store`. |
| `GET /api/owner/reports/hpp/csv` | Owner | The same report as a download, `hpp-margin-YYYY-MM.csv` (UTF-8 with a byte order mark, CRLF): the current table, a blank line, then the month's sales with a total row. A field starting with `=`, `+`, `-` or `@` gets a leading `'`. `no-store`. |

O-03 marks items sold out through `POST /api/counter/menu-items/{id}/sold-out` (the owner is a Counter role).

Later phases:

| Area | Endpoints (all Owner unless noted) |
|---|---|
| Menu | CRUD `/api/owner/categories`, `/menu-items`, `/modifier-groups`, `/modifier-options`; `PUT /menu-items/{id}/recipe`; promote flag via menu item update |
| Inventory | `POST /stock-counts` (Elev `stock_adjustment`). Restocks are built (P2-05) as `POST /api/counter/restocks`, above. |
| Orders | `GET /orders`, `POST /orders/{id}/refund-processed` (Elev) |
| Reports | `GET /reports/sales`, `/best-sellers`, `/peak-hours`, `/stock-variance`, `/recommendations`. `/reports/hpp` is built (P2-06), above. |
| System | `GET/PUT /settings`; users and devices CRUD; `POST /qr-tokens/{id}/rotate`; `GET /audit-logs`; `POST /reco/run` (Phase 3) |

## 7. Realtime

- SSE endpoints subscribe to Postgres `LISTEN order_events` through **one** shared connection per server process, and fan out to open responses.
- Payload is minimal: `{ orderId, status, queueNumber }`. Clients refetch details as needed.
- After any commit that changes an order's status, call `pg_notify('order_events', json)`.
- **Clients must still work if SSE drops:** the status page and Counter screen refetch on reconnect and poll every 10 seconds as a safety net.
- Send a comment heartbeat every 20 seconds to keep proxies from closing idle streams.
- Server: `lib/sse.ts` builds the stream response (`retry:`, heartbeat, cleanup on disconnect); `modules/orders/events.ts` holds the shared LISTEN connection. Client: the TV board, status page and Counter use `lib/use-event-stream.ts`, which refetches (TanStack Query) on every event and every reconnect.

## 8. Payments

`src/modules/payments/provider.ts` defines the interface; the app only talks to it.

```ts
export interface PaymentProvider {
  readonly name: string;
  createQrisCharge(input: {
    orderId: string;
    amount: number;          // whole rupiah
    expiresAt: Date;
    idempotencyKey: string;
  }): Promise<{ providerRef: string; qrString: string; expiresAt: Date }>;

  cancelCharge(providerRef: string): Promise<void>;   // best effort

  verifyWebhook(rawBody: string, headers: Headers): { eventId: string; providerRef: string;
                                                      type: 'paid' | 'expired' | 'failed'; raw: unknown };
}
```

- **Mock provider:** returns a fake QR string; `POST /api/dev/mock-pay/{paymentId}` sends the same internal event a real webhook would, through the same verification code path (signed with `PAYMENT_WEBHOOK_SECRET`).
- **Webhook handler:** verify signature on the raw body → insert `payment_events` and process it in one transaction (schema doc §5.2) → respond 200. Unknown references return 200 and are logged (so the gateway stops retrying) but raise an alert.
- **Never trust the browser** about payment: the status page only reflects server state.
- **Real gateway (Phase 4):** write one adapter that implements the interface; test in the gateway's sandbox, using a tunnel (such as cloudflared) so webhooks can reach the local app.
- **Manual fallback:** static-QR confirmation records `qris_static_manual` with the staff member, reference and note (schema: `payments`), and always writes an audit log.

## 9. Authentication, authorisation, security

### Sessions and devices

- Opaque random 256-bit tokens in `HttpOnly`, `SameSite=Lax` (`Secure` when served over HTTPS) cookies: `bb_session` (12 hours) and `bb_device` (400 days, the browser maximum). Only a keyed hash (HMAC with `TOKEN_HASH_PEPPER`) is stored in `sessions.token_hash` / `devices.token_hash`.
- **Owner:** email + password (argon2id); rate limit 5 failures per 15 minutes per account and per IP.
- **Staff / barista:** the counter device must be registered (device cookie matched to `devices`); the user taps their name, enters a 4–6 digit PIN. 5 wrong PINs lock that user for 5 minutes. PIN login is rejected on unregistered browsers.
- **Auto-lock:** the client locks after 3 idle minutes (PIN again, same session); the server expires sessions after 12 hours or 8 hours of inactivity.
- **Role checks:** a `requireRole(...)` guard in every staff/owner route handler *and* in every service function that changes data (defence in depth).

### Elevation (owner PIN for sensitive actions)

`POST /api/auth/elevate` takes an owner PIN and a scope and creates a row in `elevations` valid for 60 seconds and **one use**. Sensitive services (`voidOrder`, `markPaidManually` when the setting requires it, `stockAdjustment`, `markRefundProcessed`) consume an elevation, store its id with the audit entry, and fail without it. If the signed-in user is the owner, the elevation is issued by re-entering the owner's own PIN.

### Application security checklist

| Area | Requirement |
|---|---|
| Pricing | Server calculates every price, tax and total; client prices are ignored. |
| Input | Zod validation; parameterised queries only (ORM); no raw string-built SQL. |
| CSRF | State-changing routes require a same-origin `Origin` header check in addition to SameSite cookies. |
| Rate limiting | Public order/recommendation endpoints: per IP and per `clientSession`; auth endpoints as above. Kept in process memory (a small sliding-window limiter in `modules/auth/rate-limit.ts`); this is correct while there is one app process, and must move to the database or a shared store before running more than one instance. Failed-PIN lockout is stored in `users` (`failed_pin_attempts`, `locked_until`) so it survives restarts. |
| QR tokens | Order creation requires an active QR token; owner can rotate. |
| Webhooks | Signature verification on the raw body; idempotency; constant-time comparison. |
| Secrets | Only in `.env` (gitignored); `.env.example` has no real secrets; logs redact tokens, PINs and passwords. |
| Headers | `Content-Security-Policy`, `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors 'none'` configured in `next.config`. |
| Dependencies | Lockfile committed; run `npm audit` before each release; avoid abandoned packages. |
| Audit | Every sensitive action writes `audit_logs` (actor, device, reason, entity, metadata). |
| Privacy | No customer personal data (BR-13); receipt links use random 128-bit tokens; `robots` disallow for all dynamic pages. |
| Phase 4 | HTTPS only, `Secure` cookies, least-privilege database role, encrypted off-machine backups, restore test. |

## 10. Recommendation job (Apriori)

This section is written so it can be reused in the course FSD.

**Input:** one basket per paid, non-voided order: the set of distinct `menu_item_id`s (modifiers ignored). Seeded orders are included (flagged `is_seed`).

**Order history:** `npm run seed:orders` creates the demo history (parameters in `scripts/README.md`, docs/06 §7). `npm run import:orders -- <file.csv> [--dry-run]` imports history from the old POS (PRD Q4) as CSV, UTF-8 (a byte order mark is fine), comma separated, RFC 4180 quoting:

| Column | Required | Format |
|---|---|---|
| `order_ref` | yes | The old POS order number, up to 64 characters. Rows with the same `order_ref` are one order and must have the same `paid_at`. |
| `paid_at` | yes | `YYYY-MM-DD HH:MM[:SS]` in Asia/Jakarta time, or ISO 8601 with an offset (`2026-10-01T09:15:00+07:00`). Not in the future. |
| `item_name` | yes | A menu item name, matched ignoring case and extra spaces; inactive items count. |
| `quantity` | yes | Whole number 1–20. |
| `unit_price` | no | Whole rupiah (`18000`, `18.000` or `Rp 18.000`); empty means the current menu price. |

The header row names the columns in any order; other columns are ignored. At most 30 lines per order. Any bad row and nothing is imported (every problem is listed with its line number). Imported orders are `completed` Counter orders taken by the owner, with `is_seed = true`, `client_session = 'import'` and `idempotency_key = order_ref`, so an order already imported is skipped. The old POS tax and payment method are unknown: the total is the sum of the lines, no tax or service charge, and no `payments` row. Queue numbers continue each business day's counter.

**Algorithm:** Apriori frequent itemset mining followed by rule generation (`mlxtend.frequent_patterns.apriori` and `association_rules`), with:

| Parameter | Default | Meaning |
|---|---|---|
| `min_support` | 0.02 | Itemset must appear in ≥ 2 % of baskets. |
| `min_confidence` | 0.15 | Rule `A → B` must hold in ≥ 15 % of baskets that contain A. (0.15 rather than 0.25 so the planted Latte → Roti Bakar pairing, about 0.20, is kept; docs/06 §7.) |
| `min_lift` | 1.05 | Keep only rules where B is bought with A more than chance. |
| `max_len` | 3 | Antecedent up to 2 items, 1 consequent. |
| `min_orders` | 300 | Below this the run is skipped and the previous rules stay active. |

The thresholds are read from the `settings` table (keys `reco_min_support`, `reco_min_confidence`, `reco_min_lift`, `reco_min_orders`); `max_len` is fixed in the job. The scoring weights are the settings `reco_promote_weight` and `reco_margin_weight`, and the number of suggestions is `reco_max_items`.

**Output:** rows in `association_rules` (antecedent, consequent, support, confidence, lift) tied to an `association_rule_runs` record; only the latest successful run is `is_active`.

**Runtime scoring (in `modules/recommendations/scoring.ts`):**

1. Candidates: active rules whose antecedent is a subset of the cart items.
2. Remove consequents already in the cart, inactive or unavailable items.
3. For each candidate: `score = confidence × (1 + promote_weight × is_promoted) × (1 + margin_weight × margin_pct)`, where `margin_pct` is in 0–1 and is 0 if the item has no complete recipe.
4. Keep the best score per consequent; return the top `reco_max_items` (default 2).
5. If there are no candidates, optionally return one promoted available item; else none.
6. Log each suggestion as a `recommendation_events` row (`shown`), and later `accepted` or `rejected`. The order links the events of its checkout: the client sends their ids as `recommendationEventIds[]` (at most 20) and the order transaction sets `order_id` on those of the same `clientSession` not yet linked (Schema §5.1).

The score is stored rounded to 4 decimals; a `promoted` fallback has no rule and no score. The margin factor is neutral (0) until recipes and costs exist (P2-08). C-04 asks once per cart visit when "Bayar" is tapped and skips the sheet on an error or after 1.5 s; the Counter asks after each cart change and shows the top suggestion.

**Running it:** once, `npm run reco:setup` creates the virtual environment `jobs/apriori/.venv` (Python 3.13) and installs the pinned packages (docs/versions.md). `npm run reco:run` then runs `jobs/apriori/run.py` with it against `DATABASE_URL` and prints the run, the basket count (and how many are seeded) and the top rules by lift. The worker also starts it between 03:00 and 04:00 Asia/Jakarta if the machine is on, once per night and only when no run (also a manual one) has started since 03:00; the outcome goes to the worker log. Only one run at a time (advisory lock); a second one reports `already_running`. The job is deterministic for the same data, so results can be reproduced in the demo. The database driver is pg8000 (pure Python).

**Evaluation for the FSD:** report the number of baskets, thresholds used, the top rules table (support, confidence, lift), and later the acceptance rate from `recommendation_events`. State clearly when the data is seeded.

## 11. Non-functional targets

| Area | Target | How it is met / checked |
|---|---|---|
| Menu page load | Interactive in ≤ 3 s on a mid-range Android phone over 4G | Server-render the menu, compress images (WebP, ≤ 100 KB each), no heavy client libraries; `npm run perf:menu` runs Lighthouse (mobile, throttled) on a production build and fails below 80 |
| API latency | p95 ≤ 300 ms locally for order creation and status changes | Few queries per request; indexes in the schema; measured by `npm run load:test` (p95 per request type; fails above 300 ms) |
| Concurrency | 30 customers ordering within 10 minutes without errors | `npm run load:test`: a plain Node script (no load-testing package) that runs the whole self-order flow per customer, each with its own `clientSession` and address |
| Queue number | No duplicates under parallel payments | `next_queue_number()` test with 50 parallel "mark paid" calls |
| Correctness | Money and stock never drift | Unit tests for `money.ts`, pricing, tax; invariant I7 reconciliation test |
| Reliability | Webhook replays and out-of-order events are harmless | Integration tests for duplicates, late payment, expired order |
| Availability | Accepted risk: stops without internet or when the host is off (D6) | Documented fallback in Phase 4 runbook |
| Accessibility | WCAG 2.1 AA colour contrast; targets ≥ 44 px (counter ≥ 56 px); visible focus; screen-reader labels | Design brief; `tests/e2e/accessibility.spec.ts` runs axe (WCAG 2.1 A/AA, no serious or critical issues) on every customer screen and places an order by keyboard alone |
| Browsers | iOS Safari 15+, Chrome/Android 100+, current desktop browsers; Counter on a current Chrome tablet | Manual check list in Phase 1 |
| i18n | Indonesian UI; strings in one file; amounts as `Rp 22.000` | `i18n/id.json`, formatting helpers |
| Observability | Structured logs with request id; a `/api/health` route checking the database | pino |
| Backups | Phase 4: nightly `pg_dump`, stored off the machine, restore tested | Runbook |

## 12. Testing strategy

| Level | Tools | What |
|---|---|---|
| Unit | Vitest | `money.ts` (rounding, tax inclusive formula), pricing, modifier validation, order state machine, availability, weighted-average cost, scoring |
| Integration | Vitest + real PostgreSQL (separate test database, migrated fresh) | Create order → webhook → paid → queue number; duplicate webhook; late payment; expiry sweep; stock deduction; void return/waste; elevation single use; append-only triggers; constraint tests; concurrent queue numbers |
| Job | pytest (`npm run test:reco`, part of `verify`) | Apriori on a tiny fixture with known rules; the planted rules recovered from the seed baskets; skip when under `min_orders`; atomic swap of active rules; a failed run keeps the old rules |
| End to end | Playwright | Customer orders on a phone viewport with mock pay → Counter marks Ready → status page and board update; sold-out blocking; PIN login and lock; owner void flow |
| Accessibility/perf | axe, Lighthouse | Customer pages |

Definition of done for any task: typecheck, lint, tests pass locally; new behaviour has a test; docs updated if a rule or schema changed.

## 13. Tooling and workflow

- Git: `main` always runnable; short-lived branches `feat/…`, `fix/…`; Conventional Commits; merge commits via GitHub pull requests (one branch per task from `main`, never stacked) (self-reviewed with the PR checklist in the plan).
- No GitHub Actions or hosting at this stage (D8); pre-commit hooks run lint, typecheck and unit tests, and `npm run verify` runs everything before merging.
- Migrations are forward-only SQL files, never edited after merge.
- `CLAUDE.md` in the repo root tells Claude Code the rules in this document (see the implementation plan).

## 14. Growth path (extension points)

| Need | What changes |
|---|---|
| Host online | Deploy the Next.js app and worker to a managed host, move the database to a managed PostgreSQL, switch to HTTPS, set `Secure` cookies. SSE needs a host that allows long-lived responses (or fall back to polling). |
| Real payments | Add one adapter implementing `PaymentProvider`; no caller changes. |
| Second barista | Enable the Barista role and the kitchen display route (Phase 3). |
| Second outlet | Add `outlet_id` to the tables listed in schema doc §9. |
| Offline mode | New local-first layer in the Counter app; deliberately deferred. |
| Notifications | Add a notifier module that subscribes to `order_events`; WhatsApp or push later. |
| Loyalty/accounts | Would introduce personal data; requires a privacy review first. |

## 15. Technical decision log

| ID | Decision | Reason |
|---|---|---|
| TD-01 | Modular monolith, one repo, one deployable app plus worker | One developer; low operational load |
| TD-02 | PostgreSQL for data and for realtime fan-out (LISTEN/NOTIFY) | No extra infrastructure |
| TD-03 | SSE instead of WebSockets | Updates are one-way; simpler and proxy-friendly |
| TD-04 | Drizzle ORM plus hand-written SQL migrations for constraints and views | Keeps database rules explicit and testable |
| TD-05 | Custom opaque sessions instead of Auth.js | Needs revocable database sessions, device binding and elevation. Auth.js was mentioned during planning; its Credentials provider is limited to stateless JWT sessions, so a ~200-line module is simpler and safer |
| TD-06 | Python and mlxtend for Apriori | Mature implementation, easy to explain and verify |
| TD-07 | Payment provider interface with mock first | Develop and demo with no merchant account |
| TD-08 | Local PostgreSQL in Docker, hosting deferred | D8, D22 |
| TD-09 | All UI text in `i18n/id.json` | D20; English can be added later |
