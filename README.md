# Tavolina

Restaurant & café management system for Albania: QR ordering, waiter POS, kitchen display, bills,
inventory and reports. See [`TAVOLINA_PLAN.md`](TAVOLINA_PLAN.md) for the full product plan.

- Setup: [`docs/SETUP.md`](docs/SETUP.md)
- API: [`docs/API.md`](docs/API.md)
- Decisions: [`docs/DECISIONS.md`](docs/DECISIONS.md)

```
apps/api       Express + Knex + MySQL API
apps/staff     React app for staff (POS, KDS, manager, owner)
apps/guest     React app for guests (QR menu)
packages/shared  Zod schemas, types, money utils
packages/ui      Design system: Tailwind preset + base components
```
