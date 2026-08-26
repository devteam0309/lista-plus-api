import { Router } from 'express';
import * as authController from '../controllers/auth.controller.js';
import { validateBody } from '../middleware/validate.js';
import { googleAuthBodySchema } from '../validation/auth.schemas.js';
import { authLimiter } from '../middleware/rateLimiters.js';
import { requireAuth } from '../middleware/auth.js';

export const authRouter = Router();

authRouter.post('/google', authLimiter, validateBody(googleAuthBodySchema), authController.googleSignIn);
authRouter.get('/me', requireAuth, authController.me);
authRouter.post('/logout', requireAuth, authController.logout);
// Rate-limited like sign-in: destructive, and a retry storm would hammer Atlas.
authRouter.delete('/me', authLimiter, requireAuth, authController.deleteMe);
