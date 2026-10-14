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

| Method & path                                 | Permission          | Notes                                                                                                                                                                     |
| --------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /menu`                                   | `menu.view`         | `AdminMenu`; `costMinor` is null without `menu.edit`                                                                                                                      |
| `GET /menu/guest-preview?lang=`               | `menu.view`         | Same data as the public guest menu                                                                                                                                        |
| `POST /menu/categories`                       | `menu.edit`         | `CategoryInput` (below)                                                                                                                                                   |
| `PATCH /menu/categories/:id`                  | `menu.edit`         | Partial                                                                                                                                                                   |
| `DELETE /menu/categories/:id`                 | `menu.edit`         | `409 CATEGORY_NOT_EMPTY` if it has items or subcategories                                                                                                                 |
| `POST /menu/categories/reorder`               | `menu.edit`         | `{ ids }` in the new order                                                                                                                                                |
| `POST /menu/categories/:id/items/reorder`     | `menu.edit`         | `{ ids }`, all from that category                                                                                                                                         |
| `POST /menu/categories/:id/image`             | `menu.edit`         | multipart `image`                                                                                                                                                         |
| `POST /menu/items`                            | `menu.edit`         | `ItemInput` (below)                                                                                                                                                       |
| `PATCH /menu/items/:id`                       | `menu.edit`         | Partial; lists replace the full list; price changes audited (`menu.price_changed`)                                                                                        |
| `DELETE /menu/items/:id`                      | `menu.edit`         | Soft delete                                                                                                                                                               |
| `POST /menu/items/:id/image`                  | `menu.edit`         | multipart `image`, JPEG/PNG/WebP ≤ 5 MB → item with `imageUrl`, `thumbUrl`                                                                                                |
| `DELETE /menu/items/:id/image`                | `menu.edit`         |                                                                                                                                                                           |
| `POST /menu/items/:id/out-of-stock`           | `menu.availability` | `{ mode: "today" or "indefinite" or "back" }`                                                                                                                             |
| `POST /menu/modifier-groups`                  | `menu.edit`         | `ModifierGroupInput` (below)                                                                                                                                              |
| `PATCH /menu/modifier-groups/:id`             | `menu.edit`         | Full body; modifiers matched by `id`, missing ones removed                                                                                                                |
| `DELETE /menu/modifier-groups/:id`            | `menu.edit`         | Also detaches it from items                                                                                                                                               |
| `POST /menu/combos`, `PATCH /menu/combos/:id` | `menu.edit`         | `{ name, description?, priceMinor, categoryId, active?, guestVisible?, translations?, slots: [{ id?, name, translations?, items: [{ menuItemId, priceDeltaMinor? }] }] }` |
| `DELETE /menu/combos/:id`                     | `menu.edit`         | Soft delete; orders keep their copy                                                                                                                                       |
| `POST /menu/price-rules`                      | `menu.edit`         | `PriceRuleInput` (below)                                                                                                                                                  |
| `PATCH` / `DELETE /menu/price-rules/:id`      | `menu.edit`         |                                                                                                                                                                           |
| `POST /stations`, `PATCH /stations/:id`       | `menu.edit`         | `{ name, type: kitchen/bar/other, active }`                                                                                                                               |
| `POST /tax-rates`, `PATCH /tax-rates/:id`     | `settings.edit`     | `{ name, rateBp, isDefault }` (2000 = 20%)                                                                                                                                |
| `GET /menu/export`                            | `menu.edit`         | `text/csv`, UTF-8 with BOM                                                                                                                                                |
| `POST /menu/import`                           | `menu.edit`         | `{ csv, dryRun = true }` → `MenuImportResult`; problems → `422 IMPORT_INVALID`                                                                                            |

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

## Guest QR app (public)

No account. Rate-limited (120/min per IP). A phone is identified by the table's QR token and the
guest cookie `tav_gs` (D-050). Money in minor units.

| Method & path                         | Notes                                                                                                                                                |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /guest/t/:tableToken`            | `GuestTableInfo`: location, table, `orderingEnabled`, `requiresConfirmation`; 404 if invalid                                                         |
| `GET /guest/t/:tableToken/menu?lang=` | `GuestMenu` (same rules as the public menu below, plus set menus)                                                                                    |
| `GET /guest/t/:tableToken/state`      | `GuestTableState`: the table's order lines (`mine`, `byStaff`, status), totals, open requests, `blocked`. Starts the phone's visit (sets the cookie) |
| `POST /guest/t/:tableToken/orders`    | `{ items: NewOrderItem[] }` (1–30). Opens a free table. `201` with `GuestTableState`                                                                 |
| `POST /guest/t/:tableToken/requests`  | `{ type: 'call_waiter' \| 'bill_cash' \| 'bill_card' }`                                                                                              |

Errors: `404 NOT_FOUND` (bad token), `403 GUEST_ORDERING_DISABLED`, `403 GUEST_BLOCKED`,
`429 TOO_MANY_ORDERS` (business rule 8), `409 ITEM_UNAVAILABLE`, `409 ITEM_NOT_AVAILABLE_NOW`,
`400 MODIFIERS_INVALID`, `400 COMBO_INVALID`, `409 SESSION_STATE` (bill with nothing ordered, or the
table already paid).

Staff side:

| Method & path                           | Permission     | Notes                                                                                                |
| --------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------- |
| `POST /orders/:ref/guest-items/confirm` | `order.send`   | `{ itemRefs? }` — pending guest lines go to the kitchen; an unassigned table becomes the confirmer's |
| `POST /orders/:ref/guest-items/reject`  | `order.send`   | `{ itemRefs?, reason? }` — pending lines become `voided`                                             |
| `GET /service-requests`                 | `floor.view`   | Open requests, oldest first                                                                          |
| `POST /service-requests/:id/handle`     | `floor.view`   | Marks done                                                                                           |
| `GET /table-sessions/:ref/guests`       | `order.create` | Phones at the table (`GuestSessionSummary[]`)                                                        |
| `POST /guest-sessions/:id/block`        | `table.open`   | `{ blocked }`, audited                                                                               |

## Public menu

### `GET /guest/locations/:locationId/menu?lang=`

No auth; rate-limited (120/min per IP); `Cache-Control: public, max-age=30`. Language: `lang` if the
location offers it, else `Accept-Language`, else the location default. Returns `GuestMenu`: only
active, guest-visible, in-stock items in active categories (empty categories left out), each field
translated with fallback to the main language, prices including any price rule active now
(`regularPriceMinor` set when discounted), and `availableNow` per category from its schedule.

## Floor & tables

Location-scoped. Every endpoint that changes the floor returns the full `FloorState` (so the acting
device updates at once) and emits `table.updated` to the location.

| Method & path                           | Permission       | Notes                                                                |
| --------------------------------------- | ---------------- | -------------------------------------------------------------------- |
| `GET /floor`                            | `floor.view`     | `FloorState`: areas, tables with status and session, waiters         |
| `POST /areas`, `PATCH /areas/:id`       | `floor.edit`     | `{ name, active? }`                                                  |
| `DELETE /areas/:id`                     | `floor.edit`     | `409 AREA_NOT_EMPTY` if it has tables                                |
| `GET /areas/:id/qr-sheet`               | `floor.edit`     | `TableQr[]` for the area's active tables                             |
| `POST /tables`                          | `floor.edit`     | `{ areaId, name, seats?, shape?, x, y, w, h, rotation?, active? }`   |
| `PATCH /tables/:id`                     | `floor.edit`     | Partial                                                              |
| `DELETE /tables/:id`                    | `floor.edit`     | `409 TABLE_OCCUPIED` while it has guests                             |
| `POST /tables/layout`                   | `floor.edit`     | `{ areaId, tables: [{ id, x, y, w, h, rotation }] }`, all or nothing |
| `GET /tables/:id/qr`                    | `floor.edit`     | `TableQr` JSON, or the SVG with `Accept: image/svg+xml`              |
| `POST /tables/:id/qr/rotate`            | `floor.edit`     | New token; the old printed code stops working                        |
| `POST /tables/:id/clean`                | `table.open`     | Clears "needs cleaning"                                              |
| `POST /table-sessions`                  | `table.open`     | `{ uuid, tableId, guestCount }`; idempotent on `uuid`                |
| `PATCH /table-sessions/:id`             | `table.open`     | `{ guestCount }`                                                     |
| `POST /table-sessions/:id/transfer`     | `table.transfer` | `{ toTableId }` or `{ toWaiterId }` (exactly one)                    |
| `POST /table-sessions/:id/merge`        | `table.transfer` | `{ tableId }` — free table joins, or its session is merged in        |
| `POST /table-sessions/:id/split`        | `table.transfer` | `{ tableId }` — table leaves the merged group and becomes free       |
| `POST /table-sessions/:id/request-bill` | `table.open`     | `open → bill_requested`                                              |
| `POST /table-sessions/:id/reopen`       | `table.open`     | `bill_requested → open`                                              |
| `POST /table-sessions/:id/close`        | `table.close`    | Closes; tables "need cleaning". `409 BALANCE_DUE` once bills exist   |

Shapes: `square`, `round`, `rectangle`, `bar_stool`. Grid: 48 × 32 cells; tables must fit and must
not overlap in an area (`400` with `outsideFloor`, `409 TABLE_OVERLAP`). Table statuses: `free`,
`occupied`, `ordered`, `food_ready`, `bill_requested`, `needs_cleaning`, `reserved` (the last three
fed by later phases where noted in DECISIONS). Errors: `409 TABLE_OCCUPIED`, `403 NOT_YOUR_TABLE`
(another waiter's table), `409 SESSION_STATE` (invalid transition), `400 INVALID_REFERENCE`.

## Orders

Location-scoped. Orders, table sessions and order items can be addressed by numeric id or by their
client-generated `uuid`. Mutations return the full `Order`. Waiters act only on their own tables
(`403 NOT_YOUR_TABLE`, D-035).

| Method & path                     | Permission     | Notes                                                                                                                                                        |
| --------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /orders`                     | `order.create` | Open orders: `OrderSummary[]`                                                                                                                                |
| `POST /orders`                    | `order.create` | `{ uuid, type, tableSessionRef?, customerName?, customerPhone?, deliveryAddress?, pickupAt? }`; idempotent on `uuid`; dine-in returns the table's open order |
| `GET /orders/:ref`                | `order.create` | `Order`                                                                                                                                                      |
| `POST /orders/:ref/items`         | `order.create` | `{ items: NewOrderItem[], send? }` (below)                                                                                                                   |
| `POST /orders/:ref/send`          | `order.send`   | `{ itemRefs? }` — sends drafts (all when omitted)                                                                                                            |
| `POST /orders/:ref/fire`          | `order.send`   | `{ course: 2 \| 3 }` — releases a held course                                                                                                                |
| `POST /orders/:ref/serve`         | `order.create` | `{ itemRefs? }` — marks ready items served (all when omitted)                                                                                                |
| `POST /orders/:ref/repeat`        | `order.send`   | `{ itemRefs, uuids, send? }` — "same again", re-priced now                                                                                                   |
| `GET /table-sessions/:ref/order`  | `order.create` | `{ order: Order \| null }`                                                                                                                                   |
| `POST /table-sessions/:ref/items` | `order.create` | Like `/orders/:ref/items`; creates the table's order on the first round                                                                                      |
| `PATCH /order-items/:ref`         | `order.create` | Drafts only: `{ qty?, seat?, course?, notes? }`                                                                                                              |
| `DELETE /order-items/:ref`        | `order.create` | Drafts only                                                                                                                                                  |
| `POST /order-items/:ref/void`     | `order.void`   | `{ reason, approvalToken? }` (D-045)                                                                                                                         |
| `POST /order-items/:ref/serve`    | `order.create` | One ready item                                                                                                                                               |
| `PATCH /order-items/:ref/status`  | `kds.bump`     | `{ status: 'preparing' \| 'ready' }`                                                                                                                         |
| `GET /approvers`                  | `order.create` | People who can approve with their PIN                                                                                                                        |

`NewOrderItem`: `{ uuid, menuItemId | comboId, variantId?, modifierIds?, comboSelections?: [{ slotId,
menuItemId, variantId?, modifierIds? }], qty?, seat?, course?: 1|2|3, notes? }`. Prices are taken at
the moment of adding (happy hours applied) and copied onto the line. Errors: `409 ITEM_UNAVAILABLE`,
`400 MODIFIERS_INVALID` (size or required options missing), `400 COMBO_INVALID`,
`409 ORDER_ITEM_ALREADY_SENT`, `409 ORDER_ITEM_STATE`, `409 ORDER_CLOSED`, `403 APPROVAL_INVALID`.

## Kitchen display (KDS)

| Method & path                  | Permission | Notes                                                    |
| ------------------------------ | ---------- | -------------------------------------------------------- |
| `GET /kds/stations`            | `kds.view` | Active stations                                          |
| `GET /kds/stations/:id/board`  | `kds.view` | `KdsBoard`: open tickets oldest first + last 10 finished |
| `POST /kds/tickets/:id/bump`   | `kds.bump` | Every fired dish on the ticket becomes ready             |
| `POST /kds/tickets/:id/recall` | `kds.bump` | Ready dishes go back to preparing                        |

## Bills and payments

Location-scoped; money in minor units. Endpoints return the full `BillView` (order, totals with VAT
per rate, discounts, bills with payments and fiscal status, balance).

| Method & path                       | Permission       | Notes                                                                                                                                           |
| ----------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /orders/:ref/bill`             | `payment.take`   | `BillView`                                                                                                                                      |
| `POST /orders/:ref/discounts`       | `order.discount` | `{ orderItemId?, type: 'percent' \| 'fixed', value, reason, approvalToken? }`                                                                   |
| `DELETE /discounts/:id`             | `order.discount` | Before any payment                                                                                                                              |
| `POST /orders/:ref/split`           | `bill.split`     | `{ type: 'full' }`, `{ type: 'equal', parts }`, `{ type: 'seat' }`, `{ type: 'items', groups: number[][] }`, `{ type: 'custom', amountsMinor }` |
| `POST /orders/:ref/payments`        | `payment.take`   | `{ billId?, uuid, method, amountMinor, tipMinor?, tenderedMinor?, reference? }`; idempotent on `uuid`                                           |
| `POST /bills/:id/print`             | `payment.take`   | Reprint the receipt → `{ jobId \| null }`                                                                                                       |
| `POST /payments/:id/refund`         | `payment.take`   | `{ amountMinor, reason, approvalToken? }` (always manager-approved)                                                                             |
| `GET /cash-drawers/current`         | `cash.drawer`    | `{ drawer: CashDrawer \| null }`                                                                                                                |
| `POST /cash-drawers`                | `cash.drawer`    | `{ floatMinor }`                                                                                                                                |
| `GET /cash-drawers/:id`             | `cash.drawer`    | `CashDrawer`                                                                                                                                    |
| `POST /cash-drawers/:id/movements`  | `cash.movement`  | `{ type: 'pay_in' \| 'pay_out' \| 'tip_out', amountMinor, reason }`                                                                             |
| `POST /cash-drawers/:id/no-sale`    | `cash.drawer`    | `{ reason, approvalToken? }`                                                                                                                    |
| `POST /cash-drawers/:id/close`      | `cash.drawer`    | `{ counts: { "1000": 3, … }, note?, approvalToken? }`                                                                                           |
| `GET /business-days/current/report` | `cash.drawer`    | X report (`ZReport`, `closed: false`)                                                                                                           |
| `GET /business-days/:date/report`   | `cash.drawer`    | Stored Z report, or the live numbers                                                                                                            |
| `POST /business-days/close`         | `cash.approve`   | Stores and prints the Z report, locks the day                                                                                                   |
| `POST /fiscal/retry`                | `settings.edit`  | Retry pending fiscal registrations now                                                                                                          |

Errors: `409 ORDER_HAS_PAYMENTS`, `409 BILL_PAID`, `409 ITEM_PAID`, `409 PAYMENT_TOO_HIGH`,
`409 REFUND_TOO_HIGH`, `409 SPLIT_INVALID`, `409 CASH_DRAWER_CLOSED`, `409 CASH_DRAWER_OPEN`,
`409 BUSINESS_DAY_CLOSED`, `409 DAY_HAS_OPEN_TABLES`, `409 BALANCE_DUE`, `403 APPROVAL_INVALID`.
Approval actions: `order.discount` (order), `payment.refund` (payment),
`cash_drawer.open_no_sale` and `cash_drawer.close` (cash drawer).

## Printers

`settings.edit`. Printers: `GET/POST /printers`, `PATCH/DELETE /printers/:id`
(`{ name, connection: 'network' | 'usb' | 'console', host?, port?, devicePath?, widthChars: 32 | 42 | 48, active }`).
Routing: `GET/PUT /print-routes` (`{ receiptPrinterId, reportPrinterId, stations: [{ stationId, printerId }] }`).
Print bridges: `GET/POST /print-bridges` (the key is returned once), `DELETE /print-bridges/:id`.
Jobs: `GET /print-jobs`, `POST /print-jobs/:id/retry`.

The print bridge connects to the Socket.IO namespace `/print-bridge` with `auth: { token: <key> }`,
receives `print.job` `{ jobId, printer, document }` and answers `print.ack` `{ jobId, ok, error? }`.

Guest side: `GET /guest/receipts/:token` (digital receipt: document, fiscal info, QR SVG) and
`POST /guest/t/:tableToken/review` (`{ rating: 1–5, comment? }`). Staff: `GET /reviews` (`report.view`).

## Inventory

Location-scoped. View: `inventory.view`; changes: `inventory.manage`. Quantities are sent as
decimal strings or numbers in the ingredient's unit (`"0.018"`, `"1,5"`, at most 3 decimals) and
returned as integer thousandths (`stockMilli`, `qtyMilli`, …). Money in minor units.

| Method & path                       | Notes                                                                                                    |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `GET/POST /suppliers`               | `{ name, contact?, phone?, email?, notes?, active }`                                                     |
| `PATCH/DELETE /suppliers/:id`       |                                                                                                          |
| `GET /ingredients`                  | `Ingredient[]` with `stockMilli`, `minMilli`, `costPerUnitMinor`, `valueMinor`, `low`                    |
| `GET /ingredients/low`              | Active ingredients below their minimum                                                                   |
| `POST /ingredients`                 | `{ name, unit: kg\|g\|l\|ml\|piece, category, minQty, costPerUnitMinor, supplierId?, active, stockQty }` |
| `PATCH /ingredients/:id`            | Same without `stockQty` (stock only changes through movements)                                           |
| `DELETE /ingredients/:id`           | `409 CONFLICT` while a recipe uses it                                                                    |
| `GET /stock-movements`              | `?ingredientId=&type=&limit=` → `StockMovement[]`, newest first                                          |
| `POST /waste`                       | `{ type: 'waste'\|'staff_meal', reason, ingredientId + qty \| menuItemId + dishes + variantId? }` → 204  |
| `GET /costing`                      | `ItemCosting[]`: recipe lines, food cost, net price, margin per item, size and option                    |
| `PUT /menu/items/:id/recipe`        | `{ lines: [{ ingredientId, qty, variantId? }] }` (replaces the recipe)                                   |
| `PUT /menu/modifiers/:id/recipe`    | `{ lines: [{ ingredientId, qty }] }`                                                                     |
| `GET/POST /purchase-orders`         | `{ supplierId, expectedAt?, notes?, lines: [{ ingredientId, qty, unitCostMinor }] }`                     |
| `GET/PATCH /purchase-orders/:id`    | Drafts only for PATCH                                                                                    |
| `POST /purchase-orders/:id/send`    | draft → sent                                                                                             |
| `POST /purchase-orders/:id/receive` | `{ lines: [{ lineId, qty, unitCostMinor? }] }`, partial allowed; weighted-average cost                   |
| `POST /purchase-orders/:id/cancel`  | draft or sent                                                                                            |
| `GET/POST /stock-counts`            | `{ category?, note? }` starts a count (expected quantities frozen)                                       |
| `GET/PATCH /stock-counts/:id`       | `{ lines: [{ ingredientId, counted: qty \| null }] }`                                                    |
| `POST /stock-counts/:id/apply`      | Corrects counted ingredients by counted − expected; returns the variance                                 |
| `POST /stock-counts/:id/cancel`     |                                                                                                          |

Errors: `409 PO_STATE`, `409 RECEIVE_TOO_MUCH`, `409 COUNT_STATE`, `400 INVALID_REFERENCE`.
Stock is deducted automatically when items are sent or paid (location setting `stockDeductOn`).

## Reservations

Location-scoped. View: `reservation.view`; changes: `reservation.manage`. Times are ISO instants;
dates are local (Europe/Tirane) `YYYY-MM-DD`.

| Method & path                    | Notes                                                                                                    |
| -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `GET /reservations?date=`        | `Reservation[]` of the day (04:00–04:00)                                                                 |
| `GET /reservations/availability` | `?date&partySize&durationMin?&excludeId?` → `[{ time, startsAt, freeTableIds, available }]`              |
| `GET /reservations/booking-link` | `{ url }` of the public booking page                                                                     |
| `GET /reservations/:id`          | `Reservation`                                                                                            |
| `POST /reservations`             | `{ uuid, startsAt, durationMin, partySize, name, phone, notes?, tableId \| null }`; idempotent on `uuid` |
| `PATCH /reservations/:id`        | Same without `uuid`; booked/confirmed only                                                               |
| `POST /reservations/:id/status`  | `{ status: 'confirmed' \| 'booked' \| 'completed' \| 'no_show' \| 'cancelled' }`                         |
| `POST /table-sessions`           | Seating: add `reservationId` when opening the table                                                      |

Public (no account, rate-limited): `GET /public/locations/:id/booking` (`PublicBookingInfo`),
`GET /public/locations/:id/availability?date&partySize` (`{ date, slots: [{ time, available }] }`),
`POST /public/locations/:id/reservations` (`{ uuid, date, time, partySize, name, phone, notes? }` →
`{ reference, startsAt, date, time, partySize, name, locationName }`).

Errors: `409 RESERVATION_CONFLICT` (details: the other booking), `409 RESERVATION_STATE`,
`409 NO_AVAILABILITY`, `403 BOOKING_DISABLED`. Floor tables carry `reservation` (from 60 minutes
before) and the status `reserved`.

## Staff time

| Method & path                       | Permission     | Notes                                                                    |
| ----------------------------------- | -------------- | ------------------------------------------------------------------------ |
| `GET /me/clock`                     | `time.clock`   | `{ clockedIn, entry, shift }` (today's shift)                            |
| `GET /me/shifts?from&to`            | `time.clock`   | Own shifts                                                               |
| `POST /time-entries/clock-in`       | `time.clock`   | → `ClockResult`; `409 ALREADY_CLOCKED_IN`                                |
| `POST /time-entries/clock-out`      | `time.clock`   | → `ClockResult`; `409 NOT_CLOCKED_IN`                                    |
| `POST /auth/pin-clock`              | device cookie  | `{ userId, pin, locationId }` toggles in/out on a shared device          |
| `GET /shifts?from&to&userId?`       | `shift.manage` | `Shift[]`                                                                |
| `POST /shifts`, `PATCH /shifts/:id` | `shift.manage` | `{ userId, startsAt, endsAt, note? }`; `409 SHIFT_OVERLAP`; at most 16 h |
| `DELETE /shifts/:id`                | `shift.manage` |                                                                          |
| `GET /time-entries?from&to&userId?` | `shift.manage` | `TimeEntry[]`                                                            |
| `POST /time-entries`, `PATCH /:id`  | `shift.manage` | `{ userId, clockIn, clockOut \| null, note? }` (audited)                 |
| `DELETE /time-entries/:id`          | `shift.manage` | Audited                                                                  |
| `GET /time-entries/hours?from&to`   | `shift.manage` | `HoursRow[]`: worked and scheduled minutes per person                    |
| `GET /time-entries/hours.csv`       | `shift.manage` | Payroll CSV: one row per entry, decimal hours                            |

`GET /auth/pin-users` now also returns `clockedIn` per person.

## Real-time (Socket.IO)

Same origin, path `/socket.io`. Handshake `auth: { token: <accessToken>, locationId }`; errors
`unauthorized`, `token_expired`, `forbidden`. The socket joins `location:<id>` and `user:<id>`.

| Event                       | Room               | `data`                                                                             |
| --------------------------- | ------------------ | ---------------------------------------------------------------------------------- |
| `table.updated`             | location           | `{ tableIds: number[], layout: boolean }`                                          |
| `menu.item_availability`    | location           | `{ itemId, outOfStockUntil }`                                                      |
| `order.items_sent`          | location + station | `{ orderId, stationIds, ticketIds }`                                               |
| `order_item.status_changed` | location           | `{ orderId, tableSessionId, waiterId, tableNames, items: [{ id, name, status }] }` |
| `kds.ticket_bumped`         | location + station | `{ ticketId, stationId, status }`                                                  |
| `service_request.created`   | location + waiter  | `{ requestId, type, tableId, tableName, tableSessionId, waiterId }`                |
| `guest_order.pending`       | location + waiter  | `{ orderId, tableSessionId, tableNames, waiterId, itemCount }`                     |
| `bill.updated`              | location           | `{ orderId }`                                                                      |
| `cash_drawer.updated`       | location           | `{}`                                                                               |
| `stock.low`                 | location           | `{ ingredientId, name, stockMilli, minMilli, unit }`                               |
| `reservation.updated`       | location           | `{ reservationIds }`                                                               |
| `time_entry.updated`        | location           | `{ userId }`                                                                       |

A kitchen screen joins a station room with `socket.emit('station:join', { stationId }, ack)`
(`ack(true)` when the station belongs to the location); joining another station leaves the old one.

Guests' phones connect to the namespace `/guest` with `auth: { tableToken }`, join `table:<id>` and
receive only `guest.updated` `{ tableIds }` when something changes at their table (D-056).

Every event is `{ type, locationId, at, data }`. Treat events as hints and refetch from the REST API.
