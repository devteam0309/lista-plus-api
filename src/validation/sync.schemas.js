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

export const pullQuerySchema = z.object({
  // Query strings arrive as text; coerce then bound.
  since: z.coerce.number().int().nonnegative().optional().default(0),
});
