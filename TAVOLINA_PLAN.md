# Tavolina — Restaurant & Café Management System

> **Instructions for Claude Code**
> You are building a production-quality restaurant and café management platform from scratch.
> Read this whole document before writing code. Work **phase by phase** (section 15).
> At the end of each phase: run the tests, run the app, summarize what was built, list anything
> skipped or uncertain, and **stop and wait for my approval** before starting the next phase.
> Do not invent requirements outside this document. If something is ambiguous, pick the simplest
> option that fits the rest of the plan, write the decision in `docs/DECISIONS.md`, and continue.

---

## 1. Product summary

**Tavolina** ("table" in Albanian) is a multi-role system for restaurants, cafés and bars in Albania.
It replaces paper tickets, shouted orders and end-of-day Excel with one connected system:

- Guests scan a QR code on the table, browse a translated menu with photos, and order.
- Waiters manage tables and orders on a phone or tablet.
- Kitchen and bar see their own orders on screens (KDS) in real time.
- Cashiers take payment, split bills, and close tables.
- Managers control menu, stock, staff, shifts and voids.
- Owners see sales, margins and staff performance across one or more locations.

Primary market: Albanian cafés and restaurants (Tirana, Durrës, Elbasan, the coast).
Currency: Albanian lek (ALL). Default language: Albanian, with English and Italian.

**Product qualities that matter most:**
1. **Speed** — a waiter must be able to enter a 4-item order in under 10 seconds.
2. **Reliability** — no lost orders; the waiter app keeps working through short Wi-Fi drops.
3. **Accountability** — every void, discount and cash movement is logged with who and why.
4. **Modern, professional UI** — it should look like a premium SaaS product, not a school project.

---

## 2. Tech stack (use exactly this)

| Layer | Choice |
|---|---|
| Frontend | React 18 + Vite + TypeScript, React Router, TanStack Query, Zustand (local UI state) |
| Styling | Tailwind CSS with a custom design-token config (section 12), Radix UI primitives for dialogs/menus/popovers, lucide-react icons |
| Charts | Recharts |
| Backend | Node.js 20 + Express + TypeScript |
| Validation | Zod (shared schemas between client and server) |
| Database | MySQL 8, accessed with Knex (migrations + seeds + query builder) |
| Auth | JWT access token (15 min) + httpOnly refresh-token cookie (14 days); bcrypt for passwords; 4-digit PIN for quick staff switching |
| Real-time | Socket.IO (rooms per location, per station, per table) |
| Jobs | node-cron for scheduled tasks (end-of-day, low-stock alerts, reservation reminders) |
| File uploads | Multer + local `/uploads` folder (abstract behind a storage interface so S3/R2 can be added later); resize images with sharp |
| i18n | i18next (frontend), translation tables in DB for menu content |
| Testing | Vitest (unit), Supertest (API), Playwright (end-to-end) |
| Tooling | npm workspaces monorepo, ESLint, Prettier, Husky pre-commit |
| Deploy target | Docker Compose (api, web, mysql, nginx); ready for a VPS behind Cloudflare |

---

## 3. Monorepo structure

```
tavolina/
├─ apps/
│  ├─ api/                 # Express API + Socket.IO
│  │  ├─ src/
│  │  │  ├─ modules/       # one folder per domain: auth, menu, orders, tables, kds,
│  │  │  │                 # payments, inventory, staff, reservations, reports, settings, fiscal
│  │  │  │  └─ <module>/   # routes.ts, controller.ts, service.ts, repo.ts, schemas.ts, *.test.ts
│  │  │  ├─ realtime/      # socket server, event names, room helpers
│  │  │  ├─ middleware/    # auth, rbac, error handler, rate limit, request id, audit
│  │  │  ├─ jobs/
│  │  │  ├─ db/            # knexfile, migrations/, seeds/
│  │  │  └─ lib/           # money, time (Europe/Tirane), codes, logger (pino)
│  ├─ staff/               # React app: POS, waiter, KDS, cashier, manager, owner dashboards
│  └─ guest/               # React app: QR menu + ordering (mobile-first, very light bundle)
├─ packages/
│  ├─ shared/              # Zod schemas, TS types, enums, order state machine, money utils
│  └─ ui/                  # shared design-system components + Tailwind preset
├─ docker/
├─ docs/                   # DECISIONS.md, API.md, SETUP.md
└─ docker-compose.yml
```

Rules:
- Business logic lives in `service.ts`, never in controllers or React components.
- All DB access goes through `repo.ts`.
- Every request body, query and socket payload is validated with a Zod schema from `packages/shared`.

---

## 4. Roles and permissions (RBAC)

| Role | Main device | Can do |
|---|---|---|
| **Owner** | Laptop / phone | Everything, across all their locations. Billing, locations, reports. |
| **Manager** | Tablet / laptop | Menu, prices, stock, staff, shifts, approve voids/discounts/refunds, reports for their location. |
| **Waiter** | Phone / tablet | Open tables, take orders, send to kitchen, request bill, take payment if allowed, transfer tables. Only sees their own tables unless the setting allows all. |
| **Cashier** | POS terminal | Take payments, split bills, cash drawer, print receipts, close tables, end-of-shift cash count. |
| **Kitchen / Bar** | Wall screen / tablet | See and bump tickets for their station only. Mark items out of stock. |
| **Guest** (no account) | Own phone via QR | View menu, order to their table, call waiter, request bill, see order status. |

Implementation:
- Permissions are **named strings** (e.g. `order.void`, `menu.edit`, `report.view`), mapped to roles in a `role_permissions` table. Check permissions, never role names, in code.
- Sensitive actions (void a sent item, discount > X%, refund, open cash drawer without a sale, delete a paid order) require **manager PIN approval** inline: a dialog asks a manager to enter their PIN; the action is logged with both user IDs.
- Staff log in once per device with email + password (manager sets up the device), then switch users with a **4-digit PIN**. PINs are hashed and rate-limited (5 tries → 5-minute lock).

---

## 5. Modules and features

### 5.1 Locations & settings
- One owner account can have multiple locations (restaurants/cafés).
- Per location: name, address, NIPT (Albanian tax ID), logo, currency, timezone (Europe/Tirane), opening hours, service charge %, tax rates, receipt header/footer text, languages enabled, guest-ordering on/off, "waiters see all tables" on/off, tip options.

### 5.2 Floor plan & tables
- Multiple **areas** per location (Salla, Tarraca, Bar, VIP).
- Drag-and-drop **floor plan editor**: place tables (square, round, rectangle, bar stool), set seat count, name/number, rotate. Store x/y/w/h/rotation on a grid.
- Live floor view with table status by colour: **free, occupied, ordered, food ready, bill requested, needs cleaning, reserved**.
- Show elapsed time since seated, current total, assigned waiter, and guest count on each table.
- Actions: open table, merge tables, split table, transfer to another table, transfer to another waiter, close.
- Each table has a **QR code** (printable sheet generated per area) pointing to `guest.app/t/<tableToken>`. Tokens can be rotated by a manager.

### 5.3 Menu management
- Categories (ordered, with icon/image, availability schedule e.g. "Breakfast 07:00–11:30").
- Items: name, description, photo, price, cost (auto-calculated from recipe if one exists), tax rate, station routing (kitchen / bar / pizza / dessert…), prep time estimate, allergens (14 EU allergens), dietary tags (vegan, vegetarian, gluten-free, spicy), "popular" and "new" badges, active flag, visible-to-guests flag.
- **Variants** (size: small/large, with own price) and **modifier groups** (e.g. "Milk": whole/oat/none, min/max selections, price deltas, required or optional).
- **Translations** for name/description in sq/en/it (and room for more), stored in a translation table.
- **Price rules**: happy hour (time windows, weekdays, % or fixed), item-level or category-level.
- **86 / out of stock**: one tap from KDS or manager hides the item from guests and greys it out for waiters; can auto-return next day.
- Combos/menus (e.g. "Menu dreke": main + drink + coffee at a fixed price).
- Bulk import/export menu via CSV.

### 5.4 Ordering (waiter / POS)
- Fast order screen: categories on the left, items as large tap targets, current order on the right (stacks on phone).
- Search by name; favourites row; seat number per item; course (starter / main / dessert) with "fire course" control.
- Item notes (free text + quick chips: "pa kripë", "pa akull", "well done").
- **Send** routes each item to its station's KDS and optionally prints a station ticket.
- Items already sent can only be removed with a void (reason required; manager PIN if setting requires).
- Re-order a round ("same again") in one tap for bars and cafés.
- Takeaway and delivery order types (customer name, phone, pickup time; delivery address).

### 5.5 Guest QR ordering
- Mobile web app, no install, no account. Loads in under 2 seconds on 4G (keep the bundle small, lazy-load images).
- Language auto-detected from browser, switchable (sq/en/it).
- Beautiful photo-led menu with categories, search, allergen filters, item detail sheet with modifiers.
- Cart, notes, place order. Settings decide whether guest orders go **straight to the kitchen** or **wait for waiter confirmation** (default: waiter confirms).
- Live order status per item: received → preparing → ready → served.
- Buttons: **Call waiter**, **Request bill** (choose cash/card), **Leave a review** after payment.
- Multiple phones at one table share the same table session and see each other's items.
- Anti-abuse: table token must match an open or openable table; rate-limit orders per session; waiter can block a session.

### 5.6 Kitchen & bar display (KDS)
- Full-screen, dark, high-contrast, readable from 2 metres; designed for a wall-mounted tablet or TV.
- Each station sees only its items. Tickets are cards in columns (New → In progress → Ready), ordered by time.
- Each ticket shows table, waiter, order type, elapsed time with colour escalation (green < 10 min, amber < 20 min, red after), items with modifiers and notes highlighted, course and seat.
- Tap item to mark done; tap ticket header to bump the whole ticket; "recall" the last 10 bumped tickets.
- Ready items notify the waiter in real time (toast + table turns "food ready" on the floor).
- **All-day view**: counts of each item currently open (e.g. "6 × Tavë kosi").
- Sound alert on new ticket (user must tap once to enable audio). Offline indicator if the socket drops.

### 5.7 Bills & payments
- Bill view per table with items, modifiers, discounts, service charge, tax breakdown, total.
- **Split bill**: equally by N people, by seat, by selecting items, or custom amounts. Each split is paid separately.
- Payment methods: cash (with change calculation), card (record terminal reference), mixed, voucher, room charge / house account (optional).
- Tips: recorded per payment, assigned to the waiter.
- Discounts: % or fixed, per item or whole bill, with reason; above a threshold needs manager PIN.
- Refunds: full or partial, against a closed bill, always manager-approved, always logged.
- Receipt: print (ESC/POS via the print bridge, see 5.12) or show a QR the guest can scan for a digital receipt.
- **Fiscal invoice** issued on payment (see 5.11).

### 5.8 Cash management & shifts
- Open cash drawer with a starting float; record pay-ins and pay-outs (e.g. bought ice, paid supplier) with reason.
- End of shift: cashier counts cash by denomination (ALL notes and coins), system shows expected vs counted and the difference; manager approves.
- **Z report / end of day**: totals by payment method, tax, discounts, voids, refunds, tips, items sold, per waiter. Locks the business day.
- Staff clock in/out with PIN; shift schedule per week; hours report for payroll export (CSV).

### 5.9 Inventory & recipes
- Ingredients with unit (kg, g, l, ml, piece), current stock, minimum level, cost per unit, supplier.
- **Recipes**: each menu item (and modifier, e.g. "extra shot") links to ingredient quantities. Selling an item **auto-deducts stock** when the order is sent (configurable: on send or on payment).
- Food cost and margin per item calculated from recipe × current ingredient cost.
- Suppliers, **purchase orders** (draft → sent → received, partial receive updates stock and cost using weighted average).
- Waste / spoilage entries with reason; staff meals.
- Stock counts (full or by category): enter counted quantity, system shows variance in quantity and lek.
- Low-stock alerts on the manager dashboard and optionally by email.

### 5.10 Reservations
- Calendar and list view per day; time slots; party size; table assignment with conflict detection.
- Guest name, phone, notes (birthday, high chair), status: booked → confirmed → seated → completed / no-show / cancelled.
- Public booking widget (embeddable page) with availability rules per location; manager can turn it off.
- Reserved tables show on the floor plan 60 minutes before arrival.

### 5.11 Fiscalization (Albania)
Albania requires invoices to be fiscalized with the tax authority (DPT). Each fiscal invoice carries an issuer
security code (NSLF/IIC) and a unique invoice identifier (NIVF/FIC) and a verification QR.
**Do not implement the real DPT connection in the MVP.** Instead:
- Create a `FiscalProvider` interface: `registerInvoice(invoice) → { nslf, nivf, qrUrl, status }`, plus `registerCashDeposit`, `registerWithdrawal`.
- Implement a `MockFiscalProvider` that returns realistic fake codes, and store everything in `fiscal_invoices`.
- Persist all fields the real integration will need (business unit code, operator code, TCR code, software code, invoice number per TCR per year, tax breakdown, payment method type).
- Failed/pending fiscalizations are queued and retried by a job; the receipt shows "pending" until confirmed.
- Note in `docs/DECISIONS.md` that the real provider must be implemented and certified against current DPT specifications before go-live.

### 5.12 Printing
- Browsers cannot talk to thermal printers directly. Create a tiny **print bridge**: a separate Node app (`apps/print-bridge`) that runs on a PC in the restaurant, connects to the API via Socket.IO, and prints ESC/POS to network (IP:9100) or USB printers.
- Printer routing table: station tickets (kitchen, bar), customer receipts, Z report.
- If no printer is configured, everything still works on screens only.

### 5.13 Reports & dashboards
- **Owner/manager dashboard (today, live)**: revenue so far vs same weekday last week, open tables, average ticket, covers, top items, kitchen average prep time, low-stock list, voids today.
- Reports with date range and location filters, exportable to CSV:
  - Sales by day/hour (heatmap of busiest hours), by category, by item, by waiter, by payment method, by order type
  - Product mix and margin (uses recipe costs)
  - Discounts, voids, refunds (with who approved)
  - Tips per waiter
  - Inventory valuation, consumption, waste, variance
  - Staff hours
- Charts: line (revenue over time), bar (top items), heatmap (hour × weekday), donut only for payment-method share.

### 5.14 Audit log
- Append-only `audit_logs`: who, what (action key), entity type/id, before/after JSON, approved_by, device, IP, timestamp.
- Viewer screen for managers with filters. Never editable or deletable from the app.

### 5.15 Offline resilience (waiter + KDS)
- Waiter app queues outgoing actions (new order, send, payment) in IndexedDB when the API is unreachable, shows an "offline – N actions waiting" banner, and replays them in order on reconnect.
- Every client-created entity uses a **client-generated UUID** so replays are idempotent; the API ignores duplicates (`Idempotency-Key` header).
- KDS shows a clear "Connection lost" state and refetches on reconnect.

---

## 6. Order lifecycle (state machine — implement in `packages/shared`)

**Order** (one per table session or takeaway): `open → closed` (or `cancelled`).
**Order item** statuses:

```
draft ──send──▶ sent ──start──▶ preparing ──done──▶ ready ──serve──▶ served
  │               │                 │                   │
  └──remove       └──void* ─────────┴──void* ───────────┘
                                   (* reason required, manager PIN per settings)
```

- `draft` items are only on the waiter's device / unsent order; removing them is free.
- A guest order item starts as `pending_confirmation` when waiter confirmation is enabled, then becomes `sent`.
- Only valid transitions are allowed; the API rejects others with 409. Unit-test every transition.
- **Table session**: `open → bill_requested → paid → closed`. A table can be closed only when the balance is 0.

---

## 7. Database schema (MySQL 8 — create with Knex migrations)

Conventions: `id` BIGINT UNSIGNED auto-increment PK plus `uuid` CHAR(36) unique for client-created rows;
`location_id` on every location-scoped table; `created_at`/`updated_at`; soft delete with `deleted_at`
where history matters. **Money is stored as integers in minor units** (`amount_minor`, 1 lek = 100) to avoid float errors.
Add foreign keys and indexes for every lookup column.

**Accounts & access**
- `owners_accounts` (company name, NIPT, plan, status)
- `locations` (account_id, name, address, nipt, timezone, currency, settings JSON)
- `users` (account_id, name, email, password_hash, pin_hash, phone, active, lang)
- `user_locations` (user_id, location_id, role)
- `roles`, `permissions`, `role_permissions`
- `devices` (location_id, name, type: pos/waiter/kds/print_bridge, station_id, last_seen_at)
- `refresh_tokens` (user_id, device_id, token_hash, expires_at, revoked_at)

**Floor**
- `areas` (location_id, name, sort)
- `tables` (area_id, name, seats, shape, x, y, w, h, rotation, qr_token, active)

**Menu**
- `stations` (location_id, name, type: kitchen/bar/other, printer_id)
- `menu_categories` (location_id, parent_id, sort, image_url, available_from, available_to, weekday_mask, active)
- `menu_items` (category_id, station_id, price_minor, cost_minor, tax_rate_id, prep_minutes, image_url, is_popular, is_new, guest_visible, active, out_of_stock_until)
- `menu_item_variants` (item_id, name, price_minor, sort)
- `modifier_groups` (location_id, name, min_select, max_select, required)
- `modifiers` (group_id, name, price_delta_minor, sort, active)
- `menu_item_modifier_groups` (item_id, group_id, sort)
- `translations` (entity_type, entity_id, field, lang, value) — unique (entity_type, entity_id, field, lang)
- `allergens`, `menu_item_allergens`, `dietary_tags`, `menu_item_tags`
- `price_rules` (location_id, scope: item/category, scope_id, type: percent/fixed, value, weekday_mask, time_from, time_to, date_from, date_to, active)
- `combos`, `combo_slots`, `combo_slot_items`
- `tax_rates` (location_id, name, rate_bp) — rate in basis points (2000 = 20%)

**Orders**
- `table_sessions` (uuid, location_id, table_id, waiter_id, guest_count, status, opened_at, closed_at)
- `orders` (uuid, location_id, table_session_id NULL, type: dine_in/takeaway/delivery, number, customer_name, customer_phone, delivery_address, status, subtotal_minor, discount_minor, service_minor, tax_minor, total_minor, opened_by, closed_at)
- `order_items` (uuid, order_id, menu_item_id, variant_id, name_snapshot, unit_price_minor, qty, seat, course, notes, status, station_id, source: staff/guest, sent_at, ready_at, served_at, voided_at, void_reason, voided_by, void_approved_by)
- `order_item_modifiers` (order_item_id, modifier_id, name_snapshot, price_delta_minor)
- `guest_sessions` (uuid, table_session_id, device_fingerprint, lang, blocked, created_at)
- `service_requests` (table_session_id, type: call_waiter/bill_cash/bill_card, status, created_at, handled_by, handled_at)
- `kds_tickets` (order_id, station_id, number, status, created_at, bumped_at) and `kds_ticket_items` (ticket_id, order_item_id)

**Payments & money**
- `bills` (uuid, order_id, split_type, label, total_minor, status: open/paid/refunded)
- `bill_items` (bill_id, order_item_id, qty_share or amount_minor)
- `payments` (uuid, bill_id, method: cash/card/voucher/account, amount_minor, tip_minor, change_minor, reference, taken_by, created_at)
- `discounts` (order_id, order_item_id NULL, type, value, amount_minor, reason, created_by, approved_by)
- `refunds` (payment_id, amount_minor, reason, created_by, approved_by)
- `cash_drawers` (location_id, device_id, opened_by, opening_float_minor, opened_at, closed_by, counted_minor, expected_minor, difference_minor, closed_at, approved_by)
- `cash_movements` (drawer_id, type: pay_in/pay_out/sale/refund/tip_out, amount_minor, reason, user_id)
- `business_days` (location_id, date, status: open/closed, z_report JSON, closed_by, closed_at)
- `fiscal_invoices` (payment/bill reference, tcr_code, invoice_number, year, nslf, nivf, qr_url, status: pending/registered/failed, attempts, last_error, payload JSON, response JSON)

**Inventory**
- `units`, `ingredients` (location_id, name, unit_id, stock_qty DECIMAL(12,3), min_qty, cost_per_unit_minor, supplier_id)
- `recipes` (menu_item_id or modifier_id, ingredient_id, qty)
- `stock_movements` (ingredient_id, type: sale/purchase/waste/count_adjust/staff_meal/transfer, qty, unit_cost_minor, ref_type, ref_id, user_id, created_at) — **stock_qty is always derived from or reconciled with this ledger**
- `suppliers`, `purchase_orders`, `purchase_order_lines`
- `stock_counts`, `stock_count_lines`

**Staff & reservations**
- `shifts` (location_id, user_id, starts_at, ends_at, role) and `time_entries` (user_id, clock_in, clock_out, location_id)
- `reservations` (uuid, location_id, table_id NULL, name, phone, party_size, starts_at, duration_min, notes, status, source: staff/widget)

**System**
- `audit_logs`, `printers`, `print_jobs`, `notifications`, `reviews` (table_session_id, rating, comment)

---

## 8. API design

REST, JSON, base path `/api/v1`, location chosen by header `X-Location-Id` (validated against the user's access).
Errors use one format: `{ "error": { "code": "ORDER_ITEM_ALREADY_SENT", "message": "...", "details": {} } }`.
Paginate lists with `?cursor=&limit=`. All mutating endpoints accept an `Idempotency-Key` header.

Key endpoint groups (document every endpoint in `docs/API.md`):

```
POST   /auth/login | /auth/pin | /auth/refresh | /auth/logout
GET    /me

GET/POST/PATCH  /locations, /areas, /tables, /tables/:id/qr
GET    /floor                       # live floor state for the location

GET/POST/PATCH/DELETE  /menu/categories, /menu/items, /menu/modifier-groups, /menu/price-rules
POST   /menu/items/:id/out-of-stock
POST   /menu/import  GET /menu/export

POST   /table-sessions               # open table
POST   /table-sessions/:id/transfer | /merge | /split | /close
POST   /orders                       # create (dine-in/takeaway/delivery)
POST   /orders/:id/items             # add draft items
POST   /orders/:id/send              # send drafts to stations
POST   /order-items/:id/void         # requires reason (+ approval token when needed)
PATCH  /order-items/:id/status       # KDS transitions
POST   /approvals                    # manager PIN → short-lived approval token for one action

GET    /kds/:stationId/tickets  POST /kds/tickets/:id/bump | /recall

POST   /orders/:id/bills/split       # equal | by-seat | by-items | custom
POST   /bills/:id/payments
POST   /payments/:id/refund
POST   /orders/:id/discounts

POST   /cash-drawers/open | /:id/movements | /:id/close
POST   /business-days/close          # Z report

CRUD   /ingredients, /recipes, /suppliers, /purchase-orders, /stock-counts, /waste
CRUD   /reservations  GET /reservations/availability
CRUD   /staff, /shifts  POST /time-entries/clock-in | clock-out

GET    /reports/sales | /items | /staff | /payments | /discounts-voids | /inventory | /hours
GET    /audit-logs

# Guest (public, no JWT; authenticated by table token + guest session cookie)
GET    /guest/t/:tableToken          # location, table, menu (translated), session
POST   /guest/t/:tableToken/orders
POST   /guest/t/:tableToken/requests # call waiter / request bill
GET    /guest/sessions/:id/status
POST   /guest/sessions/:id/review
```

---

## 9. Real-time events (Socket.IO)

Rooms: `location:<id>`, `station:<id>`, `table-session:<id>`, `user:<id>`, `print-bridge:<locationId>`.
Every event payload is a Zod-validated object with `{ type, locationId, at, data }`.

| Event | Room | Purpose |
|---|---|---|
| `table.updated` | location | Floor colours, totals, timers |
| `order.items_sent` | station + location | New KDS ticket |
| `order_item.status_changed` | location + table-session | Ready/served updates for waiter and guest |
| `kds.ticket_bumped` | station + location | Remove/recall ticket |
| `service_request.created` | location + user (assigned waiter) | Call waiter / bill request |
| `guest_order.pending` | location + user | Waiter must confirm guest order |
| `menu.item_availability` | location | Out-of-stock changes |
| `print.job` | print-bridge | Print a ticket or receipt |
| `stock.low` | location (managers) | Low-stock alert |

Clients refetch the relevant TanStack Query keys on reconnect; events are a hint, the REST API is the source of truth.

---

## 10. Business rules (must be enforced server-side and unit-tested)

1. Prices, modifiers and names are **snapshotted** onto `order_items` at the moment the item is added; later menu changes never alter existing orders.
2. Totals are always recalculated on the server: line = (unit price + modifier deltas) × qty; then item discounts → bill discounts → service charge → tax. Round per line to the nearest lek. Prices are **tax-inclusive** (Albanian retail norm); tax is extracted for the breakdown.
3. A sent item cannot be edited, only voided (with reason). A void after `preparing` also records waste if the setting "count voided prepared items as waste" is on.
4. A table session cannot be closed while any bill has a balance > 0.
5. A business day cannot be closed while tables are open or a cash drawer is open.
6. Happy-hour price rules apply based on the **time the item was added**, in Europe/Tirane time.
7. Stock deduction happens in the same DB transaction as `send` (or payment, per setting), via `stock_movements`.
8. Guest orders are rejected if the table session is closed, the guest session is blocked, or more than 5 orders per minute come from one session.
9. Every void, discount above threshold, refund, drawer opening without a sale, price change and permission change writes an audit log row.
10. Order and ticket numbers reset daily per location and are unique within the business day.

---

## 11. Security

- Helmet, CORS allowlist, rate limiting (stricter on `/auth/*` and `/guest/*`), request size limits.
- Passwords bcrypt cost 12; PINs bcrypt with lockout; refresh tokens stored hashed and rotated on every use.
- RBAC middleware: `requirePermission('order.void')`; location scoping middleware on every route.
- Approval tokens: a manager PIN creates a single-use token valid for 60 seconds and bound to one action + entity.
- Never trust client totals or prices.
- Uploaded images: type sniffing, max 5 MB, re-encoded with sharp.
- `.env` for secrets; `.env.example` committed; no secrets in the repo.
- SQL only through Knex parameter binding.

---

## 12. Design system & UX (make it look premium)

**Direction:** calm, confident, modern hospitality software. Clean surfaces, generous spacing, strong type,
one warm accent. Think of the polish of Linear or Toast, but warmer. Avoid generic Bootstrap/admin-template looks.

**Tokens (Tailwind preset in `packages/ui`):**
- Colours: neutral scale with a slight warm-olive bias (not pure grey); accent **deep olive/espresso** for primary actions; a warm saffron for highlights; semantic success/warning/danger/info separate from the accent.
- Table/ticket status colours must be distinguishable by **colour + icon + label**, never colour alone.
- Fonts: a geometric-humanist sans for UI (e.g. "Manrope" or "Plus Jakarta Sans"), a tabular mono for prices, timers and numbers ("JetBrains Mono" or "IBM Plex Mono"). Use `tabular-nums` everywhere digits align.
- Radius: 10px for controls, 14px for cards, full for pills. Shadows subtle and used only to lift overlays.
- Full **light and dark** themes for staff apps; KDS is dark-only; guest app follows system theme.

**Per-surface UX:**
- **POS / waiter (tablet-first, works on phone):** large touch targets (min 48px), item grid with photos optional, sticky order panel, swipe actions on order lines, bottom sheets on phone, haptic-style micro-feedback, everything reachable with one thumb on phone.
- **KDS:** large type (item names ≥ 22px), high contrast, colour-escalating timers, zero clutter, no small buttons.
- **Manager/owner (desktop-first):** left sidebar navigation, top bar with location switcher and date range, data tables with sticky headers, filters, column sorting, CSV export, empty states that explain what to do next.
- **Guest app:** photo-led, appetising, fast. Sticky category bar, bottom cart bar with item count and total, item detail as a bottom sheet, clear allergen icons, big "Order" button, live status timeline after ordering.

**Quality bar:**
- Skeleton loaders, optimistic updates for waiter actions, toasts for confirmations, inline validation messages that say how to fix the problem.
- Keyboard shortcuts on POS desktop (number keys for quantity, `/` for search, `Enter` to send).
- Accessibility: visible focus rings, ARIA labels on icon buttons, WCAG AA contrast, `prefers-reduced-motion` respected.
- Every list has an empty state, every async action has loading and error states.

---

## 13. Internationalization

- UI strings in `locales/{sq,en,it}/*.json` via i18next; Albanian is the source language. No hard-coded user-facing strings.
- Menu content translations from the `translations` table, falling back to Albanian.
- Dates and numbers formatted for the selected language; prices shown as `1 200 L` (space thousands separator, "L" suffix) with a setting for `ALL`.
- Receipts print in the location's default language.

---

## 14. Seed data (realistic demo)

Create a seed for a demo bar-restaurant **"Bar Restaurant Las Vegas", Tirana** so the app looks real on first run:
- 2 areas (Salla: 12 tables, Tarraca: 8 tables) with a laid-out floor plan.
- Stations: Kuzhina, Bar.
- ~60 menu items in Albanian with English and Italian translations: coffees (Espresso 100 L, Makiato 120 L, Kapuçino 180 L, Freddo espresso 200 L), çaj mali, fresh juices, beers (Korça, Birra Tirana), raki, wines; breakfast (byrek, petulla me mjaltë, omëletë); mains (tavë kosi, fërgesë, qofte të fërguara, pule në skarë, peshk levrek); salads; desserts (trileçe, bakllava, sultjash). Realistic lek prices.
- Modifier groups: milk type, sugar level, ice, steak doneness, extra shot.
- Ingredients and recipes for at least the coffees and 10 dishes, so margins and stock deduction work.
- Users: owner, manager, 3 waiters, 1 cashier, kitchen device, bar device (document demo credentials in `docs/SETUP.md`).
- 30 days of generated historical orders with plausible hourly patterns (morning coffee peak, lunch, evening) so reports and dashboards have data.

---

## 15. Build phases (stop after each one for approval)

**Phase 0 — Foundation**
Monorepo, TypeScript configs, ESLint/Prettier, Docker Compose (MySQL), Knex setup, Express skeleton with error handling, logger, health check, shared package, UI package with Tailwind preset and base components (Button, Input, Select, Dialog, Sheet, Table, Badge, Card, Toast, Skeleton, EmptyState), i18n setup.
*Done when:* `docker compose up` + `npm run dev` start API and both apps; a component showcase page renders all base components in light and dark.

**Phase 1 — Auth, locations, staff, RBAC**
Migrations for accounts/users/roles/permissions/devices; login, refresh, PIN switch, approval tokens; location switcher; staff management screens.
*Done when:* each role logs in and sees only its allowed navigation; API tests cover permission denial and PIN lockout.

**Phase 2 — Menu management**
Categories, items, variants, modifiers, translations, allergens, images, price rules, out-of-stock, CSV import/export. Seed the demo menu.
*Done when:* manager can build the full demo menu in the UI; guest-facing menu endpoint returns translated data.

**Phase 3 — Floor plan & tables**
Areas, drag-and-drop floor editor, live floor view, table sessions (open/transfer/merge/split/close), QR code sheet generation.
*Done when:* floor view updates in real time across two browser windows.

**Phase 4 — Ordering & KDS (core loop)**
Order screen, drafts, send, station routing, KDS with timers, bump/recall, ready notifications, order state machine with full tests, offline queue for the waiter app.
*Done when:* Playwright test: waiter orders 3 items → they appear on correct KDS stations → kitchen bumps → waiter sees "ready" → waiter marks served.

**Phase 5 — Guest QR app**
Menu browsing, cart, ordering with waiter confirmation, live status, call waiter, request bill, shared table session, rate limiting.
*Done when:* Playwright test covers guest order → waiter confirm → KDS → guest sees status change.

**Phase 6 — Bills, payments, cash, fiscal mock**
Bill view, all split types, cash/card/mixed payments, tips, discounts and voids with approvals, receipts, cash drawers, Z report, `MockFiscalProvider` with retry job, print bridge app.
*Done when:* totals match hand-calculated test fixtures (including happy hour, discounts, service charge, tax extraction); Z report numbers reconcile with payments.

**Phase 7 — Inventory**
Ingredients, recipes, auto-deduction, suppliers, purchase orders, waste, stock counts, low-stock alerts, margins.
*Done when:* selling 10 cappuccinos deducts the right milk and coffee; a stock count produces the correct variance.

**Phase 8 — Reservations & staff time**
Reservation calendar, availability, public booking page, floor integration; shifts and clock in/out; hours export.

**Phase 9 — Reports & dashboards**
Live dashboard and all reports from 5.13 with charts and CSV export, using the 30-day seed history.

**Phase 10 — Hardening & polish**
Audit log viewer, security review against section 11, performance pass (guest bundle size, DB indexes, N+1 queries), accessibility pass, empty/error states everywhere, full Playwright suite, `docs/SETUP.md` and `docs/API.md` complete, production Docker build.

---

## 16. Testing requirements

- Unit tests for: money/tax calculation, price rules, order state machine, split-bill math, stock deduction, permission checks.
- API tests (Supertest + a test MySQL database reset per suite) for every module's happy path and main failure cases.
- Playwright end-to-end tests for the core flows in phases 4, 5 and 6.
- Target: all business-rule code in section 10 covered by tests. CI script `npm run test:all` must pass before ending a phase.

---

## 17. Out of scope for the MVP (do not build yet)

Real DPT fiscal connection, online card payments for guests, delivery-platform integrations (Wolt, Baboon), loyalty programme, multi-currency, native mobile apps, accounting-software export beyond CSV, AI features.
Leave clean extension points for fiscal provider, payment provider and storage.

---

## 18. Definition of done (whole project)

- A new restaurant can be set up (location, floor, menu, staff) entirely through the UI in under 30 minutes.
- The full service loop works in real time across devices: guest/waiter order → KDS → serve → bill → split → pay → receipt → Z report.
- Every money number on screen matches the server calculation and reconciles in reports.
- Works on a phone (waiter, guest), a tablet (POS, KDS) and a laptop (manager, owner), in light and dark, in Albanian, English and Italian.
- No console errors, no failing tests, documented setup that a new developer can follow in 15 minutes.
