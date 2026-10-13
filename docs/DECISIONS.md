# Decisions

Decisions made where `TAVOLINA_PLAN.md` was ambiguous or where the environment forced a choice.
Newest at the bottom. Each entry: context → decision → consequences.

## D-001 — Repository root is this folder (Phase 0)

The plan shows the monorepo under a `tavolina/` folder. The project folder already exists and holds
the plan, so the monorepo lives directly in it (`apps/`, `packages/`, `docs/` at the top level).
The npm package is still named `tavolina`.

## D-002 — Non-default dev ports (Phase 0)

On the development machine, 3306 (a local `mysqld`), 4000 and 5174 were already taken. Defaults are now:

| Service      | Port |
| ------------ | ---- |
| MySQL (host) | 3310 |
| API          | 4100 |
| Staff app    | 5180 |
| Guest app    | 5181 |

All are configurable in `.env`. The Vite dev servers proxy `/api` and `/socket.io` to the API, so the browser
only ever talks to one origin per app.

## D-003 — npm script shell on Windows (Phase 0)

The folder path contains `&` (`Restaurant & Cafe Managment System`). npm's generated `.cmd` shims
(`node_modules/.bin/*.cmd`) break under `cmd.exe` when the path has `&`, so every `npm run` script that
calls a local binary (`tsc`, `vite`, `eslint`…) failed.

Decision: a project `.npmrc` sets `script-shell` to Git Bash (`C:\Program Files\Git\bin\bash.exe`),
which uses the POSIX shims and handles the path correctly.

Consequences: Windows developers need Git for Windows at the default path. `.npmrc` is excluded from
Docker builds (`.dockerignore`). **Recommended:** rename the folder to something without `&` (e.g.
`tavolina`) and delete `.npmrc`.

## D-004 — Node 24 locally, Node 20 as the floor (Phase 0)

The plan says Node.js 20. The machine has Node 24. `engines` is `>=20` and the API build targets `node20`,
so code stays compatible with 20. Production Docker images (Phase 10) will use Node 20 LTS or newer.

## D-005 — Current major versions of libraries (Phase 0)

Installed versions are the current majors at the time of writing: TypeScript 6, ESLint 10 (flat config),
Vitest 5, Vite 8, Express 5, Zod 4, Knex 3, React Router 7, i18next 26, TanStack Query 5, Zustand 5.
The plan pins two things, which we follow:

- **React 18** (`^18.3`), not 19.
- **Tailwind CSS 3** (`^3.4`), because the plan asks for a Tailwind _preset_ (a v3 concept).
  `tailwind-merge` is therefore pinned to v2 (v3 targets Tailwind 4).

## D-006 — Workspace packages ship TypeScript source (Phase 0)

`@tavolina/shared` and `@tavolina/ui` have no build step; their `exports` point at `src/*.ts`.
Vite compiles them for the frontends, `tsx` runs them in API dev, and `tsup` bundles them into the
API production build (`noExternal: [/^@tavolina\//]`). This keeps one source of truth with no
watch/rebuild step.

## D-007 — One `.env` at the repo root, no `NODE_ENV` in it (Phase 0)

The API, the Vite apps (`envDir` = repo root) and `docker compose` all read the root `.env`.
`NODE_ENV` must **not** be set there: Vite applies it to builds, and `NODE_ENV=development` made
production bundles ship React's development build (found during Phase 0, ~3× larger). The API
defaults to `development`; Vitest sets `test`; production sets it in the container environment.

## D-008 — Money display uses non-breaking spaces (Phase 0)

The plan's format is `1 200 L`. `formatMoney` uses U+00A0 for both the thousands separator and before
the suffix, so amounts never wrap across lines on receipts, KDS tickets or narrow phone layouts.
Negative amounts use the true minus sign (`−500 L`). Whole lek is the default; `showDecimals` shows
qindarka as `123,45 L`.

## D-009 — Rounding mode (Phase 0)

"Round per line to the nearest lek" (business rule 2) is implemented as round-half-away-from-zero on
minor units (`roundToLek`: 12 350 → 12 400, −150 → −200). Phase 6 builds totals on this helper.

## D-010 — Component showcase location (Phase 0)

The base-component showcase lives in the staff app at `/dev/showcase`. In Phase 1 it will stay
reachable without login in development builds only.

## D-011 — Playwright deferred to Phase 4 (Phase 0)

The plan requires Playwright only for the flows in phases 4–6. Installing it now would download
browser binaries for a single smoke check. Phase 0 was checked manually in the browser (see the phase
summary); Playwright is set up in Phase 4 with the first required end-to-end test.

## D-012 — Fiscalization: real DPT provider required before go-live

(Recorded early as required by plan §5.11.) The MVP will ship only a `MockFiscalProvider`. A real
`FiscalProvider` implementation must be built and certified against the current DPT (Albanian tax
authority) specifications before any production use.

## D-013 — Demo business is "Bar Restaurant Las Vegas" (requested after Phase 0)

The owner asked for the demo business to be **"Bar Restaurant Las Vegas"** (Tirana) instead of the
plan's "Kafe Lulishte". `TAVOLINA_PLAN.md` §14 and the showcase copy were updated. Phase 1+ seeds
(location, receipts, QR sheets, demo data) use this name. The product itself is still called
**Tavolina**.

## D-014 — Approval tokens live in an `approvals` table (Phase 1)

Plan §11 wants manager-PIN approvals as single-use, 60-second tokens bound to one action + entity.
They need to survive across API instances and be consumed atomically, so they are stored (hashed) in
an `approvals` table that is not in the plan's schema list. `consumeApproval()` marks a token used
with a single conditional `UPDATE`, inside the transaction of the action it authorises.

## D-015 — Idempotency keys (Phase 1)

`Idempotency-Key` on any mutating request stores the first response in `idempotency_keys`, scoped per
user, and replays it for repeats with the same method, path, location and body (`Idempotent-Replayed:
true`). The same key with a different body is `422 IDEMPOTENCY_KEY_REUSED`. 4xx responses are stored
(they are deterministic); 5xx are not, so the client can retry. The staff app sends a fresh key per
call and reuses it if the call is retried after a token refresh. A cleanup job for old keys comes with
the jobs work in a later phase.

## D-016 — Role permissions are synced from code (Phase 1)

The plan keeps the role → permission mapping in `role_permissions` (and code must check permissions,
never role names). The default mapping is defined once in `packages/shared/src/permissions.ts` and
synced into `roles`, `permissions` and `role_permissions` after every migration and at API start-up.
Editing role permissions per location is out of scope for the MVP; the sync would overwrite manual
DB edits.

## D-017 — One role for kitchen and bar screens (Phase 1)

Plan §4 lists "Kitchen / Bar" as one role. It is the `kitchen` role; which tickets a screen shows is
decided by the device's station (Phase 4), not by the role.

## D-018 — Refresh-token rotation and reuse detection (Phase 1)

Every refresh revokes the presented token and issues a new one in the same "family". Presenting an
already-rotated token more than 20 seconds after its rotation is treated as theft and revokes the
whole family. Within 20 seconds it is treated as two tabs racing: the API answers `401` with
`details.retry = true` and the client retries once (its cookie has already been updated by the
other tab). Logout revokes the family; deactivating a user or resetting their password revokes all of
their tokens.

## D-019 — Shared devices: PIN switch and a client-side lock (Phase 1)

A device is signed in once with email + password; the refresh cookie is the device session. "Switch
user" locks the screen: the access token is dropped from memory and a `tavolina.locked` flag is kept
in localStorage so a page reload goes straight back to the PIN screen. Staff tap their name and enter
their PIN (`POST /auth/pin`), which revokes the device's current token and issues a new session for
that person on the same device. PINs are not unique, so the person is chosen first; lockout
(5 wrong → 5 minutes) is per person and shared with manager approvals.

The lock is a convenience, not a security boundary: the refresh cookie still belongs to the last user
until someone enters a PIN. A server-side lock state is a possible Phase 10 hardening item.

## D-020 — Access model details (Phase 1)

- Roles are per location (`user_locations`); `users.active` is account-wide, so deactivating someone
  signs them out everywhere.
- Owners have the `owner` role at each location. When a location is created, every owner of the
  account is granted access to it.
- You may only grant roles whose permissions are a subset of your own, and only manage people whose
  current role you could grant. This stops managers from creating or editing owners without naming
  roles in code. Nobody can change their own role or deactivate themselves.
- A user with no locations cannot sign in (`403 LOCATION_FORBIDDEN`).
- Login errors are the same for unknown email and wrong password, and take the same time.

## D-021 — Rate limits (Phase 1)

`/auth/login`, `/auth/pin`, `/auth/pin-users` and `/approvals`: 20 requests per minute per IP. The
whole API: 600 per minute per IP. Limits are skipped when `NODE_ENV=test`; a dedicated rate-limit
test belongs to the Phase 10 security pass.

## D-022 — Deferred within Phase 1

- **Device management screen** (rename, revoke, assign a KDS station): devices are registered on
  login and stored, but the UI comes in Phase 4 with stations.
- **Opening hours editor**: stored in location settings with defaults (07:00–23:00); edited in
  Phase 8 with reservations, which is the first feature that uses them.
- **Self-service PIN change** for staff without `staff.manage`; a manager sets PINs for now.
- **Production migration runner**: migrations run from TypeScript with tsx; the production image
  (Phase 10) needs them compiled or run with tsx.

## D-023 — Menu translations: main language on the row, others in `translations` (Phase 2)

Each category, item, variant, modifier group and modifier stores its name/description in the
location's main language (Albanian for the demo) on its own row. Other languages live in the
`translations` table, one row per (entity, field, language). Guests get the requested language with a
per-field fallback to the main language, so a missing Italian description shows the Albanian one.

## D-024 — Price rules: percent or fixed amount off, no stacking (Phase 2)

Plan §5.3 says "% or fixed". A rule takes either a percentage off (basis points) or a fixed lek amount
off the unit price; results are rounded to whole lek and never go below 0. Rules apply to one item or
to a category (including its subcategories), on chosen weekdays, in an optional time window (which may
cross midnight) and an optional date range, all in Europe/Tirane time. When several rules apply, the
**lowest price wins**; they do not stack. Modifier prices are never discounted. The same function
(`effectivePrice` in packages/shared) will price order lines in Phase 4 (business rule 6).

## D-025 — Out of stock ("86") (Phase 2)

`out_of_stock_until` on the item: "today" sets it to the next 04:00 Tirana time (the item returns
automatically the next morning), "indefinite" sets a far-future date until someone turns it back on,
"back" clears it. Kitchen/bar roles can do this (`menu.availability`). 86ed items are hidden from
guests. The real-time `menu.item_availability` event comes with the Socket.IO server in Phase 3.

## D-026 — One level of subcategories (Phase 2)

Categories support a parent, but only one level deep (a subcategory cannot have children), which keeps
the guest menu and the order screen simple.

## D-027 — Menu images (Phase 2)

Photos are uploaded per item (and category) as multipart `image`, max 5 MB, type checked by sharp
(not by name/MIME), EXIF stripped, re-encoded to WebP: up to 1200 px plus a 480×360 thumbnail
(`x.webp`, `x-thumb.webp`). Files go through a `FileStorage` interface (local disk in
`apps/api/uploads`, served at `/uploads` with immutable caching); S3/R2 can be added later. Replacing
or removing a photo deletes the old files. The demo seed has no photos.

## D-028 — CSV import/export (Phase 2)

Columns: `id, category, name, name_en, name_it, description, description_en, description_it, price,
cost, station, tax_rate, prep_minutes, allergens, tags, popular, new, guest_visible, active`. Only
`category`, `name`, `price` are required; columns left out of a file are not changed on existing items.
Rows match by `id`, else by category + name; unknown categories are created. Import is always checked
first (dry run) and then applied all-or-nothing in one transaction. Row problems return
`422 IMPORT_INVALID` with coded errors the app translates. Variants and modifier groups are not part
of the CSV. Export starts with a UTF-8 BOM so Excel shows ë/ç correctly.

## D-029 — Public guest menu by location (Phase 2)

The plan's guest endpoint is `/guest/t/:tableToken`, but tables arrive in Phase 3. To make the
translated guest menu available now, `GET /guest/locations/:locationId/menu?lang=` is public
(rate-limited, 30 s cache). It only exposes what guests may see. Phase 5 adds the table-token routes
on the same builder; the location route can also serve a public "view the menu" link.

## D-030 — Combos deferred to Phase 4 (Phase 2)

Combos/menus ("Menu dreke") are in plan §5.3 but not in the Phase 2 list, and they only matter when
ordering. They will be built with the order screen in Phase 4.

## D-031 — Boot does not log out when the server is unreachable (Phase 2)

Found while testing: a page reload during an API restart got a 502 from `/auth/refresh` and the app
treated it as a sign-out. The client now distinguishes "session ended" (401) from "server
unreachable" (network error or 5xx): it keeps the session, shows "Can't reach the server… trying
again" and retries every 3 seconds. Plan §1 quality 2 (reliability through short Wi-Fi drops).

## D-032 — Floor grid and table geometry (Phase 3)

Each area is a 48 × 32 grid; tables store `x, y, w, h` in whole cells plus a rotation in degrees.
Tables may not overlap within an area (checked on the server, also for whole-layout saves).
Rotation is visual only, so overlap is checked on the unrotated rectangle. The editor moves tables
by dragging (pointer events, snapped to cells) or with the keyboard (arrows move, Shift+arrows resize,
R rotates 45°), which is the accessible alternative to drag and drop. Geometry changes are saved
together with "Save floor plan"; name/seats/shape are saved per table.

## D-033 — Table sessions, merge and split (Phase 3)

A table session has a main table (`table_sessions.table_id`) and its current tables in
`table_session_tables`, whose unique key on `table_id` guarantees a table is in at most one active
session. **Merge** adds a free table to a session, or, if the table has its own session, moves that
session's tables and guest count over and closes it as merged (`merged_into_id`); its orders will
move too once orders exist (Phase 4). **Split** takes a table back out of a merged group; it becomes
free. **Transfer** moves the main table to a free table (the old one is marked for cleaning) or
hands the session to another person who can open tables. Closing marks every table "needs cleaning";
a "Cleaned" action makes it free again.

## D-034 — Closing tables before bills exist (Phase 3)

Business rule 4 (close only with a zero balance) is implemented as `canCloseSession(status,
balance)`. Until bills arrive in Phase 6 the balance is always 0, so an open table can be closed
directly; Phase 6 passes the real balance. A `table.close` permission was added so cashiers can
close tables without being able to open them (plan §4).

## D-035 — "Own tables only" for waiters (Phase 3)

A waiter sees every table on the floor but can act only on sessions they own, unless their role has
`table.view_all` (cashier, manager, owner) or the location setting "waiters see all tables" is on.
Other waiters' tables show as occupied with the waiter's name, dimmed, and the API answers
`403 NOT_YOUR_TABLE`.

## D-036 — Real-time transport (Phase 3)

Socket.IO on the API server, same origin (Vite proxies `/socket.io`). Clients authenticate in the
handshake with their access token and location (same checks as REST), and join `location:<id>` and
`user:<id>`. Events carry `{ type, locationId, at, data }` and are hints: the client refetches the
affected TanStack Query keys (`table.updated` → floor, `menu.item_availability` → menu) and
refetches everything after a reconnect. Connection state recovery covers 60-second drops; an expired
token triggers a refresh and reconnect. The floor also polls every 60 s as a safety net.

## D-037 — Deadlock retry for table locking (Phase 3)

Found by the concurrency test: two waiters opening the same table at the same instant made MySQL
abort one transaction with `ER_LOCK_DEADLOCK` (500). Transactions that lock table links now go
through `transactionWithRetry`, which retries deadlocks/lock timeouts; the loser then sees the table
taken and gets `409 TABLE_OCCUPIED`.

## D-038 — QR codes (Phase 3)

Each table has a random 22-character token; its QR code points to `<GUEST_APP_URL>/t/<token>`
(`GUEST_APP_URL` in `.env`, default `http://localhost:5181`). Codes are generated on the server as
SVG (error correction M). The printable sheet shows one card per active table of an area, with the
location name and Albanian/English/Italian "scan for the menu" text; the app chrome is hidden when
printing. Rotating a token invalidates the printed code and is audited. The guest page at `/t/:token`
arrives in Phase 5.

## D-039 — Business day and daily numbers (Phase 4)

Order and kitchen ticket numbers restart every business day per location (business rule 10). A
business day starts at 04:00 local time (`BUSINESS_DAY_START_HOUR`), so a bar open past midnight
keeps one day's numbering until closing. Counters live in `daily_counters` and are incremented with
an upsert inside the order transaction, so concurrent orders never share a number.

## D-040 — Order item state machine (Phase 4)

`draft → sent → preparing → ready → served`, plus `pending_confirmation → sent` (guest orders,
Phase 5) and `voided` from `sent`, `preparing` or `ready`. `ready → preparing` is allowed so the
kitchen can recall a dish. Unsent lines are removed, not voided; sent lines can only be voided
(`409 ORDER_ITEM_ALREADY_SENT` on edit/delete). The full matrix is unit-tested in
`packages/shared/src/orders.test.ts`. Kitchen tickets follow their dishes: `new → in_progress →
ready → done` (done once everything is served or voided).

## D-041 — The waiter's cart lives on the device (Phase 4)

The order screen collects new lines in a cart stored in the browser (survives reloads and Wi-Fi
drops) and sends them in one request with `send: true`. The API also supports server-side drafts
(`send: false`, then `POST /orders/:ref/send`), used by tests and later by guest ordering. Every line
has a client-generated `uuid`; adding a line whose uuid already exists is ignored, which makes
replays safe.

## D-042 — Courses (Phase 4)

A line may have course 1, 2 or 3. When a batch is sent, lines with a later course than the lowest
course in the batch are **held**: the kitchen sees them greyed out ("Prit") and cannot start them
until the waiter fires the course (`POST /orders/:ref/fire`). Lines without a course are never held.

## D-043 — Items without a station (Phase 4)

Dishes with no station (e.g. bottled drinks the waiter takes from the fridge) skip the kitchen: they
become `ready` as soon as they are sent and create no ticket. Staff may order items outside their
category's schedule (e.g. breakfast after 11:30); schedules apply to the guest menu only. Sold-out
("86") and inactive items are refused with `409 ITEM_UNAVAILABLE`.

## D-044 — Set menus / combos (Phase 4)

A combo (e.g. "Menu dreke", 900 L) has a fixed price and slots; the guest picks one dish per slot,
optionally with a surcharge. On an order the combo is one priced parent line with no station; each
chosen dish is a child line with unit price 0 (plus any paid modifiers) routed to its own station.
The parent's status follows its dishes; voiding the parent voids the dishes. "Same again" maps
dishes back to slots by position (dishes are stored in slot order).

## D-045 — Voids and approvals (Phase 4)

Voids need a reason (business rule 3). When the location setting `voidRequiresApproval` is on (the
default), a manager approves with their PIN on the waiter's device: `POST /approvals` returns a
single-use 60-second token bound to `order_item.void` and that item. People who hold
`approval.grant` approve their own voids. The audit log records who voided and who approved. Waste
for prepared dishes is recorded once inventory exists (Phase 7).

## D-046 — Closing a table closes its order (interim, Phase 4; payment rule replaced by D-063)

Until bills and payments exist (Phase 6), closing a table closes its open order. Merging tables
moves the other table's lines and tickets into this table's order and marks the empty order
`cancelled`. Splitting a merged table leaves the order with the main table (bill splitting is Phase
6).

## D-047 — Offline outbox (Phase 4)

When adding items fails because the network is down, the request is stored in IndexedDB with its
Idempotency-Key and replayed in order every 5 s and on the browser's `online` event; the screen
shows "offline – N actions waiting" and the queued lines. A refused replay (e.g. the dish ran out) is
dropped with an explanatory toast. Each queued action belongs to the user who made it: on a shared
device it waits while someone else is signed in and is sent when that person switches back (found
during testing, where a replay under another user was refused and lost).

## D-048 — Kitchen screen (Phase 4)

`/kds` is outside the normal layout, always dark, with item names at 22 px. The device remembers its
station in `localStorage`; the socket joins `station:<id>` (validated against the location). Ticket
headers are coloured by age (green < 10 min, amber < 20, red after). Tapping a dish advances it,
tapping the header bumps the ticket, ready tickets can be recalled. Sound plays only after a tap
(browser autoplay rules). Kitchen roles have no `menu.view`, so stations come from
`GET /kds/stations`.

## D-049 — End-to-end tests (Phase 4)

Playwright runs against its own database `tavolina_e2e` (created with the MySQL root password from
`.env`, then migrated and seeded with the demo data on every run), the API on port 4110 and the staff
app on 5190, so it never touches the dev database or a running `npm run dev`. The database is
prepared inside the API web-server command because Playwright starts web servers before its
`globalSetup`.

## D-050 — Guest sessions (Phase 5)

A guest is identified by the table's QR token plus a random token in an httpOnly cookie (`tav_gs`,
path `/api/v1/guest`, 12 h); only its SHA-256 hash is stored in `guest_sessions`. One guest session
per phone per table visit. A cookie from another table, or from the previous party at this table
(bound to a session that has since closed), is ignored and the phone starts a new visit, so the last
party's phone can never order onto the next party's bill. The session starts when the phone first
loads the table's state, not only on the first order: found while testing, a live update made the
phone refetch before its first order's response (and cookie) had arrived, so it showed its own
lines as "from another phone".

## D-051 — Guests may open a free table; the first waiter to confirm takes it (Phase 5)

Plan §5.5 allows ordering at an "open or openable" table. A guest order on a free table opens a
table session with **no waiter** (`table_sessions.waiter_id` and `orders.opened_by` became
nullable). While nobody has taken it, every waiter may act on the table and all of them are alerted;
the waiter who confirms the first guest order becomes the table's waiter. Phones join the party's
session; when tables are merged the phones and their requests follow.

## D-052 — Waiter confirmation (Phase 5)

With `guestOrdersRequireConfirmation` on (the default), guest lines are created as
`pending_confirmation`: they show on the floor (badge), in the order screen and to the guest, but
not in the kitchen and not in the total. The waiter confirms (lines go to the stations like any
sent line) or rejects them. A rejection is `pending_confirmation → voided` (transition added to the
state machine) so the guest sees "cancelled" rather than lines silently disappearing. With the
setting off, guest lines are sent straight away. `guestOrderingEnabled` off leaves the QR menu
browse-only.

## D-053 — What guests may order (Phase 5)

Only what the guest menu shows: items and set menus marked visible to guests, in stock, and in
their category's serving hours (`409 ITEM_NOT_AVAILABLE_NOW`; staff may still order outside hours,
D-043). Seats and courses sent by a phone are ignored; they are the waiter's business. Prices are
taken on the server at the moment of ordering, like staff orders.

## D-054 — Anti-abuse (Phase 5)

- Business rule 8: at most 5 orders per minute per guest session (`429 TOO_MANY_ORDERS`), counted
  in `guest_order_submissions`; other phones at the table are unaffected.
- Staff can block one phone (`POST /guest-sessions/:id/block`, audited); blocked phones can still
  read the menu but cannot order or send requests (`403 GUEST_BLOCKED`).
- All guest endpoints share the per-IP guest rate limit (120/min) and the global API limit.
- Repeated "call waiter" / "bill" taps reuse the open request instead of creating new ones.

## D-055 — Call waiter and bill requests (Phase 5)

Requests are stored in `service_requests` (`call_waiter`, `bill_cash`, `bill_card`). Calling a
waiter works even at a free table; asking for the bill needs a table session and also moves an open
session to `bill_requested`. Requests show as a pulsing badge on the floor and in the table sheet
with a "Done" button; they are settled automatically when the table closes. The table's waiter gets
a toast and vibration; a table with no waiter alerts everyone who can take tables.

## D-056 — Live updates for phones (Phase 5)

Phones connect to the Socket.IO namespace `/guest` with their QR token and join `table:<id>`. They
only ever receive `guest.updated` ("something changed at your table", sent whenever the table's
floor state changes) and refetch their state over REST, so no staff data reaches a guest socket.
Phones also poll every 20 s. Staff events gained `service_request.created` and
`guest_order.pending`.

## D-057 — Guest bundle size (Phase 5)

The guest app imports runtime helpers from `@tavolina/shared/client`, a zod-free entry (money,
order maths, allergens, constants, languages), and only types from the main entry. Zod had crept in
through the shared barrel (160 KB → 133 KB gzipped JS after the split, about 0.2 s on 4G). Guest
order lines carry the dish, size and option ids so the phone shows names in its own language from
the translated menu (lines store the main-language name, business rule 1).

## D-058 — Deferred from §5.5 (Phase 5)

"Leave a review after payment" needs payments and arrives with Phase 6. When a table session is
moved to another table, phones keep pointing at the old table's QR code and see the table as free
until they scan the new one; acceptable for now.

## D-059 — Bill arithmetic (Phase 6)

Business rule 2 lives in `packages/shared/src/billing-math.ts` and is checked against hand-calculated
fixtures (`billing-math.test.ts`, repeated end to end in `billing.test.ts`): line = (unit + modifier
deltas) × qty rounded to lek → item discounts → bill discount → service charge → VAT extracted per
rate. Every amount a guest sees or pays is a whole lek; behind the scenes a bill discount and the
service charge are spread over the lines to the qindarka (largest remainder) so the VAT breakdown
per rate adds up exactly. VAT is rounded to the qindarka. Each line keeps a copy of its VAT rate
(`order_items.tax_rate_bp`, business rule 1); lines from before Phase 6 use the location's default
rate. A set menu line is taxed at the default rate.

## D-060 — Discounts (Phase 6)

One discount per line and one on the whole bill; a new one replaces the old. Percent (basis points)
or a fixed whole-lek amount, never more than the base, always with a reason. A discount above the
location's `discountApprovalThresholdBp` (as a percentage of its base) needs a manager's PIN;
people with `approval.grant` approve their own. Every discount is audited with who approved it.
Discounts and splits are locked once a payment is taken (`409 ORDER_HAS_PAYMENTS`); refund first.

## D-061 — Service charge (Phase 6)

`serviceChargeBp` applies to dine-in orders only (not takeaway or delivery), on the amount after
discounts, rounded to lek. It is taxed at the rates of the dishes it is charged on.

## D-062 — Splits and bills (Phase 6)

A split creates bills: whole, equal parts (whole-lek parts, the first ones take the leftover lek),
by seat (dishes without a seat go on a shared bill), by dishes (every dish on exactly one bill;
combo dishes follow their set menu) or custom whole-lek amounts that must add up to the total.
Each bill has its own VAT breakdown: from its own dishes, or the order's mix for equal and custom
parts. A bill can be paid in several payments (mixed). Paying without a split creates one whole
bill. If the order changes, unpaid bills without payments are dropped and the cashier splits
again; paid bills stay. A dish on a paid bill cannot be voided (`409 ITEM_PAID`), and a void may
not take the total below what was paid.

## D-063 — Payments, tips and the table lifecycle (Phase 6)

Methods: cash (needs an open cash drawer; tendered amount and change are recorded), card (terminal
reference optional; no card terminal integration), voucher and house account (reference required).
Tips are recorded per payment and credited to the table's waiter (or whoever opened the order).
When the order is fully paid the table goes `→ paid` (`open → bill_requested → paid`, plan §6) and
its bill requests are settled; takeaway and delivery orders close. Business rule 4 is now enforced:
a table closes only when nothing is owed (`409 BALANCE_DUE`). This replaces the interim D-046.

## D-064 — Refunds (Phase 6)

Refunds are against one payment, full or partial, never more than was paid, always with a manager's
PIN (managers approve their own) and audited. Cash refunds need the drawer open and are recorded as
a drawer movement. Each refund sends a corrective (negative) invoice to the fiscal service.

## D-065 — Cash drawer (Phase 6)

One open drawer per location (device management arrives in Phase 10). Opening registers the float
with DPT as a cash deposit; pay-outs register a withdrawal. Expected cash = float + cash sales (with
cash tips) + pay-ins − pay-outs − refunds − tips paid out. Closing needs a count by denomination
(ALL notes and coins 5 000 … 1 lek) and a manager's approval (people with `cash.approve` approve
their own). "Open without a sale" needs a manager's PIN, is audited and kicks the drawer through
the receipt printer.

## D-066 — Z report and closing the day (Phase 6)

The X report is the same as the Z report while the day is open. Closing (`cash.approve`) requires no
open table, no open takeaway order and no open drawer (business rule 5). The Z report is stored on
`business_days`, printed on the report printer and locks the business day: new orders, payments,
refunds and drawers on that day are refused (`409 BUSINESS_DAY_CLOSED`) until the next business day
starts (04:00, D-039). Voids in the report are dishes that reached the kitchen and were cancelled.

## D-067 — Fiscalization is mocked (Phase 6)

Per plan §5.11 the real DPT connection is **not** implemented. `FiscalProvider` has
`registerInvoice`, `registerCashDeposit` and `registerWithdrawal`; `MockFiscalProvider` returns a
realistic NSLF (32 hex), NIVF (UUID) and a verification URL on the DPT test site. Every record
keeps what the real integration needs: business unit, TCR, software, maintainer and operator codes,
invoice number per TCR per year, issue time, total, VAT per rate and payment methods. Records are
created as `pending` in the sale's transaction, sent right after commit, and retried by a job every
30 s with back-off (30 s doubling to 1 h; after 12 attempts `failed`, still visible). A sale is
never blocked by the tax service; receipts say "pending" until confirmed. **Before go-live the real
provider must be implemented and certified against the current DPT specification**, with the
business's certificate and real codes (Settings → Printers and fiscal). Operator codes are derived
from the user id until DPT-issued codes are stored per person.

## D-068 — Printing and the print bridge (Phase 6)

The API builds receipts, station tickets and Z reports as plain lines (`PrintDocument`) in the
location's main language; the print bridge (`apps/print-bridge`, a Node app on a PC in the
restaurant) turns them into ESC/POS (code page 858 for ë, ç and Italian accents; QR codes; cut;
drawer kick) and sends them to network printers (port 9100) or USB device files, or shows them in
its window ("console" printers, for trying it out). The bridge signs in on the Socket.IO namespace
`/print-bridge` with a key created under Settings → Printers (shown once, stored as a hash), gets
queued jobs on connect and confirms each print. Routing: one printer for receipts, one for Z
reports, one per station. Without a printer nothing is queued and screens remain the output.
Found while testing: a fast bridge could confirm a job before the API marked it "sent", so the API
now marks it first; and two knex updates were never awaited (knex queries only run when awaited).

## D-069 — Digital receipt and reviews (Phase 6)

Every bill has a random receipt token; the guest app shows the same receipt at `/r/<token>` with the
fiscal QR code (the staff screen links to it). Phones at a table that has paid see their receipts
and can leave one review (1–5 stars, optional comment) per visit, also for a few hours after the
table closed: a phone's new visit remembers its previous one (`guest_sessions.previous_id`). Staff
read reviews at `GET /reviews`; the dashboard shows them in Phase 9.

## D-070 — Stock quantities and the ledger (Phase 7)

Quantities are DECIMAL(14,3) in the ingredient's own unit and are handled in code as exact integer
thousandths (`toMilli`/`fromMilli` in `inventory-math.ts`), so thousands of 9 g espresso doses never
drift. Units are a fixed list (kg, g, l, ml, piece) in code instead of the plan's `units` table:
nothing about a unit is configurable, and a recipe line is always in its ingredient's unit (a
coffee recipe says 0.009 kg). The plan's `recipes` table is `recipe_lines`. Every change of
`ingredients.stock_qty` writes a `stock_movements` row in the same transaction (`moveStock`),
including opening stock; system movements carry a reference (`ref_type`: order_item, purchase_order,
stock_count, opening) instead of English text so the screen can show them in its language. Stock is
allowed to go negative (sold before the delivery was booked in) and shows in red. `transfer` exists
in the movement types for the multi-location phase but nothing creates it yet.

## D-071 — When stock is deducted, voids and waste (Phase 7)

Business rule 7: location setting `stockDeductOn` = `send` (default) books the recipe out in the
same transaction that sends the item; `payment` books out every sent item of the order when the
order becomes fully paid. `order_items.stock_deducted` makes sure a dish is booked once whichever
way. A size line in a recipe replaces the general line for the same ingredient (a large latte has
its own milk); option recipes (e.g. "extra shot") are added. Set menus are booked through their
dishes. A void gives the stock back (`sale_reversal`); if the kitchen had started the dish and
`voidedPreparedIsWaste` is on (default), the stock is booked again as `waste` with the void reason
(business rule 3). Waste and staff meals can be entered per ingredient or as whole dishes, which
books out their recipe.

## D-072 — Purchase orders and cost (Phase 7)

Draft → sent → partially received / received; draft or sent orders can be cancelled; only drafts
can be edited. Receiving can be partial, never more than is still open (`RECEIVE_TOO_MUCH`), and
can record the price actually paid. The ingredient's cost becomes the weighted average of the stock
on hand and what arrived (negative stock counts as zero); the menu items using it get their food
cost refreshed. Ordering from a supplier pre-fills that supplier's ingredients that are below their
minimum (twice the minimum minus stock, at least 1 unit); it is only a suggestion in the form.
Sending an order does not email the supplier (no mail service yet, see D-075); "sent" records that
it was ordered.

## D-073 — Stock counts (Phase 7)

A count covers every active ingredient or one category, and freezes each ingredient's expected
quantity and cost when it starts. Counted quantities can be saved while counting; applying corrects
each counted ingredient by counted − expected (a `count_adjust` movement), so sales made while the
count was open are kept. Uncounted lines change nothing. The variance is shown in quantity and in
lek at the frozen cost, per line and in total. One count can be open per location.

## D-074 — Food cost and margins (Phase 7)

Food cost = recipe × current ingredient cost; margin is on the price without VAT (prices include
VAT), shown per item, per size and per option. `menu_items.cost_minor` keeps the general recipe's
cost for the menu editor. Colours on the margin are only a visual hint (under 30% red, under 60%
amber); the plan sets no target.

## D-075 — Low-stock alerts (Phase 7)

When a movement takes an ingredient below its minimum (only the movement that crosses it), the API
sends `stock.low` after commit; staff with `inventory.view` see a toast and the Stock tab counts
items below minimum (`GET /ingredients/low`). The dashboard card comes with the dashboard in
Phase 9. Email alerts ("optionally by email" in the plan) are deferred: there is no mail service
configured yet.

## D-076 — Inventory permissions and demo stock (Phase 7)

Inventory follows the existing permission matrix: owners and managers have `inventory.view` and
`inventory.manage`; waiters, cashiers and kitchen screens have neither (nothing in the plan gives
them stock access). The demo has 32 ingredients from five suppliers at Tirana wholesale prices,
recipes for the coffees, bottled drinks, fresh orange juice (per glass size), the "extra shot" and
"whipped cream" options and 13 dishes, and a sent purchase order for sea bass, which is below its
minimum. Milk alternatives (oat, almond) have no recipe in the demo: as options they would add milk
on top of the whole milk in the drink's recipe.
