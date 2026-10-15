# Binary Brew — Product Requirements Document (PRD)

| | |
|---|---|
| Product | Binary Brew web app (formerly Smartfolks Coffee): self-order, queue, POS, recommendations, inventory, HPP |
| Version | 0.1 (draft for review) |
| Date | 2026-10-08 |
| Author | Kelompok LK11 (main developer: project owner using Claude Code) |
| Business owner / interviewee | Kak Bagas |
| Status | Ready to start Phase 0 |

Related docs: [02 Technical Requirements](02-technical-requirements.md) · [03 App Flow](03-app-flow.md) · [04 Design Brief](04-design-brief.md) · [05 Backend Schema](05-backend-schema.md) · [06 Implementation Plan](06-implementation-plan.md)

---

## 1. Overview

Binary Brew is a small self-service coffee shop that has run for about two years under the name Smartfolks Coffee and plans to rebrand in October/November 2026. During the evening rush there is **one person** who takes orders, takes payment, makes drinks and hands them over, through **one line** at the cashier.

This product is a web app that:

1. lets customers scan a QR code, order and pay (QRIS) from their own phone, with no account;
2. puts paid orders into a numbered queue that the barista works through and that customers can follow on their phone and on a TV board;
3. gives the shop a POS screen (replacing the current POS app) for walk-in orders;
4. suggests an extra menu item at checkout (Apriori-based recommendations, boosted for items the owner wants to promote);
5. tracks ingredient stock from recipes and calculates HPP (cost of goods) and margin per menu item.

## 2. Background: what the interview told us

Source: interview with Kak Bagas, owner (transcript on file with the team).

| Fact from the interview | Implication for the product |
|---|---|
| Shop is about 2 years old; name changes to Binary Brew in Oct/Nov | All branding is configurable; the app must not hard-code "Smartfolks". |
| Concept is self-service: order and pay at the cashier, barista prepares, customer collects at the cashier | The new flow moves ordering and payment to the customer's phone and removes the crowd at the cashier. |
| Rush is roughly 18:00–21:00 | Peak-time behaviour of the counter screen and queue is the primary design constraint. |
| Small premises, one line; one person must make, then serve, then make again | Main problem is a single-person bottleneck, not miscommunication (which is rare). |
| A POS app exists; it records sales, shows daily sales graphs and best sellers | Users already know best-seller reporting. We replace it (D1), so these reports must be matched. |
| Upselling is done verbally and informally | Replace with consistent, data-based suggestions in the order flow. |
| Wants recommendations for menu items "not yet known by many people" | Recommendations must be able to favour under-sold items (D4). |
| Wants stock inventory and an HPP per menu | In scope: recipe-based stock and HPP (D5). |
| Willing to share data | Real order data may be available for Apriori; to be confirmed (Open Question Q4). |

## 3. Goals and non-goals

### Goals

- **G1.** Reduce rush-hour pressure on the single staff member by moving order entry and payment to the customer's phone.
- **G2.** Give customers a clear, self-updating view of their order status.
- **G3.** Increase awareness and sales of under-sold menu items through relevant suggestions.
- **G4.** Give the owner trustworthy stock levels, HPP and margin per item.
- **G5.** Be secure, maintainable by one developer, and cheap to run for a one-shop business, with room to grow.

### Non-goals (explicitly out)

- Customer accounts, loyalty points, collection of phone numbers, emails or names (D19).
- Cash handling in the first version (D11); the cash payment method exists in the data model but is switched off.
- Offline mode (D6).
- WhatsApp or push notifications (D10).
- Paper receipts and receipt printers; hardware purchase and installation.
- Multi-outlet, franchise, delivery platforms (GoFood/GrabFood), accounting, payroll.
- Native mobile apps.
- Refunds through the gateway API (refunds are processed manually in the gateway dashboard, D13).

## 4. Users and roles

| Role | Who | Main jobs | Device |
|---|---|---|---|
| **Customer** | Anyone in the shop, no login | Scan QR, order, pay, follow status | Own phone browser |
| **Barista** | Staff who only makes drinks (future second hire) | See paid queue, mark Preparing/Ready | Counter tablet or kitchen display |
| **Staff** | Cashier/barista (today one person does both) | Everything a barista does, plus POS orders, manual payment confirmation, sold-out toggle, restock entry | Counter tablet |
| **Owner** | Kak Bagas | Everything, including menu, recipes, prices, reports, users, settings, void/refund, stock counts | Owner's phone/laptop, counter tablet |
| **Queue board** | Passive screen | Shows Preparing and Ready order numbers | TV/monitor with a browser |

Permissions matrix:

| Capability | Customer | Barista | Staff | Owner |
|---|:-:|:-:|:-:|:-:|
| Place and pay own order | ✔ | | | |
| View queue / mark Preparing, Ready, Completed | | ✔ | ✔ | ✔ |
| Create POS (counter) order | | | ✔ | ✔ |
| Toggle "sold out" | | | ✔ | ✔ |
| Record restock | | | ✔ | ✔ |
| Manual payment confirmation | | | ✔ + owner PIN (setting) | ✔ |
| Void order, request/mark refund | | | owner PIN | ✔ |
| Stock count and adjustments | | | | ✔ |
| Menu, recipes, prices, modifiers, promote flag | | | | ✔ |
| Reports, dashboard, audit log | | | | ✔ |
| Users, devices, settings, QR tokens | | | | ✔ |

## 5. Scope and phasing

| Phase | Name | Contents | Exit criterion |
|---|---|---|---|
| 0 | Foundation | Repo, Docker Postgres, Next.js skeleton, migrations, seed scripts, conventions | `npm run dev` + seeded menu loads |
| 1 | Demo core | QR self-order, mock QRIS, queue, Counter screen, TV board, PIN auth, tax snapshot, **Apriori recommendations** on seeded data | Full demo path works end to end (see plan) |
| 2 | Inventory and HPP | Ingredients, recipes, modifier admin, stock deduction, sold-out hiding, restock, HPP and margin | Paid order deducts stock; HPP report matches hand calculation |
| 3 | Operations | Owner dashboard polish, stock count, variance report, void/refund flows, audit-log view, QR rotation, users/devices UI, kitchen display, recompute-now button | Owner can run a week of operations without the database console |
| 4 | Go-live (separate commitment) | Hosting, backups, real gateway, tablet, data entry, staff training, hardening | Go-live checklist signed off |

Cut line if time runs short: cut from the bottom of Phase 3, then the bottom of Phase 2. **Phase 1 including the Apriori feature is protected.**

## 6. Functional requirements

Priority: **M** = must, **S** = should, **C** = could. IDs are stable and used in the other docs.

### 6.1 Customer ordering (CO)

| ID | Requirement | Pri | Phase |
|---|---|:-:|:-:|
| FR-CO-01 | Customer scans a QR code and the menu opens in the phone browser with no install and no login. | M | 1 |
| FR-CO-02 | Menu is grouped by category and shows name, price and availability. Sold-out items remain visible but cannot be added. | M | 1 |
| FR-CO-03 | Items with modifier groups (size, sugar, ice, add-ons) open a customization sheet that enforces each group's min/max selection and shows the live price. | M | 1 |
| FR-CO-04 | Cart supports changing quantity, removing lines and shows the total. | M | 1 |
| FR-CO-05 | Before checkout the app may show up to 2 recommended items; the customer can add or dismiss each. | M | 1 |
| FR-CO-06 | Checkout recalculates prices and re-checks availability on the server; if something is sold out the customer is told **before** paying and the cart is corrected. | M | 1 |
| FR-CO-07 | A QR code with an invalid or rotated token shows a clear message and cannot create orders. | M | 1 |
| FR-CO-08 | A single client may have at most 3 unpaid orders open at once. | S | 1 |
| FR-CO-09 | The app shows a "shop closed / not accepting orders" state when the owner switches ordering off. | S | 3 |

### 6.2 Payment (PM)

| ID | Requirement | Pri | Phase |
|---|---|:-:|:-:|
| FR-PM-01 | Each order creates one dynamic QRIS charge through a payment-provider interface (mock provider first). | M | 1 |
| FR-PM-02 | The payment screen shows the QR, the exact amount and a countdown; it detects payment automatically. | M | 1 |
| FR-PM-03 | The payment webhook is verified (signature), idempotent and safe to receive more than once or out of order. | M | 1 |
| FR-PM-04 | Unpaid orders expire after N minutes (default 10, owner setting); the customer sees what to do next. | M | 1 |
| FR-PM-05 | If a customer paid via the stall's static QR, staff can mark the order paid manually with a reference and note; the action is audit-logged. Owner PIN required by default (setting `manual_payment_requires_owner_pin`). | M | 1 |
| FR-PM-06 | A `cash` payment method exists in the model but is disabled by the setting `cash_enabled = false`. | S | 1 |
| FR-PM-07 | A payment that arrives for an already-expired order revives the order if items are still available; otherwise a refund request is created automatically and the owner is alerted. | M | 1 |
| FR-PM-08 | The owner (or staff with owner PIN) can void a paid order with a mandatory reason and request a refund; the refund is processed manually in the gateway dashboard and then marked processed in the app. | M | 3 |
| FR-PM-09 | A real gateway adapter (sandbox, then production) replaces the mock provider without changing callers. | M | 4 |

### 6.3 Queue and fulfilment (QF)

| ID | Requirement | Pri | Phase |
|---|---|:-:|:-:|
| FR-QF-01 | When payment is confirmed the order gets the next queue number for the business day and enters the queue. Unpaid orders never appear in the kitchen queue or on the board. | M | 1 |
| FR-QF-02 | The Counter screen lists paid orders oldest first with actions Start preparing → Ready → Completed. | M | 1 |
| FR-QF-03 | The customer's status page updates by itself and, at Ready, plays a sound and vibrates (where the browser allows). | M | 1 |
| FR-QF-04 | The TV board shows Preparing and Ready order numbers only; no personal data. | M | 1 |
| FR-QF-05 | Ready orders are auto-completed after 30 minutes if nobody taps Completed. | S | 1 |
| FR-QF-06 | A separate kitchen display route shows only the barista's view. | C | 3 |

### 6.4 POS (POS)

| ID | Requirement | Pri | Phase |
|---|---|:-:|:-:|
| FR-POS-01 | Staff create an order for a walk-in customer on the Counter screen using the same menu, modifiers and rules as self-order. | M | 1 |
| FR-POS-02 | The counter order shows a dynamic QRIS on the tablet for the customer to scan; payment confirmation follows FR-PM-02/03. | M | 1 |
| FR-POS-03 | Staff log in by choosing their name and entering a PIN; the screen locks after 3 minutes without activity. | M | 1 |
| FR-POS-04 | Staff can mark any menu item sold out or available with one tap. | M | 1 |
| FR-POS-05 | Any order can show a digital receipt. | S | 1 |

### 6.5 Recommendations (RC)

| ID | Requirement | Pri | Phase |
|---|---|:-:|:-:|
| FR-RC-01 | A job runs Apriori over paid orders and stores rules with support, confidence and lift. | M | 1 |
| FR-RC-02 | At runtime, candidate items come from rules whose antecedent is in the cart; scoring = confidence × (1 + promote boost) × (1 + margin boost). At most 2 items are shown; items already in cart or unavailable are excluded. | M | 1 |
| FR-RC-03 | If no rule matches, a promoted item may be shown; otherwise nothing is shown. | M | 1 |
| FR-RC-04 | Every recommendation shown, accepted or dismissed is logged. | M | 1 |
| FR-RC-05 | The owner can flag an item as "promoted" in menu management. | M | 1 |
| FR-RC-06 | Margin boost uses HPP when an item's recipe is complete; otherwise margin boost is neutral. | S | 2 |
| FR-RC-07 | A seed-data generator and a CSV importer provide order history for the demo and for real data later. | M | 1 |
| FR-RC-08 | Owner can see acceptance rate and added revenue from accepted recommendations. | S | 3 |
| FR-RC-09 | Owner can trigger "recalculate now". | C | 3 |

### 6.6 Inventory (IV)

| ID | Requirement | Pri | Phase |
|---|---|:-:|:-:|
| FR-IV-01 | Ingredients have a unit (g, ml, pcs), minimum level and current stock. Ready-made items are ingredients of kind `resale` with a recipe quantity of 1. | M | 2 |
| FR-IV-02 | Each menu item has a recipe; modifier options can add or remove ingredient quantities. | M | 2 |
| FR-IV-03 | Payment confirmation deducts recipe + modifier ingredients in the same database transaction. | M | 2 |
| FR-IV-04 | An item is hidden as "sold out" when any recipe ingredient cannot cover one serving; staff can also toggle sold-out manually. | M | 2 |
| FR-IV-05 | Restock entry records ingredient, quantity, total price and supplier and updates the weighted-average cost. | M | 2 |
| FR-IV-06 | Owner dashboard lists ingredients at or below their minimum level. | M | 2 |
| FR-IV-07 | Weekly stock count: owner enters real quantities; differences become adjustments with a reason. | M | 3 |
| FR-IV-08 | Variance report: theoretical vs actual stock per ingredient over time. | S | 3 |
| FR-IV-09 | Void before preparation returns ingredients; void after preparation logs them as waste. | M | 3 |

### 6.7 HPP (HP)

| ID | Requirement | Pri | Phase |
|---|---|:-:|:-:|
| FR-HP-01 | HPP per menu item = Σ(recipe quantity × ingredient weighted-average cost). | M | 2 |
| FR-HP-02 | Margin (price − HPP) and margin % are shown per item; low-margin items are flagged below an owner-set threshold. | M | 2 |
| FR-HP-03 | At payment time the order line stores its HPP (`unit_cogs`) so historical margin does not change when costs change. | M | 2 |
| FR-HP-04 | HPP and margin report by item and by period. | S | 2 |

### 6.8 Owner and administration (OW) and tax (TX)

| ID | Requirement | Pri | Phase |
|---|---|:-:|:-:|
| FR-OW-01 | Owner logs in with email and password; failed attempts are rate limited. | M | 1 |
| FR-OW-02 | Owner manages categories and menu items (name, price, active, promoted, sold-out). | M | 1 |
| FR-OW-03 | Owner manages modifier groups and options. | M | 2 |
| FR-OW-04 | Owner manages settings: tax rate, service charge, expiry minutes, cash toggle, manual-payment rule, recommendation weights, business-day cutoff. | M | 1 (basic) / 3 (full) |
| FR-OW-05 | Owner manages users (roles, PIN reset) and registers/revokes counter devices. | M | 1 (basic) / 3 (full) |
| FR-OW-06 | Dashboard: sales today/period, transactions, peak hours, best sellers, recommendation acceptance, low stock. | S | 3 |
| FR-OW-07 | Audit log viewer with filters. | S | 3 |
| FR-OW-08 | Orders list with search and receipt access. | S | 3 |
| FR-OW-09 | Owner can rotate QR tokens and download QR images. | S | 3 |
| FR-OW-10 | Retention job removes or archives orders older than the retention period after owner confirmation. | C | 4 |
| FR-TX-01 | Prices are tax-inclusive; tax rate and service charge are settings (default 0%); every order stores a snapshot of rates and amounts; money is whole rupiah. | M | 1 |

## 7. Business rules

| ID | Rule |
|---|---|
| BR-01 | Order lifecycle: `awaiting_payment → paid → preparing → ready → completed`; side exits `expired` (unpaid) and `voided` (paid, owner-authorised). The only backward-looking transition is `expired → paid` for a late payment when items are still available (FR-PM-07). No other transitions. |
| BR-02 | Only `paid` orders reach the kitchen queue and the TV board. |
| BR-03 | Prices, tax and totals are always calculated on the server from the database; the client never sends prices. |
| BR-04 | The queue number is assigned at payment confirmation, increases by 1 per business day, and resets at the start of the next business day. |
| BR-05 | Stock is deducted when payment is confirmed, never earlier. Stock can go negative (the sale already happened); negative stock is flagged on the dashboard. |
| BR-06 | A customer cannot edit or cancel an order after paying. |
| BR-07 | Void, refund, manual payment confirmation (by default) and stock adjustments require the owner's PIN or owner login, a reason, and create an audit record. |
| BR-08 | Void before `preparing` returns ingredients to stock; void at or after `preparing` logs them as waste. |
| BR-09 | Ingredient cost is the weighted average of purchases. When stock is zero or negative the next purchase price becomes the average. |
| BR-10 | Order, payment and stock records are never edited to change history; corrections are new records. Audit and stock movement tables are append-only. |
| BR-11 | A client may have at most 3 open unpaid orders; max 20 per line, 30 lines per order. |
| BR-12 | Recommendations never include items already in the cart, inactive items or unavailable items. |
| BR-13 | The system stores no customer personal data. Receipt links use random, unguessable tokens. |
| BR-14 | Business day = local time (Asia/Jakarta) minus the cutoff (default 4 hours), so late-night orders belong to the day that started. |

## 8. Non-functional requirements (summary)

Detailed targets and how to meet them are in [02 Technical Requirements](02-technical-requirements.md).

- **Security:** server-side pricing, hashed credentials and PINs, device-bound PIN login, rate limits, signed webhooks, audit trail.
- **Performance:** menu page interactive in under 3 s on a mid-range phone on 4G; API p95 under 300 ms locally; supports at least 30 customers ordering within 10 minutes.
- **Reliability:** idempotent payment handling; money and stock changes in single transactions; documented fallback for internet loss.
- **Maintainability:** one TypeScript codebase, modular monolith, automated tests for money, stock and payment logic.
- **Usability:** Indonesian UI, touch targets of at least 44 px (56 px on the counter), readable from 5 m on the TV board.
- **Growth:** payment-provider interface, module boundaries and plain PostgreSQL leave room to host, add devices or add an outlet later.

## 9. Success metrics (targets to measure after launch)

No baseline was measured (D16), so these are **initial targets**, not claims of improvement. All values come from timestamps the system records automatically.

| Metric | Initial target | Source |
|---|---|---|
| Median time from payment to Ready, 18:00–21:00 | ≤ 5 min (p90 ≤ 10 min) | `orders.paid_at`, `ready_at` |
| Share of orders placed via self-order | ≥ 60 % in the first month | `orders.channel` |
| Recommendation acceptance rate | ≥ 15 % of shown (revise after 4 weeks of data) | `recommendation_events` |
| Stock variance after weekly count | ≤ 5 % per ingredient by the 4th count | `stock_count_items` |
| Orders that fail after payment because an item ran out | ≤ 1 per week | `refunds`, void reasons |

## 10. Defaults chosen by these documents (not discussed with the owner)

These fill gaps; each is a setting or easy to change. Confirm during review.

| # | Default |
|---|---|
| A1 | Unpaid orders expire after 10 minutes. |
| A2 | Max 3 open unpaid orders per client; 20 per line; 30 lines per order. |
| A3 | Staff screen locks after 3 minutes idle; sessions last at most 12 hours. |
| A4 | PIN is 4–6 digits; 5 wrong attempts lock that user for 5 minutes; PIN login only works on registered devices. |
| A5 | Owner elevation (PIN prompt) is valid for 60 seconds and one action. |
| A6 | Business day cutoff is 04:00 Asia/Jakarta. |
| A7 | Ready orders auto-complete after 30 minutes. |
| A8 | Late payment on an expired order revives the order if possible, else auto-creates a refund request. |
| A9 | Apriori: min support 0.02, min confidence 0.25, min lift 1.05, antecedent up to 2 items, needs at least 300 paid orders or the run is skipped. |
| A10 | Recommendation score = confidence × (1 + 0.5 × promoted) × (1 + 0.25 × margin%), weights editable in settings. |
| A11 | Order records kept 24 months. |
| A12 | Tax and service charge default to 0 until the accountant confirms; service charge is added on top of the subtotal, tax is included in the total. |
| A13 | Sold-out threshold is "cannot make one serving"; low-stock alert is at the ingredient's minimum level. |

## 11. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| One developer, limited time | Features slip | Phased plan with protected Phase 1 and a defined cut line |
| Internet outage during rush | Shop cannot sell | Accepted (D6); phone hotspot; paper fallback with backfill entry; offline mode listed as future work |
| Owner cannot supply recipes and costs | HPP and sold-out hiding empty | Demo with sample recipes; schedule one data-entry session; margin boost stays neutral without data |
| No real order history for Apriori | Recommendations look artificial | Label demo data as seeded; import real data when available (Q4) |
| Gateway onboarding time, fees, settlement delay | Cannot go live on schedule | Mock provider behind an interface; choose gateway during Phase 4 |
| Short PINs are weak | Misuse of staff accounts | Device binding, lockout, owner-only sensitive actions, audit log |
| System runs on a local PC | Shop stops when PC is off | Local is for development and demo only; hosting is a Phase 4 item |
| Tax rules unclear | Wrong receipts | Settings default to 0; confirm with accountant before go-live |

## 12. Open questions

| # | Question | Needed by |
|---|---|---|
| Q1 | Demo date? | Phase 1 planning |
| Q2 | Real menu, prices, and recipes for at least the top 10 items | Phase 2 |
| Q3 | Is the stall's static QR a bank merchant QR or an e-wallet QR? (decides how staff verify manual payments) | Phase 1 |
| Q4 | Can Kak Bagas export order history from the current POS (CSV)? | Phase 1 (Apriori) |
| Q5 | Does Binary Brew charge PB1 tax or a service charge? | Phase 4 |
| Q6 | Which gateway: Midtrans, Xendit or another QRIS provider? Fees and settlement time | Phase 4 |
| Q7 | Opening hours (to confirm the 04:00 cutoff) | Phase 1 |
| Q8 | Is the owner usually on premises? (affects the owner-PIN rule for manual payments) | Phase 1 |
| Q9 | Brand assets for Binary Brew (logo, colours) after the rebrand | Phase 1 design |
| Q10 | Who buys the tablet and TV screen, and when? | Phase 4 |

## 13. Decision log

Decisions D1–D23 were agreed in the planning session on 2026-10-08. "Supersedes" marks where a later decision changed an earlier one.

| ID | Decision |
|---|---|
| D1 | The new system **replaces** the existing POS app. |
| D2 | QRIS payments go through a payment gateway with a dynamic QR per order (mock locally). *Cash part superseded by D11.* |
| D3 | Customers order by QR code in a phone browser with no login. *Name/phone part superseded by D19.* |
| D4 | Recommendations are hybrid: Apriori rules + owner "promote" boost + margin awareness. |
| D5 | Stock deduction and HPP are recipe-based, with weighted-average ingredient cost. |
| D6 | No offline mode in the first version (accepted risk; hotspot and paper fallback). |
| D7 | The developer is a single person using Claude Code; docs cover the full system; implementation is phased. |
| D8 | Stack: Next.js, TypeScript, PostgreSQL in Docker, **local-first**; GitHub for source control only. |
| D9 | Modifier groups with price and ingredient deltas; sugar and ice are recorded but do not affect stock. |
| D10 | Ready notification via status page (sound/vibration), TV board and barista's "Ready" tap; no WhatsApp. |
| D11 | Only paid orders reach the kitchen; unpaid orders expire. **No cash in the first version** (supersedes cash parts of D2/D11). |
| D12 | Dynamic QRIS per order is primary; the stall's static QR is a manual fallback that is audit-logged; cash is disabled by a setting. |
| D13 | No customer edit/cancel after paying; void/refund need owner PIN and reason; refunds are processed manually in the gateway; stock returned or logged as waste; all audit-logged. |
| D14 | Weekly stock count, low-stock alerts, restock entry with price and supplier, variance report. |
| D15 | Individual staff accounts with PIN and auto-lock; roles Owner, Staff, Barista; sensitive actions need owner PIN; owner logs in with email and password; rate limiting. |
| D16 | Success metrics are post-launch targets; no baseline measurement. |
| D17 | Prices tax-inclusive; tax and service charge are owner settings (default 0%); price snapshot per order; integer rupiah; digital receipts only. |
| D18 | Sold-out items hidden automatically when ingredients cannot cover one serving; manual toggle; re-check at checkout; owner low-stock warning first. |
| D19 | **No customer personal data**: order number only (supersedes the name/phone part of D3). |
| D20 | UI in Indonesian with one translation file; development docs in English. |
| D21 | One combined Counter screen on a landscape tablet plus a TV board; the shop currently owns no suitable device, so a tablet is a hardware requirement. Separate kitchen display is Phase 3. |
| D22 | Course milestone is a demo on seeded data; going live is a separate Phase 4 checklist. |
| D23 | Phase order: Phase 1 includes Apriori (20 % of the course grade); inventory/HPP in Phase 2; operations in Phase 3. |

**Reconciliation note (D12 vs D15):** D12 says staff confirm static-QR payments manually; D15 lists manual payment confirmation as a sensitive action needing the owner's PIN. Both are honoured through the setting `manual_payment_requires_owner_pin` (default `true`). If the owner is rarely on premises (Q8), set it to `false`; the action is still audit-logged with the staff member's name.

## 14. Glossary

| Term | Meaning |
|---|---|
| QRIS | Indonesian national QR payment standard. |
| Dynamic QR | A QR generated per order with a fixed amount; the gateway notifies the app when it is paid. |
| Static QR | One fixed QR (the stall's existing code); the customer types the amount, and payment must be verified by a person. |
| HPP | Harga Pokok Penjualan: cost of goods sold per item. |
| Apriori | Algorithm that finds items frequently bought together; output rules have support, confidence and lift. |
| Support | Share of all orders that contain the item set. |
| Confidence | Of orders containing the antecedent, the share that also contain the consequent. |
| Lift | Confidence divided by the baseline popularity of the consequent; above 1 means a real association. |
| Elevation | A short owner-PIN confirmation that allows one sensitive action. |
| Business day | The shop's working day, which can run past midnight (see BR-14). |
