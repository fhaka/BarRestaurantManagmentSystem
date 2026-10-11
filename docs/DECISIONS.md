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
