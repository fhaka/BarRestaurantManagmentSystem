# Tavolina API

Base path: `/api/v1`. JSON everywhere. Every response carries an `X-Request-Id` header (an incoming
valid `X-Request-Id` is echoed back).

## Conventions

- **Auth:** `Authorization: Bearer <accessToken>` (JWT, 15 minutes). The refresh token is an
  httpOnly cookie `tav_rt` (14 days, `SameSite=Strict`, path `/api/v1/auth`), rotated on every use.
- **Location scope:** `X-Location-Id` header on location-scoped routes. Missing → `400
LOCATION_REQUIRED`; no access → `403 LOCATION_FORBIDDEN`.
- **Permissions:** each route lists the permission it needs. Missing → `403 FORBIDDEN` with
  `details.missing`.
- **Idempotency:** mutating endpoints accept `Idempotency-Key` (8–100 chars `[A-Za-z0-9_-]`). A repeat
  with the same body replays the first response (`Idempotent-Replayed: true`); a different body is
  `422 IDEMPOTENCY_KEY_REUSED`.
- **Rate limits:** auth/PIN/approval endpoints 20/min per IP, everything else 600/min per IP.
- **Pagination:** `?cursor=&limit=` (limit 1–200, default 50).
- **Money:** integers in minor units (`*_minor`, 1 lek = 100).

### Error format

Every error uses the same envelope:

```json
{ "error": { "code": "NOT_FOUND", "message": "Route GET /api/v1/x does not exist", "details": {} } }
```

| HTTP | `code`                   | When                                        |
| ---- | ------------------------ | ------------------------------------------- |
| 400  | `BAD_REQUEST`            | Malformed JSON or bad input                 |
| 400  | `VALIDATION_ERROR`       | Zod validation failed; `details.issues[]`   |
| 401  | `UNAUTHENTICATED`        | Missing/invalid token                       |
| 403  | `FORBIDDEN`              | Missing permission                          |
| 404  | `NOT_FOUND`              | Unknown route or entity                     |
| 409  | domain-specific          | Invalid state transition etc.               |
| 422  | `IDEMPOTENCY_KEY_REUSED` | Same key, different request                 |
| 423  | `PIN_LOCKED`             | 5 wrong PINs; `details.lockedUntil`         |
| 413  | `PAYLOAD_TOO_LARGE`      | Body over 1 MB                              |
| 429  | `RATE_LIMITED`           | Too many requests                           |
| 500  | `INTERNAL_ERROR`         | Unexpected; `details.requestId` for support |

## Endpoints

### `GET /health`

Liveness and dependency check. No auth.

- `200` when all checks pass, `503` when degraded (same body shape).

```json
{
  "status": "ok",
  "version": "0.1.0",
  "time": "2026-10-10T11:11:24.000Z",
  "uptimeSeconds": 42,
  "checks": { "database": "up" }
}
```

Schema: `healthResponseSchema` in `packages/shared/src/health.ts`.

## Auth

### `POST /auth/login`

Public. Body: `{ email, password, device?: { uuid, name?, type? } }`. `device.uuid` is a client
generated UUID kept per browser; the device is registered or updated.

`200` → `AuthResponse` + sets the refresh cookie:

```json
{
  "accessToken": "eyJ…",
  "expiresAt": "2026-10-10T18:45:00.000Z",
  "user": {
    "id": 2,
    "name": "Elira Shehu",
    "email": "menaxher@lasvegas.test",
    "lang": "sq",
    "locations": [{ "id": 1, "name": "Bar Restaurant Las Vegas", "roleKey": "manager" }]
  }
}
```

Errors: `401 INVALID_CREDENTIALS` (same for unknown email, wrong password, inactive user),
`403 LOCATION_FORBIDDEN` (no locations), `400 VALIDATION_ERROR`.

### `POST /auth/refresh`

Public; uses the cookie. Rotates the refresh token and returns a new `AuthResponse`.
`401 SESSION_EXPIRED` when the cookie is missing, expired or revoked. If another tab rotated the same
token in the last 20 seconds the error has `details.retry = true`: retry once. Reusing an older
rotated token revokes the whole session family.

### `POST /auth/logout`

Public; uses the cookie. Revokes the device session. `204`.

### `GET /auth/pin-users?locationId=`

Uses the device session cookie (no access token, so it works on a locked screen). Lists active staff
with a PIN at the location, most senior first: `[{ id, name, roleKey, locked }]`.

### `POST /auth/pin`

Uses the device session cookie. Body: `{ userId, pin, locationId }`. Switches the device to that
person and returns an `AuthResponse` + new cookie (the old device token is revoked). Audited as
`auth.pin_switch`.

Errors: `401 INVALID_PIN` (`details.attemptsLeft`), `423 PIN_LOCKED` (`details.lockedUntil`),
`409 PIN_NOT_SET`, `403 LOCATION_FORBIDDEN`.

### `GET /me`

Access token. With `X-Location-Id`, also returns the role and permissions there:

```json
{
  "user": { "id": 3, "name": "Klajdi Dervishi", "email": "…", "lang": "sq", "locations": [] },
  "location": {
    "id": 1,
    "name": "Bar Restaurant Las Vegas",
    "roleKey": "waiter",
    "permissions": ["bill.split", "floor.view", "menu.view", "order.create", "…"]
  }
}
```

## Approvals

### `POST /approvals`

Location-scoped, any signed-in user. Body:
`{ approverId, pin, action, entityType, entityId }`, where `action` is one of `order_item.void`,
`order.discount`, `payment.refund`, `cash_drawer.open_no_sale`, `order.delete_paid`.

The approver needs `approval.grant` at this location and the right PIN (same lockout as PIN switch).
`201` → `{ approvalToken, expiresAt, approverId, action }`. The token is single-use, valid for 60
seconds, and only for that action on that entity; endpoints that need approval (from Phase 4) accept
it and record both users in the audit log. Errors: `403 FORBIDDEN`, `401 INVALID_PIN`,
`423 PIN_LOCKED`; using an expired/mismatched token gives `403 APPROVAL_INVALID`.

## Locations

| Method & path            | Permission        | Notes                                              |
| ------------------------ | ----------------- | -------------------------------------------------- |
| `GET /locations`         | signed in         | Your locations with your role at each              |
| `GET /locations/current` | any role there    | The `X-Location-Id` location, with `settings`      |
| `POST /locations`        | `location.manage` | `{ name, address?, nipt?, settings? }` → `201`     |
| `PATCH /locations/:id`   | `settings.edit`   | Must be the current location; `settings` is merged |

`Location`: `{ id, accountId, name, address, nipt, timezone, currency, settings }`. `settings`
(percentages in basis points, 1000 = 10%): `defaultLang`, `languages`, `currencyDisplay` (`L`/`ALL`),
`serviceChargeBp`, `tipOptionsBp`, `receiptHeader`, `receiptFooter`, `openingHours[]`,
`guestOrderingEnabled`, `guestOrdersRequireConfirmation` (default true), `waitersSeeAllTables`,
`voidRequiresApproval`, `discountApprovalThresholdBp`. NIPT format: `L12345678A`. Creating a location
gives every owner of the account access. Both writes are audited.

## Staff

| Method & path                 | Permission     | Body                                                        |
| ----------------------------- | -------------- | ----------------------------------------------------------- |
| `GET /staff`                  | `staff.view`   | —                                                           |
| `POST /staff`                 | `staff.manage` | `{ name, roleKey, email?, phone?, lang?, password?, pin? }` |
| `PATCH /staff/:id`            | `staff.manage` | `{ name?, email?, phone?, roleKey?, lang?, active? }`       |
| `POST /staff/:id/credentials` | `staff.manage` | `{ password?, pin? }` (at least one)                        |

`StaffMember`: `{ id, name, email, phone, roleKey, lang, active, hasPassword, hasPin, pinLocked,
lastLoginAt }` — never hashes.

Rules: you can only grant roles whose permissions you have yourself, and only edit people whose
role you could grant (`403 ROLE_NOT_GRANTABLE`); you cannot change your own role or deactivate
yourself (`409 CANNOT_CHANGE_SELF`); emails are unique (`409 EMAIL_TAKEN`, `details.field = "email"`).
Deactivating someone or resetting their password ends their sessions; a new PIN clears a PIN lock.
Audited: `staff.created`, `staff.updated`, `staff.role_changed`, `staff.credentials_changed`.

## Menu

Location-scoped. Money in minor units; prices include VAT. Text fields are in the location's main
language; other languages go in `translations: { en?: { name?, description? }, it?: {...} }`.

| Method & path                             | Permission          | Notes                                                                              |
| ----------------------------------------- | ------------------- | ---------------------------------------------------------------------------------- |
| `GET /menu`                               | `menu.view`         | `AdminMenu`; `costMinor` is null without `menu.edit`                               |
| `GET /menu/guest-preview?lang=`           | `menu.view`         | Same data as the public guest menu                                                 |
| `POST /menu/categories`                   | `menu.edit`         | `CategoryInput` (below)                                                            |
| `PATCH /menu/categories/:id`              | `menu.edit`         | Partial                                                                            |
| `DELETE /menu/categories/:id`             | `menu.edit`         | `409 CATEGORY_NOT_EMPTY` if it has items or subcategories                          |
| `POST /menu/categories/reorder`           | `menu.edit`         | `{ ids }` in the new order                                                         |
| `POST /menu/categories/:id/items/reorder` | `menu.edit`         | `{ ids }`, all from that category                                                  |
| `POST /menu/categories/:id/image`         | `menu.edit`         | multipart `image`                                                                  |
| `POST /menu/items`                        | `menu.edit`         | `ItemInput` (below)                                                                |
| `PATCH /menu/items/:id`                   | `menu.edit`         | Partial; lists replace the full list; price changes audited (`menu.price_changed`) |
| `DELETE /menu/items/:id`                  | `menu.edit`         | Soft delete                                                                        |
| `POST /menu/items/:id/image`              | `menu.edit`         | multipart `image`, JPEG/PNG/WebP ≤ 5 MB → item with `imageUrl`, `thumbUrl`         |
| `DELETE /menu/items/:id/image`            | `menu.edit`         |                                                                                    |
| `POST /menu/items/:id/out-of-stock`       | `menu.availability` | `{ mode: "today" or "indefinite" or "back" }`                                      |
| `POST /menu/modifier-groups`              | `menu.edit`         | `ModifierGroupInput` (below)                                                       |
| `PATCH /menu/modifier-groups/:id`         | `menu.edit`         | Full body; modifiers matched by `id`, missing ones removed                         |
| `DELETE /menu/modifier-groups/:id`        | `menu.edit`         | Also detaches it from items                                                        |
| `POST /menu/price-rules`                  | `menu.edit`         | `PriceRuleInput` (below)                                                           |
| `PATCH` / `DELETE /menu/price-rules/:id`  | `menu.edit`         |                                                                                    |
| `POST /stations`, `PATCH /stations/:id`   | `menu.edit`         | `{ name, type: kitchen/bar/other, active }`                                        |
| `POST /tax-rates`, `PATCH /tax-rates/:id` | `settings.edit`     | `{ name, rateBp, isDefault }` (2000 = 20%)                                         |
| `GET /menu/export`                        | `menu.edit`         | `text/csv`, UTF-8 with BOM                                                         |
| `POST /menu/import`                       | `menu.edit`         | `{ csv, dryRun = true }` → `MenuImportResult`; problems → `422 IMPORT_INVALID`     |

- **CategoryInput:** `{ name, description?, parentId?, icon?, availableFrom?, availableTo?,
weekdayMask?, active?, translations? }` (schedule: both times or neither).
- **ItemInput:** `{ categoryId, stationId, name, description?, priceMinor, costMinor?, taxRateId?
(default rate if omitted), prepMinutes?, isPopular?, isNew?, guestVisible?, active?, allergens? (the
14 EU keys), tags? (vegan, vegetarian, gluten_free, spicy), modifierGroupIds?, variants?: [{ id?, name,
priceMinor, translations? }], translations? }`. Ids from another location → `400 INVALID_REFERENCE`.
- **ModifierGroupInput:** `{ name, minSelect, maxSelect, required, translations?, modifiers: [{ id?,
name, priceDeltaMinor, active?, translations? }] }` with min ≤ max ≤ number of options, and
  required ⇒ min ≥ 1.
- **PriceRuleInput:** `{ name, scope: item/category, scopeId, type: percent/fixed, value, weekdayMask?,
timeFrom?, timeTo?, dateFrom?, dateTo?, active? }`. Percent `value` is basis points off (≤ 10000),
  fixed is minor units off.
- **Import errors:** `details.errors[{ row, column, code, value, message }]`, `code` one of `parse`,
  `missingColumn`, `required`, `unknownId`, `duplicate`, `invalidPrice`, `unknownStation`,
  `unknownTaxRate`, `invalidPrep`, `unknownValues`, `invalidBoolean`, `invalidRow`.

Weekday masks: bit 0 = Monday … bit 6 = Sunday (127 = every day). Times are `HH:MM` in Europe/Tirane;
a window may cross midnight.

## Guest (public)

### `GET /guest/locations/:locationId/menu?lang=`

No auth; rate-limited (120/min per IP); `Cache-Control: public, max-age=30`. Language: `lang` if the
location offers it, else `Accept-Language`, else the location default. Returns `GuestMenu`: only
active, guest-visible, in-stock items in active categories (empty categories left out), each field
translated with fallback to the main language, prices including any price rule active now
(`regularPriceMinor` set when discounted), and `availableNow` per category from its schedule.
