# Scripts

Command-line jobs that run beside the app. Each one loads `.env` and uses the
same modules as the app (`src/modules/*/service.ts`).

| Command                                                      | Script                    |
| ------------------------------------------------------------ | ------------------------- |
| `npm run worker`                                             | `worker.ts`               |
| `npm run seed:orders -- [--replace] [--end-date=YYYY-MM-DD]` | `generate-seed-orders.ts` |
| `npm run import:orders -- <file.csv> [--dry-run]`            | `import-orders-csv.ts`    |

## Demo order history: `seed:orders`

Creates about 2,000 paid orders over 60 business days, so the Apriori job
(P1-15) has data with known answers (FR-RC-07, docs/06 §7). The generator is
`src/modules/orders/seed-generator.ts`. It is pure and deterministic: the same
seed and end date always give the same orders. Every parameter is listed below,
so the course report can state exactly how the data was made.

Run `npm run db:seed` first: the orders use the seeded menu, the "Meja 1" to
"Meja 6" QR codes and the two staff users.

- **Days:** the 60 business days ending on `--end-date` (default: yesterday's
  business day). The end date must be before today's business day, so no live
  order shares a seeded day.
- **Refuses to run twice.** `--replace` deletes the earlier seeded orders and
  their payments first, then makes them again. Imported and real orders are
  never touched.

### Parameters

| Parameter                       | Value                    | Meaning                                                                                |
| ------------------------------- | ------------------------ | -------------------------------------------------------------------------------------- |
| Random seed                     | 81                       | See "Why seed 81" below                                                                |
| Days                            | 60                       |                                                                                        |
| Orders per day                  | 33.3                     | Base rate (about 2,000 in 60 days)                                                     |
| Weekday factor / weekend factor | 0.9 / 1.25               | Saturday and Sunday are busier                                                         |
| Daily jitter                    | ± 15 %                   | Uniform, per day                                                                       |
| Opening hours                   | 07.00–22.00 Asia/Jakarta | Hour weights below                                                                     |
| Self-order share                | 70 %                     | On a random "Meja" QR code; the rest are Counter walk-ins taken by a random staff user |
| Second item chance              | 36 %                     | An unrelated second item, by popularity                                                |
| Third item chance               | 12 %                     | After a second item                                                                    |
| Quantity per line               | 1: 85 %, 2: 12 %, 3: 3 % |                                                                                        |

Hour weights (share of a day's orders in each hour):

| Hour   | 07  | 08  | 09  | 10  | 11  | 12  | 13  | 14  | 15  | 16  | 17  | 18  | 19  | 20  | 21  |
| ------ | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Weight | 3   | 5   | 4   | 3   | 3   | 5   | 4   | 3   | 3   | 4   | 5   | 14  | 16  | 14  | 2   |

18.00–21.00 carries 44 of 88, half of the orders.

Item popularity (weight of being the first item ordered, and of being picked
as an unrelated second or third item):

| Item                | Weight | Item           | Weight |
| ------------------- | ------ | -------------- | ------ |
| Kopi Susu Gula Aren | 22     | Croissant      | 6      |
| Americano           | 12     | Kentang Goreng | 5      |
| Latte               | 12     | Sandwich Ayam  | 5      |
| Es Teh Lemon        | 12     | Affogato       | 4      |
| Matcha Latte        | 8      | Brownie        | 4      |
| Es Cokelat          | 7      | Roti Bakar     | 3      |

### Planted rules

After the basket is drawn, each planted rule adds its consequent with the add
chance when the antecedent is in the basket and the consequent is not. The
consequent can also land in the basket by itself, so the add chance is a bit
below the target confidence.

| Rule                            | Target confidence | Add chance |
| ------------------------------- | ----------------- | ---------- |
| Kopi Susu Gula Aren → Croissant | 0.35              | 0.32       |
| Americano → Brownie             | 0.25              | 0.23       |
| Es Teh Lemon → Kentang Goreng   | 0.30              | 0.27       |
| Latte → Roti Bakar              | 0.20              | 0.185      |

Roti Bakar is the least popular item and is flagged "promoted" by `db:seed`,
so the demo can show the owner's boost lifting an under-sold item.

### Why seed 81

Any seed gives confidences near the targets; seed 81 was picked by trying seeds
1 to 300 and keeping the one whose sample lands closest (largest deviation
0.006). Baskets are drawn from their own random stream, separate from dates and
times, so the planted confidences do not move with the end date. With the end
date 2026-10-31 the run prints:

| Rule                            | Confidence | Support | Lift |
| ------------------------------- | ---------- | ------- | ---- |
| Kopi Susu Gula Aren → Croissant | 0.355      | 0.108   | 2.08 |
| Americano → Brownie             | 0.252      | 0.043   | 2.95 |
| Es Teh Lemon → Kentang Goreng   | 0.306      | 0.052   | 2.73 |
| Latte → Roti Bakar              | 0.196      | 0.033   | 2.53 |

That run has 1,998 orders, 1.61 distinct items per order and 49.8 % of the
orders between 18.00 and 21.00. P1-15 accepts each rule within ± 0.07 of its
target with lift above 1.05.

### What is written

- `orders`: status `completed`, `is_seed = true`, `client_session = 'seed'`,
  idempotency key `seed:<n>`. The order was made 2 minutes before payment;
  preparing starts 20–120 s after payment, ready 3–7 min later (3–10 min in
  the evening rush), collected 30–300 s after that.
- Prices are the current menu prices with the current tax and service charge
  settings (`priceOrder`). No modifiers: Apriori ignores them.
- Queue numbers run from 1 each business day in payment order, through
  `queue_counters` like real payments.
- `payments`: one paid `qris_dynamic` payment per order with provider `seed`.

## Old POS history: `import:orders`

Imports order history exported from the old POS as CSV. The format and rules
are in docs/02 §10 ("Order history import"). The whole file is checked first:
if any row is wrong, the script lists every problem with its line number and
imports nothing. `--dry-run` only checks the file and says how many orders it
would import. An `order_ref` imported before is skipped, so the same file can be
imported again after rows are added.
