# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read the README first

`README.md` is the spec for this service and is kept current: sync semantics, the full endpoint
reference with error codes, entity payload fields, known limits, and the Android client work this
API depends on. Don't restate it here — extend it there when behaviour changes.

## Commands

```bash
npm run dev          # nodemon, needs a reachable MONGODB_URI
npm run dev:memdb    # dev server against a throwaway in-memory Mongo; data wiped on exit
npm test             # full suite
npm test -- tests/sync.push.test.js          # one file
npm test -- -t "older loses"                 # one test by name (substring match)
```

There is no lint or build step — plain ESM, no transpile.

Tests need `NODE_OPTIONS=--experimental-vm-modules` (the `test` script sets it via `cross-env`);
running bare `jest` fails on ESM. `--runInBand` is deliberate — the suites share one
`mongodb-memory-server` instance and wipe collections between tests. The first run downloads a
mongod binary, hence the 60s timeout.

## Architecture notes

**The client is authoritative, not this server.** The Android app's Room DB is the source of truth;
this service only exchanges deltas and must never overwrite newer local data.

**`updatedAt` is the client's epoch-millis value and drives last-write-wins.** It is not a server
timestamp. Mongoose's automatic `updatedAt` is disabled in `models/syncPlugin.js` to stop it
clobbering that value; `serverUpdatedAt` exists for auditing and must stay out of conflict
resolution. Anything that writes a synced collection outside the sync service needs to respect this.

**`models/registry.js` is the single source of truth** mapping wire `entityType` → model, payload
schema, money fields, and the wire projection. Adding an entity is three edits (model using
`syncPlugin`, payload schema, registry row) and pull/push/conflict/isolation come for free. A field
missing from the registry's `fields` or from the Zod schema is silently dropped on sync — that's a
data-loss bug, not a validation nit.

**Push has two paths, chosen by a boot-time probe** (`config/db.js:supportsTransactions`): a
transactional batch on replica sets, per-change conditional upserts on standalone. Both must keep
the same last-write-wins semantics. The unique `(userId, globalId)` index isn't just a constraint —
it's load-bearing for the standalone path's correctness (a duplicate-key error is read as
"skipped"). Tests run standalone, so the transactional path is not covered by `npm test`.

**Money is Decimal128 in storage, JSON numbers on the wire** (`utils/money.js`). Conversion happens
at the sync boundary via the registry's `moneyFields`. Don't do arithmetic on the JS numbers.

**Every query scopes on `req.userId` from the verified JWT.** A client-supplied `userId` is never
trusted anywhere; there is a test asserting a forged one is ignored. Keep it that way.

## Conventions

Controllers stay thin (parse → call service → shape response); real logic lives in `services/`.
Wrap async handlers in `utils/asyncHandler.js` and throw `ApiError` — the error envelope and its
stable `code` strings are a client contract, so reuse existing codes rather than inventing new ones.
