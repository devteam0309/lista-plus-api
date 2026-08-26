import { asyncHandler } from '../utils/asyncHandler.js';
import * as syncService from '../services/sync.service.js';

export const pullChanges = asyncHandler(async (req, res) => {
  const { since, cursor } = req.validatedQuery;
  const result = await syncService.pull(req.userId, since, cursor ?? null);
  res.json(result);
});

export const pushChanges = asyncHandler(async (req, res) => {
  const result = await syncService.push(req.userId, req.body.changes);
  res.json(result);
});
