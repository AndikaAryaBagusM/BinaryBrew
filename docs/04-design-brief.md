# Binary Brew — Design Brief

| | |
|---|---|
| Version | 0.1 (draft) |
| Date | 2026-10-08 |
| Related | [01 PRD](01-product-requirements.md) · [03 App Flow](03-app-flow.md) · [02 Tech](02-technical-requirements.md) |

This brief is for building the Figma Hi-Fi prototype and for implementing the UI. Screen IDs match the [App Flow](03-app-flow.md). UI language is **Indonesian** (D20); this document is in English, and the Indonesian copy is listed in §9.

> **About the earlier concept mockup.** The interactive mockup produced earlier in the project predates several decisions: it shows a cash payment option (removed, D11), has no order-number-only rule (D19), uses secondary text and price colours that fail contrast (see §4.2), and treats POS and kitchen as separate screens (combined into one Counter screen, D21). Redraw from this brief rather than copying it.

---

## 1. Design principles

1. **Rush-hour first.** Every Counter interaction must work with one hand, wet hands and a queue watching. Fewer taps beat more features.
2. **One obvious next action.** Each screen has one primary button; everything else is secondary.
3. **Say what happened and what to do next.** Errors and empty states always give an instruction in plain Indonesian.
4. **Numbers are the interface.** The order number is the customer's identity; make it the largest thing on every status screen and on the TV board.
5. **Honest, calm, warm.** Coffee-shop warmth, no dark patterns: recommendations are a quiet suggestion, never a blocker.
6. **Accessible by default.** Contrast, target size and focus states are requirements, not polish.

## 2. Surfaces and devices

| Surface | Device and size | Orientation | Input | Notes |
|---|---|---|---|---|
| Customer | Phone 360–430 px wide | Portrait | Touch | Mid-range Android and iPhone browsers; no install; works on slow 4G |
| Counter | Tablet, design at 1280×800, support down to 1024×768 | Landscape | Touch, one hand | Targets ≥ 56 px; high contrast; runs all day |
| Kitchen display (Phase 3) | Tablet or monitor, 1280×800 or larger | Landscape | Touch | Barista view only |
| Queue board | TV or monitor, 1920×1080 | Landscape | None | Readable from about 5 m |
| Owner | Phone, tablet or laptop | Responsive | Touch and mouse | Tables collapse to cards on phones |

## 3. Screen inventory

| ID | Screen | Surface | Phase | Purpose |
|---|---|---|---|---|
| C-01 | Menu | Customer | 1 | Browse by category, see price and availability, "Pesanan saya" list |
| C-02 | Item customization sheet | Customer | 1 | Choose size, sugar, ice, add-ons with live price |
| C-03 | Cart | Customer | 1 | Review lines, change quantity, total |
| C-04 | Recommendation sheet | Customer | 1 | Offer up to 2 extra items before paying |
| C-05 | Payment (QRIS) | Customer | 1 | Show QR, amount, countdown |
| C-06 | Order status | Customer | 1 | Order number and live status |
| C-07 | Receipt | Customer | 1 | Digital receipt |
| C-08 | Edge states | Customer | 1 | Invalid QR, shop closed, sold out at checkout, payment expired, price changed |
| S-01 | Staff select and PIN, lock overlay | Counter | 1 | Identify who is working |
| S-02 | Counter (menu + cart left, queue right) | Counter | 1 | Take walk-in orders and work the queue |
| S-03 | POS item customization | Counter | 1 | Same as C-02, tablet-sized |
| S-04 | Charge: QRIS on tablet | Counter | 1 | Customer scans from the tablet |
| S-05 | Manual payment confirmation | Counter | 1 | Static-QR fallback with reference and note |
| S-06 | Order detail | Counter | 1 (void in 3) | Items, status actions, receipt, void |
| S-07 | Owner PIN elevation | Counter | 1 | Authorise a sensitive action |
| S-08 | Sold-out panel | Counter | 1 | Toggle availability fast |
| S-09 | Quick restock | Counter | 2 | Record a delivery |
| S-10 | Kitchen display | Counter | 3 | Barista-only queue |
| T-01 | Queue board | TV | 1 | Preparing and Ready numbers |
| O-01 | Owner login | Owner | 1 | Email and password |
| O-02 | Dashboard | Owner | 1 basic / 3 | Today at a glance |
| O-03 | Menu management | Owner | 1 | Items, categories, price, promote, sold-out |
| O-04 | Modifier groups | Owner | 2 | Groups and options with price and ingredient deltas |
| O-05 | Ingredients and stock levels | Owner | 2 | Stock, minimum, cost |
| O-06 | Recipe editor | Owner | 2 | Ingredients per menu item, HPP preview |
| O-07 | Restock entry | Owner | 2 | Record purchases |
| O-08 | Stock count | Owner | 3 | Weekly count with reasons |
| O-09 | HPP and margin report | Owner | 2 | Cost, margin per item |
| O-10 | Stock variance report | Owner | 3 | Theoretical vs actual |
| O-11 | Recommendation settings and performance | Owner | 3 | Weights, promote, acceptance |
| O-12 | Orders and refunds | Owner | 3 | Search, receipt, mark refund processed |
| O-13 | Users and devices | Owner | 1 basic / 3 | Roles, PIN reset, register device |
| O-14 | Settings | Owner | 1 basic / 3 | Tax, expiry, toggles |
| O-15 | Audit log | Owner | 3 | Who did what |
| O-16 | QR codes | Owner | 3 | Tokens, rotate, download |

## 4. Visual language

### 4.1 Brand

The brand is changing to **Binary Brew** in Oct/Nov 2026 (Q9). Until a logo and palette exist, use the placeholder wordmark "Binary Brew" in the primary type and the palette below. All brand values are tokens, so the rebrand is a token change.

### 4.2 Colour tokens

Contrast ratios were calculated against WCAG 2.1 (AA needs 4.5:1 for normal text, 3:1 for large text and UI shapes).

| Token | Hex | Use | Pair and ratio |
|---|---|---|---|
| `bg` | `#F7F1E8` | Page background (cream) | — |
| `surface` | `#FFFFFF` | Cards, sheets | — |
| `ink` | `#3B2A20` | Primary text | on `bg` 12.2:1, on `surface` 13.7:1 |
| `ink-muted` | `#6B5646` | Secondary text | on `bg` 6.1:1, on `surface` 6.9:1 |
| `brand` | `#5B3A29` | Primary buttons, headings | white on `brand` 10.1:1 |
| `accent` | `#E8B75E` | Highlights, selected state backgrounds | `ink` on `accent` 7.4:1 |
| `caramel` | `#C98A3E` | Decorative shapes, icons, progress; **never body text** | `ink` on `caramel` 4.7:1; caramel text on white is only 2.9:1 (fails) |
| `price` | `#8A5A1F` | Prices | on `surface` 5.9:1, on `bg` 5.3:1 |
| `line` | `#E7DCC9` | Borders, dividers | — |
| `danger` | `#B3382C` | Errors, destructive | text on white 6.0:1; white on `danger` 6.0:1 |
| `success` | `#2F6B3E` | Success buttons | white on `success` 6.4:1 |
| `info` | `#2D6AA8` | Neutral information | text on `surface` 5.6:1, on `bg` 5.0:1; white on `info` 5.6:1 |

Supporting tokens from the Figma file (adopted in P0-05; ratios calculated the same way):

| Token | Hex | Use | Pair and ratio |
|---|---|---|---|
| `surface-sunken` | `#F0E8DC` | Pressed secondary button, wells, completed chip | `ink` 11.2:1, `ink-muted` 5.7:1 |
| `border-strong` | `#8C7A6B` | Secondary button border, empty PIN dots, input borders | UI shape on `surface` 4.1:1, on `bg` 3.7:1 |
| `brand-pressed` | `#4A2F21` | Pressed primary button | white 12.2:1 |
| `brand-dark` | `#3F271B` | Dark wordmark, deep brand surfaces | white 13.8:1 |
| `on-brand` | `#FFFFFF` | Text and icons on `brand`, `danger`, `success` | see those rows |
| `accent-soft` | `#FBF1DC` | Pressed ghost button, pressed PIN key, selected rows | `ink` 12.2:1 |
| `danger-pressed` | `#962E24` | Pressed destructive button | white 7.7:1 |
| `danger-soft` | `#F6DEDA` | Danger alert background | `danger` 4.7:1 |
| `success-soft` | `#DCEEDD` | Success alert background | `success` 5.3:1 |
| `info-soft` | `#DCE8F5` | Info alert background, "Baru" (paid) chip | `info` 4.5:1 |

Status chips (background / text): **Waiting** `#FBEBC9` / `#7A5200` (5.9:1) · **Paid ("Baru")** `info-soft` / `info` (4.5:1) · **Preparing** `#FDEBD8` / `#8F4A1C` (5.7:1) · **Ready** `#DCEEDD` / `#24562F` (7.1:1) · **Completed** `surface-sunken` / `ink-muted` (5.7:1) · **Expired** `#ECE6DD` / `#5C4B3D` (6.7:1) · **Voided** `#F6DEDA` / `#8E2A20` (6.6:1). Never rely on colour alone: every chip has a text label and an icon.

Queue board (dark theme): background `#1E1510`; text `#F7F1E8` (16.0:1); Preparing numbers `#E8B75E` (9.7:1); Ready numbers `#7FD18B` (9.7:1); secondary text `#A8937E` (6.1:1). Tiles: Preparing `#2A1F18` (text 14.3:1, numbers 8.7:1, secondary text 5.5:1), Ready `#1F3324` (numbers 7.3:1).

Dark mode for customer and owner screens is optional (Phase 3); the Counter and the board each have a single fixed theme.

### 4.3 Typography

| Role | Font | Notes |
|---|---|---|
| UI and body | System UI stack (`-apple-system`, `Segoe UI`, `Roboto`, `Noto Sans`) | No web-font download: faster and works without internet on the LAN |
| Numbers | Same, with `font-variant-numeric: tabular-nums` | Prices and queue numbers align |

| Style | Size / weight | Where |
|---|---|---|
| Display | 56–96 px / 800 | Order number on C-06, S-04 |
| Board number | 160–220 px / 800 | T-01 |
| H1 | 24 px / 700 | Screen titles |
| H2 | 18 px / 700 | Section titles |
| Body | 16 px / 400 | Default (never below 16 px on customer inputs, to prevent iOS zoom) |
| Caption | 13 px / 400 | Metadata, never for critical information |
| Counter body | 18 px / 500 | Tablet text |
| Display M | 40 px / 800 | Secondary large numbers (Figma) |
| Button label | 16 px / 600; Counter 18 px / 600 | Button text |
| Counter title | 22 px / 700 | Counter section titles, menu tiles |
| Counter number | 32 px / 800 | Queue numbers on order cards, PIN keys |
| Owner body | 14 px / 400 | Owner tables (laptop); customer screens stay at 16 px |

Figma uses Roboto as a stand-in for the system stack; code uses the system stack.

### 4.4 Shape, spacing, depth

- 4 px spacing grid (4, 8, 12, 16, 24, 32, 48).
- Radii: 8 (inputs), 12 (cards, buttons), 16 (PIN keys, large tiles), 20 (sheets), 999 (pills, chips).
- One elevation for cards (subtle), one for sheets, one for dialogs; no heavy shadows. Card `0 1px 2px` + `0 2px 8px` at 6 % `ink`; sheet `0 -4px 24px` at 14 % `ink`; dialog `0 12px 32px` at 18 % + `0 2px 6px` at 8 % `ink`.
- Icons: Lucide (outline, 2 px stroke), 24 px default; never icon-only buttons without a label on the Counter.

### 4.5 Imagery

Menu photos optional per item. When missing, show a coloured tile with the first letter (token `accent`). Photos are WebP, 4:3, ≤ 100 KB, with `alt` text equal to the item name.

## 5. Components

| Component | Variants and states |
|---|---|
| Button | Primary, secondary, destructive, ghost; default, pressed, disabled, loading. Sizes: customer 48 px high, Counter 56–64 px |
| Menu card | With photo, without photo, sold out (greyed, label "Habis"), promoted (small "Rekomendasi" tag) |
| Category tabs | Sticky, horizontal scroll, selected state with `accent` underline |
| Quantity stepper | − / count / +; minimum 44 px targets |
| Modifier group | Radio list (max 1) or checkbox list (max > 1); shows "Wajib pilih" when min ≥ 1; price delta on the right |
| Bottom sheet | Drag handle, title, content, sticky action bar |
| Cart bar | Sticky bottom bar with item count and total |
| Status chip | Waiting, Paid ("Baru"), Preparing, Ready, Completed, Expired, Voided; sizes S and L |
| Order card (Counter) | New (highlight pulse for 5 s), preparing, ready; shows number, items, age in minutes, one primary action |
| Queue number tile (board) | Preparing and Ready variants |
| PIN pad | 3×4 keys, 72 px, dots display, error shake, lockout message |
| Toast | Success, error; auto-dismiss 4 s, never covers the primary button |
| Data table (owner) | Sortable columns, sticky header, collapses to cards on phones |
| Empty state | Icon, one sentence, one action |
| Skeleton | For menu and lists while loading |

## 6. Layouts

### 6.1 Customer (portrait)

- Single column, 16 px side gutters, content max width 480 px centred on larger screens.
- Sticky header (shop name, "Pesanan saya") and sticky category tabs; sticky bottom cart bar once the cart has items.
- Safe-area padding at the bottom for iPhone home indicator.

### 6.2 Counter (landscape, 1280×800)

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Binary Brew   [Andi ▾ locked in 2:41]    Habis  Restock   Pesanan hari ini │  header 64 px
├──────────────────────────────┬────────────────────────────────────────────┤
│ MENU (60 %)                  │ ANTREAN (40 %)                             │
│ category chips               │  Baru (3)   Diproses (2)   Siap (1)        │
│ item grid, 3 columns         │  ┌─────────────────────────────┐           │
│ ┌──────┐┌──────┐┌──────┐     │  │ #014  Kopi Susu x2          │ [Mulai]   │
│ │ Kopi ││ Es   ││ Cro- │     │  │       Croissant x1   3 mnt  │           │
│ │ Susu ││ Teh  ││ issant│    │  └─────────────────────────────┘           │
│ └──────┘└──────┘└──────┘     │  ┌─────────────────────────────┐           │
│                              │  │ #013  Es Teh x1      5 mnt  │ [Siap]    │
│ KERANJANG (bottom of left)   │  └─────────────────────────────┘           │
│ 2 item  Rp 40.000  [Bayar]   │                                            │
└──────────────────────────────┴────────────────────────────────────────────┘
```

- The queue column is always visible; the barista never opens a different screen to see waiting orders.
- Orders are ordered oldest first; the oldest unfinished order is visually emphasised.
- Primary action on each card is the next status step. Destructive or rare actions (void) sit behind the card's detail view (S-06).

### 6.3 Queue board (1920×1080)

Two columns: **Sedang disiapkan** (left) and **Siap diambil** (right, larger, brighter). Up to 12 numbers per column, then a "+N" indicator. Numbers have a 5-second highlight animation when they enter Ready. No personal data ever appears here.

### 6.4 Owner

Left navigation (collapses to a bottom tab bar on phones), content area with page title, filters row, then table or cards. Forms use a single column with inline validation.

## 7. Screen specifications

### Customer

**C-01 Menu.** Header with shop name and a "Pesanan saya" link (appears only if the browser holds recent orders). Category tabs. Item cards: name, short description, price, "+" button. Sold-out cards show "Habis" and are disabled. Cart bar appears after the first item. *States:* loading skeleton; invalid QR (C-08); ordering off (C-08); empty category.

**C-02 Customization sheet.** Item name and price at the top; modifier groups in order; quantity stepper; sticky button "Tambah • Rp 25.000" with the live price. Required groups block the button and highlight the group with "Wajib pilih". Defaults are pre-selected.

**C-03 Cart.** Lines with name, chosen options (small text), quantity stepper, line price. Total. A short note "Harga sudah termasuk pajak" (when tax is on). Primary button "Bayar dengan QRIS". Empty state: "Keranjang masih kosong" with a button back to the menu.

**C-04 Recommendation sheet.** Appears once, after tapping Pay, before the payment is created. Title "Sering dipesan bersama". Up to 2 cards with name, price and "Tambah". Buttons: "Tambah" per card; "Lanjut bayar" as the primary action; there is no way to get stuck. If nothing to suggest, skip the sheet. Never show it more than once per checkout. Confidence percentages are **not** shown to customers.

**C-05 Payment.** Large QR, amount in display style ("Rp 40.000"), countdown ("Bayar dalam 09:41"), short instruction ("Buka aplikasi bank atau e-wallet, scan, lalu bayar"). Nothing to tap while waiting except "Kembali ke keranjang" (cancels the pending charge only if unpaid). On success the screen transitions to C-06 automatically. *Mock provider only:* a clearly marked "Simulasi bayar" button appears in development builds.

**C-06 Status.** Order number in Display style ("#014"). A three-step tracker: Diterima → Disiapkan → Siap diambil. Text under it: "Pesananmu sedang disiapkan". Items summary and a link to the receipt. At Ready: the tracker turns to the Ready colour, the heading becomes "Pesanan siap diambil!", the phone vibrates and plays a short sound (only after the first user interaction, as browsers require). A small note: "Layar ini otomatis diperbarui".

**C-07 Receipt.** Shop name, date and time, order number, items with options, subtotal, service charge (if any), total, tax included (if any), payment method, "Terima kasih". Print-friendly CSS.

**C-08 Edge states.** One layout (icon, title, one sentence, one button) with these variants:

| Variant | Title | Action |
|---|---|---|
| QR invalid or rotated | "Kode QR sudah tidak berlaku" | "Silakan scan kode di kasir" |
| Ordering off | "Pemesanan sedang ditutup" | Shows opening hours if set |
| Item sold out at checkout | "Maaf, ada menu yang habis" | Lists items; button "Perbarui keranjang" |
| Price changed | "Harga diperbarui" | Shows new total; button "Lanjut" |
| Payment expired | "Waktu pembayaran habis" | "Pesan lagi" |
| Server error | "Ada gangguan, coba lagi" | "Coba lagi" |

### Counter

**S-01 Staff select and PIN.** Grid of name tiles (large), then a PIN pad. Lock overlay re-uses the pad and also shows the count of waiting orders and a muted chime indicator. Errors: "PIN salah. Sisa percobaan: 3" and "Akun terkunci 5 menit".

**S-02 Counter.** See §6.2. Interactions: tap item to add (or open S-03 if it has modifiers); cart shows lines and total; "Bayar" opens S-04. Queue cards: new orders pulse once and chime; "Mulai" and "Siap" and "Diambil" are the primary actions; tapping the card body opens S-06.

**S-03 POS customization.** Same content as C-02 in a centred dialog with larger targets.

**S-04 Charge.** Full-screen dialog: large QR, amount, countdown, "Batalkan" (secondary) and "Pelanggan bayar lewat QR kios" (opens S-05). On success: big queue number "#014" for 3 seconds with the text "Sebutkan nomor ini ke pelanggan".

**S-05 Manual payment.** Fields: reference (required), note (optional). Short helper "Cek mutasi di aplikasi bank atau e-wallet sebelum konfirmasi". Primary "Konfirmasi dibayar". Triggers S-07 when required.

**S-06 Order detail.** Items and options, totals, payment info, timestamps, status buttons, "Lihat struk", "Batalkan pesanan" (void; opens reason field then S-07). Destructive button is visually separate and never the largest.

**S-07 Owner PIN.** Compact PIN dialog: "Masukkan PIN pemilik untuk melanjutkan". Shows what will happen ("Batalkan pesanan #014").

**S-08 Sold-out panel.** Searchable list of menu items with a switch each; items that are sold out because of low stock show a lock icon and "Stok habis (otomatis)" and the switch only offers a manual override label.

**S-09 Quick restock.** Ingredient picker, quantity, total price, optional supplier; shows the new weighted-average cost after saving.

**S-10 Kitchen display.** Only the queue column of S-02 at larger type, no menu or cart.

### Queue board

**T-01.** As in §6.3. If there are no orders: "Belum ada pesanan" on a calm screen with the shop name. If the connection drops: a small "Menyambung ulang…" indicator in the corner, numbers stay visible.

### Owner

| ID | Layout highlights |
|---|---|
| O-01 | Centred card: email, password, "Masuk". Rate-limit message on repeated failures. |
| O-02 | Row of 4 stat cards (penjualan hari ini, jumlah pesanan, jam tersibuk, menu terlaris), a sales-by-hour bar chart, a low-stock list, recommendation acceptance card. Charts use the colour tokens and have text alternatives. |
| O-03 | Table: name, category, price, status, promoted switch, sold-out switch. "Tambah menu" opens a form; edit opens a side panel with the recipe tab (O-06) in Phase 2. |
| O-04 | Group list with options; per option: name, price delta, ingredient deltas (Phase 2). |
| O-05 | Table: ingredient, unit, stock, minimum, average cost, status chip (Aman, Menipis, Habis, Minus). |
| O-06 | Ingredient rows with quantity; live HPP and margin preview; warning if an ingredient has no cost yet. |
| O-07 | Multi-row entry: ingredient, quantity, total price, supplier, date; shows the new average cost per row before saving. |
| O-08 | One row per ingredient with system quantity, counted quantity input, difference, reason selector (required when different). Owner PIN on save. |
| O-09 | Table: item, price, HPP, margin, margin %, flag for low margin; items without a recipe show "Resep belum ada". |
| O-10 | Table and a simple trend per ingredient; highlights the largest variances. |
| O-11 | Controls for weights and thresholds; promoted items list; performance table (shown, accepted, acceptance %); "Hitung ulang sekarang". |
| O-12 | Searchable order list; detail with receipt; refund requests with "Tandai sudah dikembalikan". |
| O-13 | User table (name, role, active); reset PIN; devices list with revoke and "Daftarkan perangkat ini". |
| O-14 | Grouped form: Toko, Pajak dan biaya, Pembayaran, Pesanan, Rekomendasi. |
| O-15 | Filterable table (date, actor, action); expandable metadata. |
| O-16 | List of QR tokens with label, status, preview and download; rotate requires confirmation. |

## 8. Interaction, motion and sound

| Topic | Spec |
|---|---|
| Transitions | 150–200 ms ease-out for sheets and dialogs; none for list updates on the Counter (avoid distraction) |
| Reduced motion | Respect `prefers-reduced-motion`: replace slide/pulse with a fade or static highlight |
| New order on Counter | Card highlight for 5 s plus a short, soft chime (user can mute in the header; mute state persists locally) |
| Ready on customer phone | Short vibration (`navigator.vibrate`, where supported) and a short sound; both after the first user interaction on the page; a visual state change is always present because sound and vibration are not guaranteed on iOS |
| Loading | Skeletons for lists; button spinners keep the label; no full-screen blocking spinners |
| Optimistic updates | Counter status buttons update immediately and roll back with a toast on failure |
| Press feedback | 100 ms scale or tint on touch |
| Confirmation | Only destructive actions get a confirmation step; routine status changes do not |

## 9. Content and microcopy (Indonesian)

Tone: friendly, short, polite but not stiff. Use "kamu" for customers, "Anda" in the owner area. Keys below belong in `src/i18n/id.json`.

| Key | Text |
|---|---|
| `menu.title` | Menu |
| `menu.soldOut` | Habis |
| `menu.recommended` | Rekomendasi |
| `cart.title` | Keranjang |
| `cart.empty` | Keranjang masih kosong |
| `cart.taxIncluded` | Harga sudah termasuk pajak |
| `cart.payQris` | Bayar dengan QRIS |
| `reco.title` | Sering dipesan bersama |
| `reco.add` | Tambah |
| `reco.continue` | Lanjut bayar |
| `pay.instruction` | Buka aplikasi bank atau e-wallet, scan, lalu bayar |
| `pay.countdown` | Bayar dalam {time} |
| `pay.expired` | Waktu pembayaran habis |
| `status.received` | Diterima |
| `status.preparing` | Disiapkan |
| `status.ready` | Siap diambil |
| `status.readyTitle` | Pesanan siap diambil! |
| `status.preparingText` | Pesananmu sedang disiapkan |
| `status.autoUpdate` | Layar ini otomatis diperbarui |
| `error.qrInvalid` | Kode QR sudah tidak berlaku. Silakan scan kode di kasir. |
| `error.itemSoldOut` | Maaf, ada menu yang habis |
| `error.priceChanged` | Harga diperbarui |
| `error.generic` | Ada gangguan, coba lagi |
| `error.validation` | Data yang dikirim tidak valid |
| `auth.loginFailed` | Email atau kata sandi salah |
| `auth.signInRequired` | Silakan masuk terlebih dahulu |
| `auth.forbidden` | Anda tidak punya akses untuk tindakan ini |
| `auth.deviceNotRegistered` | Perangkat ini belum terdaftar. Minta pemilik untuk mendaftarkannya. |
| `auth.elevationRequired` | Perlu konfirmasi PIN pemilik |
| `auth.rateLimited` | Terlalu banyak percobaan. Coba lagi nanti. |
| `counter.start` | Mulai |
| `counter.ready` | Siap |
| `counter.collected` | Diambil |
| `counter.pinWrong` | PIN salah. Sisa percobaan: {n} |
| `counter.locked` | Akun terkunci {minutes} menit |
| `counter.ownerPin` | Masukkan PIN pemilik untuk melanjutkan |
| `counter.voidAction` | Batalkan pesanan |
| `board.preparing` | Sedang disiapkan |
| `board.ready` | Siap diambil |
| `board.empty` | Belum ada pesanan |
| `owner.lowStock` | Stok menipis |
| `owner.noRecipe` | Resep belum ada |
| `chip.awaiting` | Menunggu bayar |
| `chip.paid` | Baru |
| `chip.preparing` | Disiapkan |
| `chip.ready` | Siap diambil |
| `chip.completed` | Selesai |
| `chip.expired` | Kedaluwarsa |
| `chip.voided` | Dibatalkan |
| `pin.delete` | Hapus |
| `pin.keypad` | Papan PIN |
| `pin.progress` | {entered} dari {total} digit |
| `common.close` | Tutup |
| `common.loading` | Memuat… |

Money format: `Rp 22.000`. Time: 24-hour (`18.30`). Dates: `8 Okt 2026`.

## 10. Accessibility checklist

- Contrast: all text and UI shapes meet WCAG 2.1 AA using the tokens in §4.2.
- Touch targets: ≥ 44 × 44 px on customer screens, ≥ 56 px on the Counter; 8 px gaps between targets.
- Focus: visible 3 px focus ring in `brand` with an `accent` outline on every interactive element; logical tab order.
- Labels: every input has a visible label; icon-only controls have `aria-label`.
- Live regions: order status changes and errors use `aria-live="polite"`/`"assertive"` appropriately.
- Not colour alone: status uses text and icons together.
- Zoom: layouts work at 200 % text size; no horizontal scrolling at 360 px width.
- Motion: reduced-motion supported; nothing flashes more than 3 times per second.
- Language: `lang="id"`; correct `inputmode` for PIN and numeric fields (`inputmode="numeric"`, `autocomplete="off"` for PINs).
- Test with axe and a manual keyboard-only pass on customer screens before Phase 1 is signed off.

## 11. Figma deliverables and handoff

1. **File structure:** pages `Foundations`, `Components`, `Customer`, `Counter`, `Board`, `Owner`, `Prototype flows`.
2. **Variables:** colour, spacing, radius and type tokens exactly as in §4; light mode only at first.
3. **Components** with all states in §5 as variants.
4. **Frames** named by screen ID and state, e.g. `C-05 Payment / default`, `C-05 Payment / expired`, `S-02 Counter / new order`.
5. **Prototype flows** for: (a) customer happy path C-01 → C-07, (b) sold-out at checkout, (c) payment expired, (d) counter walk-in order, (e) manual payment confirmation with owner PIN, (f) owner void.
6. **Annotations** where behaviour is not obvious (timers, auto-update, sound).
7. **Demo content** uses the seeded menu and the real recommendation output from the Apriori run (never invented percentages).
8. Export tokens to a `tokens.json` (or copy values into `tailwind.config`) so the code and Figma stay in sync.

Priority order for Figma if time is short: C-01 to C-07 and C-08, S-02, S-04, T-01, then owner O-03, O-09, then the rest.

## 12. Open design questions

| # | Question | Default until answered |
|---|---|---|
| DQ1 | Binary Brew logo and colours | Placeholder wordmark and the palette above |
| DQ2 | Real menu photos | Letter tiles |
| DQ3 | Does the shop have a TV or monitor for the board? | Design for it; any browser works |
| DQ4 | Preferred tablet size | Design at 1280×800, support 1024×768 |
| DQ5 | Opening hours text for the closed state | Hide the hours line |
