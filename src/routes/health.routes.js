import { Router } from 'express';
import { health } from '../controllers/health.controller.js';

export const healthRouter = Router();

healthRouter.get('/', health);
