import { Router } from 'express';
import * as billingController from '../controllers/billing.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { verifyPurchaseBodySchema } from '../validation/billing.schemas.js';
import { billingLimiter } from '../middleware/rateLimiters.js';

export const billingRouter = Router();

// Auth required, but NOT requirePremium — this is the endpoint that grants it.
billingRouter.post(
  '/verify',
  requireAuth,
  billingLimiter,
  validateBody(verifyPurchaseBodySchema),
  billingController.verify
);
