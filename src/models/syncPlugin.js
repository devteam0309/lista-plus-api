import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Every synced collection carries the same envelope.
 *
 * Note on `updatedAt`: it is the CLIENT's epoch-millis value and it drives
 * last-write-wins, so Mongoose's own timestamps must not touch it. We keep
 * `createdAt` and add `serverUpdatedAt` for server-side auditing/debugging;
 * neither participates in conflict resolution.
 */
export function syncPlugin(schema) {
  schema.add({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    globalId: { type: String, required: true },
    updatedAt: { type: Number, required: true },
    deleted: { type: Boolean, default: false },
    serverUpdatedAt: { type: Date, default: Date.now },
  });

  schema.set('timestamps', { createdAt: 'createdAt', updatedAt: false });

  // Idempotent upsert key + per-user isolation.
  schema.index({ userId: 1, globalId: 1 }, { unique: true });
  // Drives GET /sync/pull?since=
  schema.index({ userId: 1, updatedAt: 1 });
}
