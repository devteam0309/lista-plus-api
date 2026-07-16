import { Router } from 'express';
import * as syncController from '../controllers/sync.controller.js';
import { requireAuth, requirePremium } from '../middleware/auth.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { pullQuerySchema, pushBodySchema } from '../validation/sync.schemas.js';
import { syncLimiter } from '../middleware/rateLimiters.js';

export const syncRouter = Router();

// requireAuth first: the limiter keys on req.userId.
syncRouter.use(requireAuth, requirePremium, syncLimiter);

syncRouter.get('/pull', validateQuery(pullQuerySchema), syncController.pullChanges);
syncRouter.post('/push', validateBody(pushBodySchema), syncController.pushChanges);
