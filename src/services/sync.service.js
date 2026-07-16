import mongoose from 'mongoose';
import { ENTITY_REGISTRY, ENTITY_TYPES } from '../models/registry.js';
import { supportsTransactions } from '../config/db.js';
import { toDecimal, fromDecimal } from '../utils/money.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';

/* ------------------------------------------------------------------ *
 * Wire mapping
 * ------------------------------------------------------------------ */

function projectPayload(registryEntry, doc) {
  const payload = {};
  for (const field of registryEntry.fields) {
    const value = doc[field];
    payload[field] = registryEntry.moneyFields.includes(field)
      ? fromDecimal(value)
      : (value ?? null);
  }
  return payload;
}

function toSyncChange(entityType, registryEntry, doc) {
  return {
    entityType,
    globalId: doc.globalId,
    payload: doc.deleted ? null : projectPayload(registryEntry, doc),
    updatedAt: doc.updatedAt,
    deleted: Boolean(doc.deleted),
  };
}

/**
 * Build the $set for a change.
 *
 * A tombstone only flips `deleted` and `updatedAt` — the entity fields are left
 * as they were, so the row still says who/what was deleted (useful for support,
 * and required if we ever restore).
 */
function buildSet(registryEntry, userId, change) {
  const set = {
    userId,
    globalId: change.globalId,
    updatedAt: change.updatedAt,
    deleted: Boolean(change.deleted),
    serverUpdatedAt: new Date(),
  };

  if (!change.deleted) {
    for (const [field, value] of Object.entries(change.payload)) {
      set[field] = registryEntry.moneyFields.includes(field) ? toDecimal(value) : value;
    }
  }

  return set;
}

/* ------------------------------------------------------------------ *
 * Pull
 * ------------------------------------------------------------------ */

export async function pull(userId, since) {
  // Sampled BEFORE the reads. Anything committed while we are querying keeps an
  // updatedAt greater than this value, so the client's next pull still sees it.
  // (Cost: some changes may be delivered twice — pull is idempotent client-side.)
  const serverTime = Date.now();

  const perEntity = await Promise.all(
    ENTITY_TYPES.map(async (entityType) => {
      const registryEntry = ENTITY_REGISTRY[entityType];
      const docs = await registryEntry.model
        .find({ userId, updatedAt: { $gt: since } })
        .sort({ updatedAt: 1 })
        .lean();
      return docs.map((doc) => toSyncChange(entityType, registryEntry, doc));
    })
  );

  const changes = perEntity.flat().sort((a, b) => a.updatedAt - b.updatedAt);

  return { serverTime, changes };
}

/* ------------------------------------------------------------------ *
 * Push
 * ------------------------------------------------------------------ */

/**
 * Validate every change before writing anything, so a malformed batch is
 * rejected whole rather than half-applied.
 * @returns {Array} changes with payloads parsed/normalised
 */
export function validateChanges(changes) {
  return changes.map((change, index) => {
    const registryEntry = ENTITY_REGISTRY[change.entityType];

    if (change.deleted) {
      return { ...change, payload: null };
    }

    if (change.payload === null || change.payload === undefined) {
      throw ApiError.badRequest(`changes[${index}]: payload is required when deleted is false`, {
        index,
        globalId: change.globalId,
      });
    }

    const parsed = registryEntry.payloadSchema.safeParse(change.payload);
    if (!parsed.success) {
      throw ApiError.badRequest(`changes[${index}]: invalid payload for ${change.entityType}`, {
        index,
        globalId: change.globalId,
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }

    return { ...change, payload: parsed.data };
  });
}

/**
 * Standalone-Mongo path: a single conditional upsert per change, which is
 * atomic on its own. The `updatedAt: { $lt }` filter *is* the last-write-wins
 * rule — if the stored copy is newer or equal the filter misses, the upsert
 * attempts an insert, and the unique (userId, globalId) index turns that into a
 * duplicate-key error which we read as "skipped".
 */
async function applyConditional(registryEntry, userId, change) {
  try {
    const result = await registryEntry.model.updateOne(
      { userId, globalId: change.globalId, updatedAt: { $lt: change.updatedAt } },
      { $set: buildSet(registryEntry, userId, change) },
      { upsert: true }
    );
    return result.upsertedCount > 0 || result.matchedCount > 0 ? 'applied' : 'skipped';
  } catch (err) {
    if (err?.code === 11000) return 'skipped';
    throw err;
  }
}

/**
 * Replica-set path: read-compare-write inside the caller's session. We cannot
 * lean on the duplicate-key trick here because a write error aborts the whole
 * transaction; the session's snapshot isolation plus withTransaction's retry on
 * transient conflicts gives us the same guarantee.
 */
async function applyInSession(registryEntry, userId, change, session) {
  const existing = await registryEntry.model
    .findOne({ userId, globalId: change.globalId }, { updatedAt: 1 }, { session })
    .lean();

  if (existing && existing.updatedAt >= change.updatedAt) return 'skipped';

  await registryEntry.model.updateOne(
    { userId, globalId: change.globalId },
    { $set: buildSet(registryEntry, userId, change) },
    { upsert: true, session }
  );
  return 'applied';
}

export async function push(userId, rawChanges) {
  const changes = validateChanges(rawChanges);
  const serverTime = Date.now();

  if (changes.length === 0) return { serverTime, applied: 0, skipped: 0 };

  const useTransaction = await supportsTransactions();

  let applied = 0;
  let skipped = 0;

  if (useTransaction) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        // Reset counters: withTransaction may replay the body on a transient error.
        applied = 0;
        skipped = 0;
        for (const change of changes) {
          const registryEntry = ENTITY_REGISTRY[change.entityType];
          const outcome = await applyInSession(registryEntry, userId, change, session);
          if (outcome === 'applied') applied += 1;
          else skipped += 1;
        }
      });
    } finally {
      await session.endSession();
    }
  } else {
    for (const change of changes) {
      const registryEntry = ENTITY_REGISTRY[change.entityType];
      const outcome = await applyConditional(registryEntry, userId, change);
      if (outcome === 'applied') applied += 1;
      else skipped += 1;
    }
  }

  logger.info({ userId: String(userId), applied, skipped, transactional: useTransaction }, 'sync push');

  return { serverTime, applied, skipped };
}
