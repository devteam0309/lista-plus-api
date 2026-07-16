import { Router } from 'express';
import { authRouter } from './auth.routes.js';
import { syncRouter } from './sync.routes.js';
import { billingRouter } from './billing.routes.js';
import { healthRouter } from './health.routes.js';

export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/sync', syncRouter);
apiRouter.use('/billing', billingRouter);
