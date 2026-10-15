# Binary Brew — Implementation Plan

| | |
|---|---|
| Version | 0.1 (draft) |
| Date | 2026-10-08 |
| Developer | One person, working with Claude Code on a local PC |
| Related | [01 PRD](01-product-requirements.md) · [02 Tech](02-technical-requirements.md) · [03 App Flow](03-app-flow.md) · [04 Design](04-design-brief.md) · [05 Schema](05-backend-schema.md) |

The order of work follows decision D23: **Phase 1 contains the Apriori recommendation feature and is protected**; inventory and HPP come second; operations tooling third. Going live is a separate Phase 4 checklist (D22). Tasks are not mapped to ClickUp for now.

---

## 1. Principles

1. **Vertical slices.** Each task ends with something that runs and is tested, not a layer built "for later".
2. **Docs are the spec.** If the code and the docs disagree, decide which is right and fix the other in the same pull request.
3. **Money and stock first.** The order, payment, queue and stock code is built and tested before UI polish.
4. **Mock the outside world.** The payment provider is a mock until Phase 4.
5. **Small steps, always runnable.** `main` always starts with `npm run dev` after `npm run db:migrate && npm run db:seed`.

## 2. Estimates and schedule reality

Sizes: **S** ≤ 0.5 day, **M** 1–2 days, **L** 3 days or more (ideal focused days for one developer using Claude Code).

| Phase | Rough effort | Notes |
|---|---|---|
| 0 Foundation | 2 days | Mostly scaffolding and migrations |
| 1 Demo core | 16–18 days | Roughly 3.5 working weeks |
| 2 Inventory and HPP | 9–10 days | |
| 3 Operations | 9–10 days | |
| 4 Go-live | Separate commitment | Depends on hosting, gateway onboarding, hardware |

These are first guesses. Re-estimate after P1-04 and P1-06 (the first real pricing and order code). With the FSD due on 6 November (about 20 working days away) and the course documents competing for time, Phase 1 will fill most of that window by itself. The demo date is not yet known (PRD Q1); once it is, set the cut line in §8 against it.

## 3. Working with Claude Code

### 3.1 Starter `CLAUDE.md` (put in the repo root)

```markdown
# Binary Brew

Web app for a small coffee shop: QR self-order, QRIS payment, queue, POS, Apriori recommendations,
recipe-based inventory and HPP. Local-first. Solo developer.

## Read first
docs/01-product-requirements.md (what), 02-technical-requirements.md (how), 03-app-flow.md (flows),
04-design-brief.md (UI), 05-backend-schema.md (data), 06-implementation-plan.md (tasks).
Work on ONE task ID at a time (e.g. P1-06). Do not build things from later tasks.

## Stack
Next.js App Router, TypeScript strict, Tailwind, Zod, Drizzle + SQL migrations, PostgreSQL 16 (Docker),
Vitest, Playwright, pino. Python 3 + mlxtend for the Apriori job.

## Commands
npm run dev | worker | db:up | db:migrate | db:seed | reco:run | test | test:e2e | lint | typecheck | verify

## Hard rules
- Money is integer rupiah. All tax/rounding arithmetic lives in src/lib/money.ts.
- Prices are always computed on the server; never trust prices from the client.
- Business logic lives in src/modules/*/service.ts; route handlers only validate (Zod), call a service, format the response.
- A module may only call another module through its exported service functions.
- Money and stock changes happen inside a single DB transaction (see docs/05 section 5). Lock rows in a fixed order.
- Never edit audit_logs or stock_movements; they are append-only.
- All UI text goes in src/i18n/id.json (Indonesian). Code, comments, docs and commit messages are in English.
- No customer personal data is stored (no names, phones, emails). Do not add any.
- Never commit .env or secrets. Never log tokens, PINs or passwords.
- Migrations are forward-only SQL files; never edit a merged migration.

## Definition of done
npm run verify passes (typecheck, lint, unit + integration tests); new behaviour has tests;
docs updated if a rule, route or table changed; one focused commit per task step (Conventional Commits).

## When unsure
Ask instead of inventing requirements. If a doc is ambiguous, propose a change to the doc first.
```

### 3.2 Session routine

1. Start a session with: *"Read CLAUDE.md and docs/. Implement task P1-06. First write a short plan and the tests; wait for my OK before large changes."* Use plan mode for L-sized tasks.
2. Build in this order inside a task: types and schema → service with unit tests → route handler → UI → integration/e2e test.
3. Run `npm run verify` before every commit. Commit small. Review the diff yourself; do not accept changes you cannot explain, especially in payments, auth and stock code.
4. At the end of a session, update the task's status in this document (a ✔ in the Done column) and note any doc changes.
5. Keep the Apriori job and its tests in Python; everything else in TypeScript.

### 3.3 Git workflow

- `main` is always runnable. Branches: `feat/p1-06-order-creation`, `fix/…`, `docs/…`.
- Pull request per task (even solo): the description lists the task ID, what changed, how it was tested, and the PR checklist below. Squash merge.
- PR checklist: tests added or updated · `npm run verify` green · no secrets · docs updated · migrations forward-only · UI strings in `id.json` · accessibility basics checked for UI changes.

## 4. Phase 0 — Foundation (≈ 2 days)

| ID | Task | Refs | Size | Depends | Done when |
|---|---|---|---|---|---|
| P0-01 | Initialise repo: Next.js (App Router, TypeScript strict), Tailwind, ESLint, Prettier, Husky + lint-staged, folder skeleton from Tech §4, README with setup steps | Tech §2, §4 | S | — | `npm run dev` shows a placeholder page; `npm run verify` runs (even if tests are empty) |
| P0-02 | Docker Compose for PostgreSQL, env validation with Zod (`.env.example`), `/api/health` that checks the database | Tech §3 | S | P0-01 | `npm run db:up` then `/api/health` returns ok; the app refuses to start with a missing env var |
| P0-03 | Drizzle setup and migrations: all enums and tables from Schema §3, then a SQL migration for check constraints, partial indexes, triggers, functions, views | Schema §3 | M | P0-02 | `npm run db:migrate` on an empty database succeeds; `tests/db/schema.test.ts` confirms every named constraint, trigger and view exists, and that updating `audit_logs` or `stock_movements` fails |
| P0-04 | `lib/` basics: `money.ts` (rounding, tax-inclusive formula, formatting), `time.ts` (`businessDate`), `errors.ts`, `logger.ts` (pino with redaction), `ids.ts` (random tokens) | Tech §5 | S | P0-01 | Unit tests pass, including a test that `businessDate` equals the SQL `business_date_of` for sample timestamps around midnight and 04:00 |
| P0-05 | Design tokens in Tailwind from Design §4, base components (Button, Chip, Sheet, PinPad skeleton), i18n loader with `id.json` | Design §4, §5, §9 | M | P0-01 | A `/dev/components` page shows all components in all states |
| P0-06 | Seed script: settings (Schema §3.9), owner and two staff users, one counter device, categories, about 12 menu items, modifier groups and options, QR tokens | Schema §7 | S | P0-03 | `npm run db:seed` is repeatable (idempotent); menu appears in the database |
| P0-07 | Write `CLAUDE.md` (§3.1), `docs/versions.md` with pinned versions, `npm run verify` script | — | S | P0-01 | Files exist and `verify` runs typecheck, lint and tests |

**Phase 0 exit:** a new clone can reach a seeded, running app with three commands.

## 5. Phase 1 — Demo core (≈ 16–18 days) · PROTECTED

| ID | Task | Refs | Size | Depends | Done when |
|---|---|---|---|---|---|
| P1-01 | **Auth core:** opaque sessions, device registration, owner email/password login, staff name + PIN login, lockout, `requireRole`, elevation (owner PIN → 60 s single-use), in-memory rate limiter | FR-OW-01, FR-POS-03; Tech §9 | L | P0-03, P0-04 | Integration tests: wrong PIN ×5 locks the user for 5 min; PIN login fails on an unregistered browser; elevation works once and expires; sessions are revocable |
| P1-02 | **Settings and audit modules:** typed `getSetting`/`setSetting`, `audit()` helper | FR-OW-04; Schema §3.7 | S | P0-03 | Tests: settings round-trip with types; audit rows are written and cannot be changed |
| P1-03 | **Menu read API and C-01:** QR token check, categories, items, availability (manual flag only for now), "Pesanan saya", C-08 variants for invalid QR and ordering off | FR-CO-01, FR-CO-02, FR-CO-07; C-01, C-08 | M | P0-05, P0-06 | Opening `/o/{validToken}` on a phone over the LAN shows the menu; a rotated or unknown token shows C-08 |
| P1-04 | **Pricing service:** subtotal, modifier price deltas, min/max validation, service charge, inclusive tax, rounding | FR-TX-01, FR-CO-03; Schema §5.1 | M | P0-04 | Unit tests with a table of cases (including 11 % tax, service charge, negative modifier delta, invalid selections) |
| P1-05 | **Customization sheet (C-02) and cart (C-03):** client cart store (`sessionStorage`), live price, required-group blocking | FR-CO-03, FR-CO-04 | M | P1-03, P1-04 | Playwright: add item with modifiers, change quantity, remove; total matches the pricing service |
| P1-06 | **Order creation:** service + `POST /api/public/orders`, server-side validation and pricing, open-order cap, idempotency key, expiry timestamp, snapshots | FR-CO-06, FR-CO-08, BR-03, BR-11; Schema §5.1 | L | P1-02, P1-04 | Integration tests: client price ignored; sold-out item rejected with names; 4th open order rejected; same idempotency key returns the same order |
| P1-07 | **Payments:** `PaymentProvider` interface, mock provider, webhook route (signature, `payment_events` idempotency), mark-paid transaction with `next_queue_number`, late-payment handling, dev mock-pay endpoint | FR-PM-01..07, FR-QF-01, BR-02, BR-04; Tech §8; Schema §5.2 | L | P1-06 | Integration tests: duplicate webhook processed once; 50 parallel payments give unique sequential queue numbers; late payment revives or creates a refund request; unpaid order never has a queue number |
| P1-08 | **Payment and status screens:** C-05 (QR, countdown), C-06 (tracker, sound/vibration), C-07 (receipt), SSE infrastructure (`lib/sse.ts`, LISTEN/NOTIFY), polling fallback | FR-PM-02, FR-QF-03; Tech §7 | L | P1-07 | Playwright: pay with the mock button → status screen shows the number without reload; killing the SSE connection still updates within 10 s |
| P1-09 | **Worker:** expiry sweep (30 s), ready auto-complete, cancel pending charge at provider | FR-PM-04, FR-QF-05 | M | P1-07 | Tests with a short expiry: unpaid order becomes `expired`, charge cancelled; ready order auto-completes |
| P1-10 | **Counter shell:** S-01 name + PIN + lock overlay, S-02 queue column with Start/Ready/Collected, SSE updates, chime | FR-POS-03, FR-QF-02; S-01, S-02 | L | P1-01, P1-08 | A newly paid order appears with a chime; status buttons move the order and update the customer page; lock after 3 minutes idle |
| P1-11 | **Counter POS:** menu grid and cart (S-02 left), S-03 customization, S-04 charge screen, S-05 manual payment, S-07 elevation dialog, S-06 order detail (without void), S-08 sold-out panel | FR-POS-01..05, FR-PM-05, FR-PM-06; S-03..S-08 | L | P1-10 | Walk-in order paid via mock; manual confirmation requires owner PIN by default and writes an audit entry; toggling sold-out updates the customer menu |
| P1-12 | **Queue board T-01** with SSE | FR-QF-04 | S | P1-08 | Preparing and Ready numbers appear and move on a second browser window; no personal data on screen |
| P1-13 | **Owner basics:** O-01 login, O-03 menu CRUD with promote flag, O-13 basic (users, PIN reset, register this device), O-14 basic settings | FR-OW-01, 02, 04, 05, FR-RC-05 | L | P1-01, P1-02 | Owner can change a price and see it on the customer menu; a new staff user can log in by PIN on a registered device |
| P1-14 | **Seed order generator and CSV importer** (deterministic, see §7) | FR-RC-07 | M | P0-06 | `npm run seed:orders` creates ~2,000 paid orders over 60 days flagged `is_seed`; importer maps a CSV from the old POS to orders |
| P1-15 | **Apriori job (Python):** read baskets, run Apriori, write rules and run record, atomic swap, skip under minimum orders; pytest | FR-RC-01; Tech §10; Schema §5.7 | L | P1-14 | `npm run reco:run` fills `association_rules`; test fixture reproduces known rules; planted pairs in the seed data are recovered (see §7) |
| P1-16 | **Recommendation service, API and UI:** scoring (rules + promote), `POST /api/public/recommendations` and events, C-04 sheet, chips on the Counter, event logging, 1.5 s timeout fallback | FR-CO-05, FR-RC-02..04; C-04 | L | P1-15, P1-05 | Cart with Kopi Susu shows Croissant from the real rule; accept/dismiss events are stored; no suggestion for items in cart or unavailable |
| P1-17 | **Hardening and demo readiness:** Playwright happy path and edge cases, accessibility pass (axe, keyboard), Lighthouse, load script (30 customers), demo script rehearsal (§6), README for running the demo | NFR (Tech §11) | M | all P1 | All Phase 1 exit criteria in §6 pass |

## 6. Phase 1 exit criteria and demo script

**Exit criteria**

- Every Phase 1 FR in the PRD works end to end with the mock provider.
- `npm run verify` and `npm run test:e2e` pass; the load script handles 30 orders in 10 minutes without errors.
- Customer pages pass axe with no serious issues; Lighthouse performance ≥ 80 on the menu page on a throttled mobile profile.
- The recommendation shown in the demo comes from a real `association_rules` row (not hard-coded).

**Demo script (≈ 8 minutes)**

1. Reset: `npm run db:reset && npm run db:seed && npm run seed:orders`.
2. Run `npm run reco:run`; open the rules table and explain support, confidence and lift for two rules. State clearly that the order history is **seeded**.
3. Phone scans the table QR → menu → adds Kopi Susu → sheet suggests Croissant (from the rule) → add → pay.
4. Mock-pay → phone shows the order number; Counter tablet chimes.
5. Barista taps Start, then Ready → phone vibrates and shows "Pesanan siap diambil!"; TV board moves the number to Ready; tap Collected.
6. Walk-in order at the Counter; customer "paid with the stall QR" → manual confirmation with owner PIN → show the audit log row.
7. Create an order and let it expire (set `order_expiry_minutes` to 1 for the demo) → status shows expired; no queue number was used.
8. Replay the same webhook twice → show it is processed once.

## 7. Seed order generator (specification)

Deterministic (fixed random seed), 60 days, about 2,000 paid orders, evening peak 18:00–21:00 carrying roughly half of the volume, about 1.6 items per order on average.

Planted associations (so the job's output can be checked against known truth):

| Antecedent | Consequent | Target confidence | Why |
|---|---|---|---|
| Kopi Susu Gula Aren | Croissant | ≈ 0.35 | Classic pairing; popular, high volume |
| Americano | Brownie | ≈ 0.25 | Moderate pairing |
| Es Teh Lemon | Kentang Goreng | ≈ 0.30 | Cold drink with snack |
| Latte | Roti Bakar | ≈ 0.20 | Roti Bakar has low overall popularity and is flagged "promoted" in the seed, so the demo can show the owner's boost lifting an under-sold item |

The test for P1-15 asserts that each planted rule appears with confidence within ±0.07 of its target and lift above 1.05. The generator documents its parameters in `scripts/README.md` so the course report can describe exactly how the demo data was made. The seeded menu (about 12 items) uses these placeholder names: Kopi Susu Gula Aren, Americano, Latte, Matcha Latte, Es Teh Lemon, Es Cokelat, Croissant, Brownie, Kentang Goreng, Sandwich Ayam, Roti Bakar, Affogato. Replace them with the real menu once PRD Q2 is answered.

## 8. Phase 2 — Inventory and HPP (≈ 9–10 days)

| ID | Task | Refs | Size | Depends | Done when |
|---|---|---|---|---|---|
| P2-01 | **Ingredients and suppliers:** CRUD, O-05 stock table with status chips, opening stock movements | FR-IV-01 | M | P1-13 | Owner creates ingredients; `stock_qty` equals the sum of movements (invariant I7 test) |
| P2-02 | **Recipe editor (O-06) and modifier admin (O-04)** including ingredient deltas | FR-IV-02, FR-OW-03 | L | P2-01 | Recipe saved per item; extra shot option adds 9 g beans in the order snapshot |
| P2-03 | **Availability:** `v_menu_item_availability`, full-order check at checkout (recipe + modifier deltas × quantity), auto sold-out on menu, S-08 shows automatic vs manual | FR-IV-04, FR-CO-06 | M | P2-02 | Item disappears when an ingredient cannot cover one serving; checkout rejects an order that would exceed stock |
| P2-04 | **Stock deduction at payment:** `sale_deduction` movements in the mark-paid transaction, negative stock allowed and flagged, `unit_cogs` snapshot | FR-IV-03, FR-HP-03, BR-05; Schema §5.2 | L | P2-03, P1-07 | 50 parallel paid orders leave `stock_qty` equal to the ledger sum; deduction never happens for unpaid or expired orders |
| P2-05 | **Restock entry (O-07, S-09)** and weighted-average cost | FR-IV-05, BR-09; Schema §5.5 | M | P2-01 | Unit tests for average cost including zero and negative starting stock; new average shown before saving |
| P2-06 | **HPP and margin:** `v_menu_item_cost`, margin in O-03/O-06, O-09 report, low-margin flag | FR-HP-01, 02, 04 | M | P2-02, P2-05 | Report equals a hand-calculated example for three items |
| P2-07 | **Low-stock alerts** (dashboard card, `stock.low` event) | FR-IV-06 | S | P2-04 | Alert appears when a sale pushes an ingredient to its minimum |
| P2-08 | **Margin boost in recommendations** (neutral when recipe incomplete) | FR-RC-06 | S | P2-06, P1-16 | Scoring tests: higher-margin item ranks above equal-confidence lower-margin item; no recipe → no boost |

**Phase 2 exit:** a paid order deducts stock and snapshots COGS; HPP report matches a hand calculation; items hide themselves when ingredients run out.

## 9. Phase 3 — Operations (≈ 9–10 days)

| ID | Task | Refs | Size | Depends | Done when |
|---|---|---|---|---|---|
| P3-01 | **Void and refund flows:** S-06 void with reason and elevation, stock return/waste, refund requests, O-12 order list and "mark refund processed" | FR-PM-08, FR-IV-09, FR-OW-08, BR-07, BR-08; Schema §5.4 | L | P2-04 | Void before preparing returns stock; void after preparing logs waste; refund shows until marked processed; every step audited |
| P3-02 | **Stock count (O-08) and variance report (O-10)** | FR-IV-07, FR-IV-08; Schema §5.6 | M | P2-04 | Count with differences requires reasons and owner PIN; ledger and `stock_qty` stay equal |
| P3-03 | **Owner dashboard (O-02)** with sales, peak hours, best sellers, low stock, recommendation card | FR-OW-06 | M | P2-07 | Numbers match the reference SQL queries on seeded data |
| P3-04 | **Recommendation settings and performance (O-11)** and "recalculate now" | FR-RC-08, FR-RC-09 | M | P1-16 | Changing weights changes ranking in tests; acceptance report matches events |
| P3-05 | **Audit viewer (O-15), QR tokens (O-16), users and devices full (O-13), settings full (O-14)** | FR-OW-04, 05, 07, 09 | L | P1-13 | Rotating a token invalidates old QR codes; revoking a device blocks PIN login |
| P3-06 | **Kitchen display (S-10)** | FR-QF-06 | S | P1-10 | Barista role sees only the queue |
| P3-07 | **Ordering on/off and closed state** | FR-CO-09 | S | P1-03 | Switching off shows C-08 closed to customers; counter still works |
| P3-08 | **Polish pass:** accessibility, performance, error states, empty states, copy review | Design §10 | M | all | Checklist in Design §10 passes |

**Phase 3 exit:** the owner can run a full week of operations (orders, restocks, count, voids, reports) without opening the database console.

## 10. Cut line

If time runs short, cut in this order (last item first):

1. P3-08, P3-07, P3-06, P3-04 (nice to have)
2. P3-05 partial (keep QR token rotation and users; drop audit viewer UI, the log is still written)
3. P3-03 dashboard to two cards
4. P3-02 variance report (keep the count)
5. P2-07, P2-08
6. P3-01 and the rest of Phase 3, then parts of Phase 2 (keep P2-01 to P2-04 as the minimum for "stock deducts")

**Never cut:** all of Phase 1, audit writing, idempotent payments, server-side pricing, and the tests for money, payments and stock.

## 11. Phase 4 — Go-live checklist (separate commitment, D22)

| Area | Items |
|---|---|
| Hosting | Managed host for the app and worker; managed PostgreSQL; HTTPS and a domain; `Secure` cookies; environment variables set; SSE verified on the host (or polling fallback accepted) |
| Payments | Merchant account with the chosen gateway (PRD Q6); adapter implementing `PaymentProvider` (FR-PM-09); webhook endpoint reachable and verified; sandbox test passes; production test with a small real payment; refund procedure written down |
| Data | Real menu, prices, recipes and opening stock entered (PRD Q2); real order history imported if available (Q4); seeded demo orders removed or flagged out of reports |
| Hardware | Tablet bought and registered as a device; TV or monitor for the board; printed QR codes on tables and entrance; phone hotspot ready |
| Security | Least-privilege database role; secrets rotated; `npm audit` clean; rate limits reviewed for multi-instance; backup of the database (nightly `pg_dump` to storage off the machine) and a **tested restore** |
| Tax and receipts | Tax rate and service charge confirmed with the accountant (Q5) and set; receipt wording reviewed |
| People | Owner and staff trained (PIN, Counter, sold-out toggle, manual payment, void); one-page cheat sheet; paper fallback procedure for outages with the "backfill" steps |
| Monitoring | Uptime check on `/api/health`; log retention; alert on failed webhooks |
| Retention | Retention job (FR-OW-10) agreed with the owner |
| Launch | Soft launch on a quiet day; watch the first rush; written rollback plan (go back to the old POS for the day) |

## 12. Risks specific to the plan

| Risk | Mitigation |
|---|---|
| Payment and stock code is subtle and AI-generated code can look right but be wrong | Tests first for P1-04, P1-07, P2-04; review every diff in those areas; keep the invariant tests (Schema §4) in the suite |
| Scope creep from "just one more feature" | Every new idea becomes a numbered task below the cut line, not an interruption |
| Course deadlines compete with development | Keep Phase 1 as the single milestone that matters for the demo; schedule documentation work in separate blocks |
| Local environment problems (Docker, ports, LAN access) | Document the phone-testing setup in the README (P0-01, P0-02); keep `APP_BASE_URL` configurable |
| Unknown real data (menu, recipes, order history) | Seeded data keeps development moving; replace with real data via the importer and the owner screens when available |

## 13. Tracking

Keep this table up to date at the end of each session.

| Phase | Tasks done | Notes |
|---|---|---|
| 0 | 0 / 7 | |
| 1 | 0 / 17 | |
| 2 | 0 / 8 | |
| 3 | 0 / 8 | |
