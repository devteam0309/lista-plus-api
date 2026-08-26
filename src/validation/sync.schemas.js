import { z } from 'zod';
import { ENTITY_TYPES } from '../models/registry.js';

/** Guard against a runaway client shipping an unbounded batch in one request. */
export const MAX_BATCH_SIZE = 1000;

export const syncChangeSchema = z.object({
  entityType: z.enum(ENTITY_TYPES),
  globalId: z.string().uuid(),
  // Validated per-entityType later — a tombstone carries payload: null.
  payload: z.record(z.any()).nullable().optional(),
  updatedAt: z.number().int().nonnegative(),
  deleted: z.boolean().optional().default(false),
});

export const pushBodySchema = z.object({
  changes: z.array(syncChangeSchema).max(MAX_BATCH_SIZE),
});

/**
 * Page cursor, opaque to the client: `serverTime:updatedAt:entityType:globalId`.
 * The first three fix the resume position in the (updatedAt, entityType,
 * globalId) total order; serverTime carries the first page's timestamp through
 * the whole paging cycle so the client can always persist the last page's.
 */
const CURSOR_RE = /^(\d{1,16}):(\d{1,16}):([a-z_]{1,32}):([0-9a-fA-F-]{36})$/;

export const pullCursorSchema = z
  .string()
  .regex(CURSOR_RE, 'Malformed cursor')
  .transform((raw) => {
    const [, serverTime, updatedAt, entityType, globalId] = raw.match(CURSOR_RE);
    return {
      serverTime: Number(serverTime),
      updatedAt: Number(updatedAt),
      entityType,
      globalId,
    };
  })
  .refine((c) => ENTITY_TYPES.includes(c.entityType), { message: 'Malformed cursor' });

export const pullQuerySchema = z.object({
  // Query strings arrive as text; coerce then bound.
  since: z.coerce.number().int().nonnegative().optional().default(0),
  cursor: pullCursorSchema.optional(),
});
