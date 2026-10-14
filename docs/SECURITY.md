# Security review (Phase 10, against plan §11)

Reviewed on 2026-10-14 against the code at the end of Phase 10. Each item says how it is met and
where it is tested. "Open" items need a decision or work before a real deployment.

## Plan §11 checklist

| Requirement                                              | Status | How                                                                                                                                                                                                                                                 |
| -------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Helmet                                                   | ✅     | `helmet()` on every API response (CSP, HSTS, nosniff, frame options, no `X-Powered-By`). nginx adds a CSP, `X-Frame-Options`, `Referrer-Policy` and `Permissions-Policy` to both apps.                                                              |
| CORS allowlist                                           | ✅     | `CORS_ORIGINS` (exact origins, credentials only for them). In Docker both apps are same-origin with the API through nginx.                                                                                                                          |
| Rate limiting, stricter on `/auth/*` and `/guest/*`      | ✅     | Whole API 600/min per IP; sign-in, PIN and PIN clock 20/min; guest QR endpoints 120/min; online booking 10 per 10 min. Off in tests, which test them separately.                                                                                    |
| Request size limits                                      | ✅     | JSON bodies 1 MB; image uploads 5 MB, one file, no fields; nginx caps bodies at 6 MB (staff) and 1 MB (guest).                                                                                                                                      |
| Passwords bcrypt cost 12                                 | ✅     | `BCRYPT_COST` defaults to 12 (production compose pins 12); unknown emails still spend a bcrypt comparison, so timing does not reveal accounts.                                                                                                      |
| PINs bcrypt with lockout                                 | ✅     | 5 wrong PINs lock that person for 5 minutes, shared by PIN switch, PIN clock-in and manager approvals (`auth/pin.test.ts`).                                                                                                                         |
| Refresh tokens hashed and rotated on every use           | ✅     | Stored as SHA-256; every refresh issues a new one; reusing a rotated token revokes the whole family (`auth.test.ts`). httpOnly, `SameSite=Strict`, `Secure` in production, path limited to `/api/v1/auth`; 14 days.                                 |
| RBAC middleware                                          | ✅     | `requirePermission(...)` on every staff route; navigation and screens follow permissions, never role names. Each module's tests include a permission-denied case; e2e `permissions.spec.ts`.                                                        |
| Location scoping on every route                          | ✅     | `requireLocation` checks the `X-Location-Id` against the user's locations; services filter by location id. Reports with several locations check `report.view` at each (`reports.test.ts`).                                                          |
| Approval tokens: one use, 60 s, bound to action + entity | ✅     | `consumeApproval` marks the token used in the same transaction and checks action, entity and location (`approvals.test.ts`).                                                                                                                        |
| Never trust client totals or prices                      | ✅     | Prices are snapshotted from the menu on the server; totals, tax, discounts and balances are recomputed server-side (business rule 2); payments above the balance are refused.                                                                       |
| Uploaded images: type sniffing, 5 MB, re-encode          | ✅     | sharp reads the real format (not the file name or MIME type) and rejects anything that is not JPEG, PNG, WebP, AVIF, HEIF or GIF; animations keep only their first frame; images are re-encoded to WebP, dropping metadata (`menu/images.test.ts`). |
| `.env` for secrets, `.env.example` committed             | ✅     | `.env`, `.env.production` and `.env.*.local` are git-ignored; `.env.example` and `.env.production.example` are committed. `JWT_ACCESS_SECRET` must be at least 32 characters or the API refuses to start.                                           |
| SQL only through Knex parameter binding                  | ✅     | All values are bound. The few `raw` fragments contain only constants written in the code (no user input); the audit filter escapes `%` and `_` in its LIKE prefix.                                                                                  |

## Found and fixed in Phase 10

- **Sign-ins were not audited.** Successful sign-ins and wrong passwords for known accounts are now
  in the audit log (without the password); unknown emails are rate-limited only.
- **Audit log viewer is read-only** by construction: the API has no route that changes or deletes
  audit rows (`audit.test.ts` checks that edit/delete return 404).
- **Dependencies:** `npm audit` reports 0 vulnerabilities (Tailwind 4, esbuild 0.28; D-091).
- **Booking page framing:** only `/book/*` on the guest app may be embedded in another site; every
  other page sends `frame-ancestors 'none'` / `X-Frame-Options: DENY`.

## Open before going live

1. **HTTPS.** The Docker stack serves plain HTTP on 8080/8081; terminate TLS in front of it.
   Session cookies are `Secure` in production, so sign-in only works over HTTPS (or localhost).
2. **Fiscalization is a mock** (D-067). The real DPT integration with the business certificate
   must be implemented and certified.
3. **One API instance.** Rate limits and Socket.IO rooms live in memory. Running several API
   instances needs a shared store (e.g. Redis) for both.
4. **Database user.** The app user owns its schema (migrations need DDL). Consider a separate
   migration user and a DML-only runtime user.
5. **Backups** of the MySQL volume and the uploads volume, and a tested restore.
6. **4-digit PINs** are convenient but guessable without the lockout; keep the lockout and the
   requirement that a device is first signed in with a manager's email and password.
7. **Secrets rotation:** changing `JWT_ACCESS_SECRET` signs everyone out (by design); plan when.
