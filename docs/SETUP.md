# Developer setup

Goal: from a fresh clone to a running system in about 15 minutes.

## Prerequisites

- **Node.js 20+** (developed on 24) and npm 10+
- **Docker Desktop** (for MySQL)
- **Git** — on Windows, Git for Windows at the default path (see `docs/DECISIONS.md` D-003)

## 1. Install

```bash
npm install
```

This also installs the Husky pre-commit hook (runs ESLint + Prettier on staged files).

## 2. Configure

```bash
cp .env.example .env
```

The defaults work out of the box. Ports: MySQL `3310`, API `4100`, staff app `5180`, guest app `5181`.

## 3. Start MySQL

```bash
docker compose up -d
```

The first start creates two databases: `tavolina` (development) and `tavolina_test` (used by API tests).
Wait until `docker compose ps` shows the container as `healthy` (about 20 seconds on first run).

## 4. Migrate and seed

```bash
npm run db:migrate
```

```bash
npm run db:seed
```

`db:migrate` also syncs roles and permissions from code. `db:seed` **wipes all data** and loads the
demo business "Bar Restaurant Las Vegas" (see below); never run it against real data.

`.env` needs a `JWT_ACCESS_SECRET` of at least 32 characters (`.env.example` has a dev value).

## 5. Run everything

```bash
npm run dev
```

| App        | URL                                 |
| ---------- | ----------------------------------- |
| Staff app  | http://localhost:5180 (sign in)     |
| Showcase   | http://localhost:5180/dev/showcase  |
| Guest app  | http://localhost:5181               |
| API health | http://localhost:4100/api/v1/health |

## Useful scripts

| Script                | What it does                                                               |
| --------------------- | -------------------------------------------------------------------------- |
| `npm run dev`         | API (tsx watch) + staff + guest (Vite) together                            |
| `npm run test`        | Vitest: unit tests and API tests (needs MySQL running)                     |
| `npm run test:e2e`    | Playwright end-to-end tests (own database `tavolina_e2e`, ports 4110/5190) |
| `npm run test:all`    | Lint + format check + typecheck + tests + e2e. Must pass to end a phase    |
| `npm run lint`        | ESLint across the monorepo                                                 |
| `npm run format`      | Prettier write                                                             |
| `npm run typecheck`   | `tsc --noEmit` in every workspace                                          |
| `npm run build`       | Production builds (API via tsup, apps via Vite)                            |
| `npm run db:migrate`  | Run Knex migrations                                                        |
| `npm run db:rollback` | Roll back the last migration batch                                         |
| `npm run db:seed`     | Run seeds                                                                  |

## Demo credentials

Demo business: **Bar Restaurant Las Vegas**, Tirana. Everyone with an email signs in with the
password **`Tavolina2026!`**. Everyone can switch in on a signed-in device with their PIN
(user menu → _Switch user_).

| Person          | Role          | Email                    | PIN  |
| --------------- | ------------- | ------------------------ | ---- |
| Arben Hoxha     | Owner         | `pronar@lasvegas.test`   | 1111 |
| Elira Shehu     | Manager       | `menaxher@lasvegas.test` | 2222 |
| Klajdi Dervishi | Waiter        | `kamarier@lasvegas.test` | 3001 |
| Sara Leka       | Waiter        | — (PIN only)             | 3002 |
| Dritan Muça     | Waiter        | — (PIN only)             | 3003 |
| Anisa Gjoni     | Cashier       | `arka@lasvegas.test`     | 4001 |
| Ekrani Kuzhina  | Kitchen / Bar | `kuzhina@lasvegas.test`  | 5001 |
| Ekrani Bar      | Kitchen / Bar | `bar@lasvegas.test`      | 5002 |

The demo menu has 11 categories and 61 items in Albanian with English and Italian translations,
allergens, variants (e.g. wine by the glass or bottle), five modifier groups (milk, sugar, ice,
steak doneness, coffee extras) and a weekday beer happy hour (17:00–19:00, −20%). Breakfast is only
available 07:00–11:30. The public guest menu is at
`http://localhost:5181/api/v1/guest/locations/1/menu?lang=en`. The demo floor has two areas — Salla (12 tables) and Tarraca (8) — with a few live tables
(seated guests, a bill requested, two merged terrace tables, one table waiting for cleaning). Open
the floor in two browser windows to see changes appear live. Uploaded photos are stored in
`apps/api/uploads` (git-ignored).

Phase 4 adds a service in progress: the live tables have orders in every state (sent, cooking,
ready, served, a held second course on T3 + T4) and there is one takeaway order. The lunch set menu
**Menu dreke** (900 L: main + drink + coffee) is under _Pjata kryesore_. Try it with two windows:
sign in as `kamarier@lasvegas.test`, open a table and tap **Merr porosinë**; in the other window
sign in as `kuzhina@lasvegas.test` (or `bar@…`) to get the kitchen screen at `/kds`. Two users in
one browser share the sign-in cookie, so use a private window or another browser for the second
person. `npm run db:seed` resets everything to this state.

Phase 5 adds the guest QR app. Each table's QR code (Floor → print QR sheet) points to
`http://localhost:5181/t/<token>`; open one on a phone or in a narrow browser window. The demo has a
phone at Salla 2 with two lemonades waiting for the waiter's confirmation, and terrace table T6
calling a waiter. Guest orders wait for a waiter by default (location setting). Orders from a free
table open it without a waiter; the first waiter to confirm takes it.

The first `npm run test:e2e` needs Chromium for Playwright: `npx playwright install chromium`.

`.test` addresses can never receive email. Five wrong PINs lock that person for 5 minutes; a manager
can clear it by setting a new PIN under **Staff**.

## Troubleshooting

- **`'Cafe' is not recognized as an internal or external command`** — npm is using `cmd.exe` in a
  folder whose path contains `&`. Make sure `.npmrc` exists, or rename the folder (D-003).
- **Port already in use** — change the port in `.env` and restart `npm run dev`.
- **Health shows database `down`** — check `docker compose ps`; the container must be `healthy`.
