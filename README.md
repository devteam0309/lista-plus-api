# Lista+ Cloud API

Cloud backup & sync backend for **Lista+**, an offline-first customer credit ledger (*listahan ng utang*) for sari-sari stores.

The Android app's Room database is the **source of truth**. This API only exchanges changes with it — it is never authoritative over newer local data. The free tier stays 100% offline and never touches this service; cloud sync is a **Premium-only** feature unlocked by a lifetime Google Play purchase.

- **Stack:** Node 20+, Express 4, Mongoose 8, MongoDB 6+
- **Auth:** Google Sign-In ID token → verified server-side → exchanged for a JWT
- **Sync:** delta pull/push with **last-write-wins** on a client-supplied `updatedAt`, tombstones for deletes, idempotent batch apply

---

## Quick start

```bash
npm install
cp .env.example .env     # then fill in the values below
npm run dev              # nodemon on http://localhost:3000
npm start                # production
npm test                 # Jest + supertest against an in-memory MongoDB
```

Verify it's up:

```bash
curl http://localhost:3000/api/v1/health
# {"status":"ok","dbConnected":true,"serverTime":1736899200000}
```

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `PORT` | no | Default `3000`. |
| `NODE_ENV` | no | `development` \| `production` \| `test`. |
| `LOG_LEVEL` | no | pino level, default `info`. |
| `MONGODB_URI` | **yes** | Standalone works; a replica set / Atlas enables atomic batch push (see [Transactions](#transactions-and-the-two-push-paths)). |
| `JWT_SECRET` | **yes** | Long random string. Rotating it invalidates every issued API token. |
| `JWT_EXPIRES_IN` | no | Default `30d`. |
| `GOOGLE_CLIENT_ID` | **yes** | The **Web** OAuth client ID — must equal the `requestIdToken(...)` server client ID in the Android app, or every sign-in 401s. |
| `APP_PACKAGE` | no | Default `com.jorres.listaplus`. |
| `GOOGLE_PLAY_SA_KEY` | for billing | Service-account key: an absolute path to the JSON file, or the raw JSON itself. Needs *View financial data* on the Play Console app. |
| `CORS_ORIGINS` | no | Comma-separated browser allowlist for the future web dashboard. The Android app is not a browser and is unaffected. |
| `SYNC_MAX_DOCS_PER_USER` | no | Storage quota per account, summed across entity types. Default `200000`; `0` disables. |

---

## Architecture

```
src/
  server.js              bootstrap: connect DB, probe txn support, listen, graceful shutdown
  app.js                 express app: helmet, CORS, pino-http, routers, error handler
  config/
    env.js               env parsing + fail-fast on missing secrets
    db.js                mongoose connection, health, transaction-capability probe
  models/
    syncPlugin.js        shared envelope: userId, globalId, updatedAt, deleted + indexes
    registry.js          entityType → { model, payloadSchema, moneyFields, fields }
    User.js, Customer.js, Product.js, CreditTransaction.js,
    CreditTransactionItem.js, Payment.js, PaymentAllocation.js, ActivityLog.js
  middleware/            auth (JWT + premium gate), validate, errorHandler, rateLimiters
  routes/                auth, sync, billing, health  (mounted under /api/v1)
  controllers/           thin — parse request, call service, shape response
  services/              googleAuth, playBilling, sync  (all the real logic)
  validation/            Zod schemas
tests/
```

Request flow: `route → rate limiter → requireAuth → requirePremium → Zod validate → controller → service → model`.

**Adding an entity** is three edits: a Mongoose model using `syncPlugin`, a payload schema in `validation/entity.schemas.js`, and one row in `models/registry.js`. Pull, push, conflict resolution, and isolation come for free.

---

## Endpoint reference

All routes are under `/api/v1`. Authenticated routes take `Authorization: Bearer <jwt>`.

Errors share one envelope:

```json
{ "error": { "code": "PREMIUM_REQUIRED", "message": "Cloud sync requires Lista+ Premium" } }
```

| Code | Status | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Body/query failed Zod validation; `details` lists the offending paths. |
| `BAD_REQUEST` | 400 | Malformed JSON, or a change missing its payload. |
| `PURCHASE_INVALID` | 400 | Play says the purchase is refunded, pending, consumed, or unknown. |
| `UNAUTHORIZED` | 401 | Missing/invalid/expired token, or the account no longer exists. |
| `PREMIUM_REQUIRED` | 403 | Free tier hitting a sync endpoint. |
| `NOT_FOUND` | 404 | No such route. |
| `PURCHASE_ALREADY_CLAIMED` | 409 | That purchase token is bound to another account. |
| `QUOTA_EXCEEDED` | 403 | The account is at its `SYNC_MAX_DOCS_PER_USER` storage quota; pushes are refused until it is raised. |
| `PAYLOAD_TOO_LARGE` | 413 | Body over 5 MB — split the batch. |
| `RATE_LIMITED` | 429 | See [Rate limits](#rate-limits). |
| `BILLING_UNAVAILABLE` | 503 | Server has no Play service-account key configured. |
| `BILLING_UPSTREAM_ERROR` | 502 | Google Play could not be reached. Retry. |

### `GET /health`

No auth. Returns `503` when Mongo is down, so it doubles as a readiness probe.

```json
{ "status": "ok", "dbConnected": true, "serverTime": 1736899200000 }
```

### `POST /auth/google`

Exchanges a Google ID token for an API token. The ID token is verified against `GOOGLE_CLIENT_ID` as the audience, so a token minted for another app is rejected. The user is upserted on the Google `sub` (never the email — emails change).

```jsonc
// request
{ "idToken": "<google id token>" }

// 200
{
  "token": "<jwt>",
  "user": { "id": "652f...", "email": "nena@example.com", "displayName": "Aling Nena",
            "premium": false, "premiumSince": null }
}
```

`401` on an invalid/expired token or an unverified Google email.

### `GET /auth/me`

Returns the current `user` object. Useful for re-checking premium status at app start.

### `POST /auth/logout`

Stateless — the client discards the token. Returns `{ "success": true }`. To support real revocation, add a `jti` denylist checked in `requireAuth`.

### `POST /billing/verify`

Verifies a Play purchase and unlocks Premium. Requires auth but **not** premium — this is what grants it.

```jsonc
// request
{ "productId": "listaplus_premium_lifetime", "purchaseToken": "<token>" }

// 200
{ "premium": true, "premiumSince": 1736899200000 }
```

### `GET /sync/pull?since=<epochMillis>`

Returns every change for the authenticated user with `updatedAt > since`, across all entity types, tombstones included. `since=0` (or omitted) is a full sync.

```jsonc
{
  "serverTime": 1736899200000,
  "changes": [
    { "entityType": "customer", "globalId": "3f1a...", "updatedAt": 1736899100000,
      "deleted": false, "payload": { "fullName": "Aling Nena", "creditLimit": 1500, ... } },
    { "entityType": "payment", "globalId": "1a2b...", "updatedAt": 1736899150000,
      "deleted": true, "payload": null }
  ]
}
```

Changes are sorted by `updatedAt` ascending across all types. Store `serverTime` and pass it as the next `since`.

### `POST /sync/push`

```jsonc
// request — max 1000 changes per batch
{ "changes": [ { "entityType": "customer", "globalId": "3f1a...",
                 "updatedAt": 1736899200000, "deleted": false, "payload": { ... } } ] }

// 200
{ "serverTime": 1736899200000, "applied": 1, "skipped": 0 }
```

`applied` = written; `skipped` = the server's copy was newer or equal.

### `SyncChange`

| Field | Type | Notes |
|---|---|---|
| `entityType` | string | `customer` \| `product` \| `transaction` \| `transaction_item` \| `payment` \| `payment_allocation` \| `activity_log` |
| `globalId` | uuid-v4 | Stable cross-device id. Unique **per user**, so two stores may hold the same UUID without colliding. |
| `payload` | object \| null | The full entity. `null` when `deleted` is true. |
| `updatedAt` | number | Epoch millis. Drives conflict resolution. |
| `deleted` | boolean | Tombstone flag. |

### Entity payloads

| entityType | payload fields |
|---|---|
| `customer` | `fullName`, `nickname`, `phone`, `address`, `creditLimit`, `notes`, `isActive` |
| `product` | `name`, `category`, `unit`, `price`, `isActive` |
| `transaction` | `customerGlobalId`, `transactionDate`, `totalAmount`, `amountPaid`, `status` (`unpaid`\|`partial`\|`paid`), `notes` |
| `transaction_item` | `transactionGlobalId`, `productGlobalId` (nullable), `productName`, `quantity`, `unit`, `unitPrice`, `lineTotal` |
| `payment` | `customerGlobalId`, `amount`, `paymentDate`, `notes` |
| `payment_allocation` | `paymentGlobalId`, `transactionGlobalId`, `amount` |
| `activity_log` | `type`, `subject`, `amount` (nullable), `customerGlobalId` (nullable), `refGlobalId`, `timestamp` |

Unknown payload keys are **stripped**. If the app adds a column that must survive a restore, add it to `validation/entity.schemas.js` and `models/registry.js` too, or it will be silently dropped.

---

## How sync works

### Last-write-wins

A change is applied only when its `updatedAt` is **strictly greater** than the stored `updatedAt`; otherwise it is skipped. Equal timestamps skip, which is what makes retries idempotent — a client that resends a batch after a flaky connection gets `applied: 0, skipped: n` and changes nothing.

Tombstones follow the identical rule: a delete at `t=2000` beats an edit at `t=1000`, and loses to an edit at `t=3000`. A tombstone keeps the row and only flips `deleted` — the record stays auditable and restorable. A tombstone for a `globalId` the server has never seen is still stored, because on a slow connection a delete can reach us before the insert it deletes.

### Transactions and the two push paths

The server probes the deployment once at boot and picks a path:

- **Replica set / Atlas** — the whole batch runs in one `withTransaction` session: read, compare, write. All-or-nothing.
- **Standalone Mongo** — no transactions available, so each change is a single **conditional upsert** (`{ userId, globalId, updatedAt: { $lt: incoming } }` with `upsert: true`), which is atomic on its own. The `$lt` filter *is* the last-write-wins rule: if the stored copy is newer the filter misses, the upsert tries to insert, and the unique `(userId, globalId)` index turns that into a duplicate-key error that we read as "skipped". No read-modify-write race.

The trade-off on standalone: a batch that dies halfway leaves the earlier changes applied. That is safe here — every change is independently idempotent and the client retries the whole batch, which re-applies the missing tail and skips the rest.

The test suite runs on `mongodb-memory-server` (standalone), so it exercises the conditional-upsert path — the one most self-hosted deployments will use.

### Indexes

Per synced collection:
- `{ userId: 1, globalId: 1 }` **unique** — the idempotency key, and the guard that makes the standalone push path correct.
- `{ userId: 1, updatedAt: 1 }` — serves `pull?since=`.

### Money

Peso amounts are stored as **Decimal128**, not JS floats: a ledger adds and subtracts the same values repeatedly, and binary float drift eventually shows up as a customer's balance being off by a centavo. On the wire they are plain JSON numbers, matching the app's `Double` Room columns — the precision guarantee is about what the server stores and computes with.

### Known limits

Worth knowing before this meets real traffic:

- **Pull is unpaginated** by design — the contract has no cursor, and truncating a response would silently corrupt a ledger (the client would advance `since` past data it never received). A store with years of history does one large first sync. If this becomes a problem, add pagination as a *contract change* on both sides, not a server-side cap.
- **`updatedAt` is the device's clock.** A phone with a badly wrong clock can write a change whose `updatedAt` is in the past and lose to the server copy forever. The future direction is bounded server-side: any `updatedAt` more than 24 h ahead of server time is **clamped** to `serverTime + 24h` on push, so a broken clock can no longer produce a row that nothing can ever overwrite. `serverTime` is sampled *before* the pull query so concurrent writes are re-delivered rather than missed. A clamped device's local copy keeps its original (higher) `updatedAt`, so that one device may skip pulled edits until its clock is fixed — the server and all other devices stay consistent.
- **Conflicts resolve per entity, not per field.** Two devices editing different fields of the same customer means the later write wins wholesale. Fine for one owner with one phone; revisit if multi-staff editing ships.

---

## Security

- Every sync/billing query is scoped to `req.userId`, taken from the verified JWT. A client-supplied `userId` is never read anywhere in the codebase (there's a test asserting a forged one is ignored).
- Google ID tokens are verified with `audience` pinned to `GOOGLE_CLIENT_ID`.
- A purchase token is bound to one account; replaying it on a second account is a `409`.
- `helmet`, a CORS allowlist, and per-route rate limits are on by default. Authorization headers, `idToken`, and `purchaseToken` are redacted from logs.
- Bodies are capped at 5 MB; batches at 1000 changes; accounts at `SYNC_MAX_DOCS_PER_USER` synced documents (a growth guard — the check is a soft cap enforced at push time).
- API tokens are verified with the algorithm pinned to HS256.
- Terminate TLS in front of this service in production (nginx/Render/Fly). `trust proxy` is enabled so `req.ip` reflects the real client.

### Rate limits

| Scope | Limit | Keyed by |
|---|---|---|
| `POST /auth/google` | 20 / 15 min | IP |
| `/sync/*` | 60 / min | **user** |
| `/billing/verify` | 30 / hour | **user** |

Sync is keyed by user, not IP, on purpose: a whole neighbourhood can share one NAT'd mobile IP, and one busy store must not rate-limit its neighbours.

---

## Observability

`pino` structured logs with a request id per request (honours an inbound `x-request-id`, echoes it on the response). Health checks are excluded from access logs. In development, logs are pretty-printed; in production they're JSON for shipping.

---

## Testing

```bash
npm test
```

5 suites on a real in-memory MongoDB (no mocked Mongoose). Google and Play are mocked at the module boundary.

| Suite | Covers |
|---|---|
| `auth.test.js` | Valid/invalid/expired ID token, unverified email, idempotent upsert, profile refresh, premium preserved across re-auth, Bearer rejection, deleted-account token |
| `sync.push.test.js` | Insert, newer-wins, older-loses, equal-skips, tombstone applied, stale tombstone loses, tombstone-before-insert, mixed batch, batch-level validation rejection, UUID-vs-Room-int guard, Decimal128 storage, auth + premium gate |
| `sync.pull.test.js` | `since` filtering, full sync, ordering across entity types, payload round-trip, tombstones surfaced, per-user isolation, forged `userId` ignored |
| `billing.test.js` | Purchase unlocks premium and sync, acknowledgement flow, refunded/pending/consumed refused, unknown token, Play outage → 502, token replay → 409, idempotency |
| `health.test.js` | Health shape, 404 envelope |

---

## Android client changes required

This API cannot drop in without matching work in the app. In order:

**1. Add `globalId` (UUID) to every synced entity — the big one.**
The app keys entities on Room auto-increment ints, which are local and collide across devices. Every synced table needs a `globalId: String` column, `UUID.randomUUID().toString()` at creation, unique-indexed. A Room migration must backfill existing rows.

**2. Rewrite foreign keys in the sync payload as `globalId`s.**
`CreditTransaction.customerId` (int) must serialize as `customerGlobalId` (uuid), and likewise `transactionGlobalId`, `productGlobalId`, `paymentGlobalId`, `refGlobalId`. Keep the local int FKs for Room's own joins — this is a mapping at the sync boundary, not a schema rewrite. **The server rejects a non-UUID FK with `400`**, deliberately: a silent accept would write orphaned rows that no join can ever repair. On pull, the app resolves an incoming `globalId` back to its local row (inserting a placeholder if the parent hasn't arrived yet — with pull sorted by `updatedAt`, a child can precede its parent).

**3. Dirty-tracking + `updatedAt`.**
Every synced table needs `updatedAt: Long` (epoch millis, set on every write) and an `isDirty: Boolean` flag. Push sends dirty rows; clear the flag only after a `2xx`. Deletes become soft deletes (`deleted = true`, bump `updatedAt`, mark dirty) — a hard delete can't propagate.

**4. Store `since` and the JWT.**
Persist the `serverTime` from each successful pull (DataStore/SharedPreferences) and send it as the next `since`. Store the JWT in `EncryptedSharedPreferences` — **not** plain SharedPreferences; it is a bearer credential for the store's entire ledger. On `401`, silently re-run Google Sign-In, POST the fresh ID token to `/auth/google`, and retry once.

**5. Wire `GOOGLE_CLIENT_ID` to the Web client ID.**
The app's `requestIdToken(...)` must pass the **Web** OAuth client ID (not the Android one), and it must be the same value as the server's `GOOGLE_CLIENT_ID`. A mismatch fails every sign-in with a `401` that looks like a server bug.

**6. Call `/billing/verify` after every purchase and on app start.**
Server-side verification is what unlocks sync. Until it returns `premium: true`, sync endpoints answer `403 PREMIUM_REQUIRED`. Re-verify on app start (or `/auth/me`) so a restore-purchases flow on a new device works.

**7. Sync order: push, then pull.**
Push local dirty rows first, then pull with the stored `since`. Reversed, you'd overwrite local edits with server state the user has already moved past. Keep the free tier's offline path completely untouched by all of this — no network call, ever.

### Server-side notes on the brief

Two places where the implementation deliberately reads past the letter of the spec:

- **Purchase acknowledgement.** The brief grants premium only on an *acknowledged* purchase, but the client can't acknowledge before the server has verified — that's a deadlock, and an unacknowledged purchase is auto-refunded by Play after 3 days. So the server acknowledges the purchase itself, then grants. If the acknowledge call fails, the entitlement is still granted and the next `/billing/verify` retries: a failed Play call must not cost a paying customer their purchase.
- **`updatedAt` vs. Mongoose timestamps.** The client's `updatedAt` drives conflict resolution, so Mongoose's automatic `updatedAt` is disabled to keep it from clobbering that value. Collections carry `createdAt` and a separate `serverUpdatedAt` for auditing; neither participates in conflict resolution.
