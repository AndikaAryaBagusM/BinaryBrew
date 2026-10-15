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
| `SEED_OWNER_EMAIL`, `SEED_OWNER_PASSWORD`, `SEED_OWNER_PIN` | local only | Used by `db:seed` |
| `TZ` | `Asia/Jakarta` | Process timezone |

Daily commands (all defined in `package.json`): `npm run dev`, `npm run worker`, `npm run db:up`, `npm run db:migrate`, `npm run db:seed`, `npm run reco:run`, `npm test`, `npm run test:e2e`, `npm run lint`, `npm run typecheck`.

Testing on real phones: phone and PC on the same Wi-Fi; open `http://<PC-LAN-IP>:3000`. Camera QR scanning of `APP_BASE_URL` links works without HTTPS.

## 4. Code structure

```
binary-brew/
├─ docs/                      # these documents
├─ src/
│  ├─ app/                    # Next.js routes (thin): (customer)/, (counter)/, (owner)/, board/, api/
│  ├─ modules/
│  │  ├─ orders/              # service.ts, repo.ts, schemas.ts, pricing.ts, state.ts
│  │  ├─ payments/            # service.ts, provider.ts (interface), providers/mock.ts, webhook.ts
│  │  ├─ menu/                # items, categories, modifiers
│  │  ├─ inventory/           # ingredients, recipes, movements, restock, count
│  │  ├─ recommendations/     # scoring.ts, repo.ts, events.ts
│  │  ├─ auth/                # sessions, pin, devices, elevation, rate-limit
│  │  ├─ reports/
│  │  ├─ settings/
│  │  └─ audit/
│  ├─ db/                     # schema.ts (Drizzle), client.ts, migrations/*.sql, seed/
│  ├─ lib/                    # money.ts, time.ts, errors.ts, logger.ts, ids.ts, sse.ts
│  ├─ i18n/id.json            # all UI text (Indonesian)
│  └─ components/             # shared UI components
├─ jobs/apriori/              # run.py, requirements.txt, tests
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
| Idempotency | Webhooks by `(provider, event_id)`; client order creation by a client-generated `Idempotency-Key` header stored on the order's payment charge request. |
| Feature flags | Settings table, not environment variables, for anything the owner may change. |

## 6. API surface

Auth column: **Public** (no login), **Token** (random link token), **Staff** (any logged-in user with the role), **Owner**, **Elev** (also needs a valid owner elevation, see §9). Names are indicative; keep the structure.

### Customer / public

| Method and path | Auth | Purpose |
|---|---|---|
| `GET /api/public/menu?qr=<token>` | Public | Categories, items, availability, modifier groups. Rejects invalid/rotated token. |
| `POST /api/public/orders` | Public + rate limit | Create order and payment charge. Body: `qrToken`, `clientSession`, `items[{menuItemId, quantity, modifierOptionIds[]}]`, `recommendationEventIds[]` (optional). Returns `publicToken`, payment (`qrString`, `amount`, `expiresAt`). |
| `GET /api/public/orders/{publicToken}` | Token | Status, items, totals, queue number, receipt. |
| `GET /api/stream/orders/{publicToken}` | Token | SSE: status changes for that order. |
| `POST /api/public/recommendations` | Public + rate limit | Body: cart item ids + `clientSession`; returns up to 2 suggestions. |
| `POST /api/public/recommendations/events` | Public + rate limit | Log `shown`/`accepted`/`rejected`. |
| `GET /api/public/board` | Public | Current Preparing and Ready queue numbers. |
| `GET /api/stream/board` | Public | SSE for the TV board. |

### Payments

| Method and path | Auth | Purpose |
|---|---|---|
| `POST /api/webhooks/payments/{provider}` | Signature | Receive payment events. Always respond 2xx after safely recording the event. |
| `POST /api/dev/mock-pay/{paymentId}` | Dev only | Mock provider: simulate "customer paid". Disabled when `PAYMENT_PROVIDER` is not `mock`. |

### Auth

| Method and path | Auth | Purpose |
|---|---|---|
| `POST /api/auth/owner-login` | Public + rate limit | Email and password. |
| `POST /api/auth/pin-login` | Registered device + rate limit | `userId` + PIN. |
| `POST /api/auth/logout` | Staff | End session. |
| `POST /api/auth/elevate` | Staff | Owner PIN → short-lived elevation for one scope. |
| `POST /api/devices/register` | Owner | Register this browser as a counter device. |

### Counter (staff, barista, owner)

| Method and path | Auth | Purpose |
|---|---|---|
| `GET /api/counter/orders?status=` | Staff | Paid queue and recent orders. |
| `POST /api/counter/orders` | Staff | Create counter order (same service as self-order). |
| `POST /api/counter/orders/{id}/status` | Staff/Barista | `preparing`, `ready`, `completed`. |
| `POST /api/counter/orders/{id}/manual-payment` | Staff + Elev (if setting) | Confirm a static-QR payment with reference and note. |
| `POST /api/counter/orders/{id}/void` | Elev | Void with reason (Phase 3). |
| `POST /api/counter/menu-items/{id}/sold-out` | Staff | Toggle manual sold-out. |
| `GET /api/stream/counter` | Staff | SSE for new/changed orders. |

### Owner

| Area | Endpoints (all Owner unless noted) |
|---|---|
| Menu | CRUD `/api/owner/categories`, `/menu-items`, `/modifier-groups`, `/modifier-options`; `PUT /menu-items/{id}/recipe`; promote flag via menu item update |
| Inventory | CRUD `/ingredients`, `/suppliers`; `POST /restocks` (Staff allowed); `POST /stock-counts` (Elev `stock_adjustment`) |
| Orders | `GET /orders`, `POST /orders/{id}/refund-processed` (Elev) |
| Reports | `GET /reports/sales`, `/best-sellers`, `/peak-hours`, `/hpp`, `/stock-variance`, `/recommendations` |
| System | `GET/PUT /settings`; users and devices CRUD; `POST /qr-tokens/{id}/rotate`; `GET /audit-logs`; `POST /reco/run` (Phase 3) |

## 7. Realtime

- SSE endpoints subscribe to Postgres `LISTEN order_events` through **one** shared connection per server process, and fan out to open responses.
- Payload is minimal: `{ orderId, status, queueNumber }`. Clients refetch details as needed.
- After any commit that changes an order's status, call `pg_notify('order_events', json)`.
- **Clients must still work if SSE drops:** the status page and Counter screen refetch on reconnect and poll every 10 seconds as a safety net.
- Send a comment heartbeat every 20 seconds to keep proxies from closing idle streams.
- The TV board, status page and Counter use the same helper in `lib/sse.ts`.

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
- **Webhook handler:** verify signature on the raw body → insert `payment_events` → process in a transaction (schema doc §5.2) → respond 200. Unknown references return 200 and are logged (so the gateway stops retrying) but raise an alert.
- **Never trust the browser** about payment: the status page only reflects server state.
- **Real gateway (Phase 4):** write one adapter that implements the interface; test in the gateway's sandbox, using a tunnel (such as cloudflared) so webhooks can reach the local app.
- **Manual fallback:** static-QR confirmation records `qris_static_manual` with the staff member, reference and note (schema: `payments`), and always writes an audit log.

## 9. Authentication, authorisation, security

### Sessions and devices

- Opaque random 256-bit tokens in `HttpOnly`, `SameSite=Lax` (`Secure` when served over HTTPS) cookies. Only a keyed hash (HMAC with `TOKEN_HASH_PEPPER`) is stored in `sessions.token_hash` / `devices.token_hash`.
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

**Algorithm:** Apriori frequent itemset mining followed by rule generation (`mlxtend.frequent_patterns.apriori` and `association_rules`), with:

| Parameter | Default | Meaning |
|---|---|---|
| `min_support` | 0.02 | Itemset must appear in ≥ 2 % of baskets. |
| `min_confidence` | 0.25 | Rule `A → B` must hold in ≥ 25 % of baskets that contain A. |
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
6. Log each suggestion as a `recommendation_events` row (`shown`), and later `accepted` or `rejected`.

**Running it:** `npm run reco:run` (calls `python jobs/apriori/run.py`). The worker also triggers it at 03:00 Asia/Jakarta if the machine is on. The job is deterministic for the same data, so results can be reproduced in the demo.

**Evaluation for the FSD:** report the number of baskets, thresholds used, the top rules table (support, confidence, lift), and later the acceptance rate from `recommendation_events`. State clearly when the data is seeded.

## 11. Non-functional targets

| Area | Target | How it is met / checked |
|---|---|---|
| Menu page load | Interactive in ≤ 3 s on a mid-range Android phone over 4G | Server-render the menu, compress images (WebP, ≤ 100 KB each), no heavy client libraries; check with Lighthouse in Phase 1 |
| API latency | p95 ≤ 300 ms locally for order creation and status changes | Few queries per request; indexes in the schema; measured in an integration test with 30 parallel orders |
| Concurrency | 30 customers ordering within 10 minutes without errors | Load script (autocannon or k6) against the local app |
| Queue number | No duplicates under parallel payments | `next_queue_number()` test with 50 parallel "mark paid" calls |
| Correctness | Money and stock never drift | Unit tests for `money.ts`, pricing, tax; invariant I7 reconciliation test |
| Reliability | Webhook replays and out-of-order events are harmless | Integration tests for duplicates, late payment, expired order |
| Availability | Accepted risk: stops without internet or when the host is off (D6) | Documented fallback in Phase 4 runbook |
| Accessibility | WCAG 2.1 AA colour contrast; targets ≥ 44 px (counter ≥ 56 px); visible focus; screen-reader labels | Design brief; axe checks in Playwright for customer pages |
| Browsers | iOS Safari 15+, Chrome/Android 100+, current desktop browsers; Counter on a current Chrome tablet | Manual check list in Phase 1 |
| i18n | Indonesian UI; strings in one file; amounts as `Rp 22.000` | `i18n/id.json`, formatting helpers |
| Observability | Structured logs with request id; a `/api/health` route checking the database | pino |
| Backups | Phase 4: nightly `pg_dump`, stored off the machine, restore tested | Runbook |

## 12. Testing strategy

| Level | Tools | What |
|---|---|---|
| Unit | Vitest | `money.ts` (rounding, tax inclusive formula), pricing, modifier validation, order state machine, availability, weighted-average cost, scoring |
| Integration | Vitest + real PostgreSQL (separate test database, migrated fresh) | Create order → webhook → paid → queue number; duplicate webhook; late payment; expiry sweep; stock deduction; void return/waste; elevation single use; append-only triggers; constraint tests; concurrent queue numbers |
| Job | pytest | Apriori on a tiny fixture with known rules; skip when under `min_orders`; atomic swap of active rules |
| End to end | Playwright | Customer orders on a phone viewport with mock pay → Counter marks Ready → status page and board update; sold-out blocking; PIN login and lock; owner void flow |
| Accessibility/perf | axe, Lighthouse | Customer pages |

Definition of done for any task: typecheck, lint, tests pass locally; new behaviour has a test; docs updated if a rule or schema changed.

## 13. Tooling and workflow

- Git: `main` always runnable; short-lived branches `feat/…`, `fix/…`; Conventional Commits; squash merge via GitHub pull requests (self-reviewed with the PR checklist in the plan).
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
