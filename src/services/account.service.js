import mongoose from 'mongoose';

import { supportsTransactions } from '../config/db.js';
import { ENTITY_REGISTRY, ENTITY_TYPES } from '../models/registry.js';
import { User } from '../models/User.js';
import { logger } from '../utils/logger.js';

/**
 * Removes every synced document owned by the account.
 *
 * Driven off {@link ENTITY_TYPES} rather than a hand-written list so a future
 * entity added to the registry is erased too — a deletion endpoint that
 * silently misses a collection is worse than no endpoint at all.
 */
async function deleteEntities(userId, session) {
  const options = session ? { session } : {};
  const deleted = {};

  for (const type of ENTITY_TYPES) {
    const result = await ENTITY_REGISTRY[type].model.deleteMany({ userId }, options);
    deleted[type] = result.deletedCount ?? 0;
  }

  return deleted;
}

/**
 * Erases the account and all of its data, permanently.
 *
 * <p>Entity documents go before the User document, never the reverse. On a
 * deployment without transactions a mid-way failure then leaves the User
 * intact, which is the only thing that lets the owner sign in and retry —
 * every query in this codebase is scoped by `userId`, so an orphaned pile of
 * documents with no User is unreachable by any authenticated route and would
 * have to be cleaned out of Atlas by hand.
 *
 * <p>No tombstone is written. A deleted account has no peers left to notify:
 * other devices holding a JWT for it get a 401 from `requireAuth` ("Account no
 * longer exists") and sign themselves out.
 */
export async function deleteAccount(userId) {
  const useTransaction = await supportsTransactions();
  let deleted = {};

  if (useTransaction) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        // withTransaction may replay the body on a transient error; deleteMany
        // is idempotent, but the counts must not accumulate across attempts.
        deleted = await deleteEntities(userId, session);
        await User.deleteOne({ _id: userId }, { session });
      });
    } finally {
      await session.endSession();
    }
  } else {
    deleted = await deleteEntities(userId, null);
    await User.deleteOne({ _id: userId });
  }

  const total = Object.values(deleted).reduce((sum, count) => sum + count, 0);
  logger.info(
    { userId: String(userId), total, transactional: useTransaction },
    'account deleted'
  );

  return { deleted, total };
}
