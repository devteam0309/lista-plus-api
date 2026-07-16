import rateLimit from 'express-rate-limit';
import { config } from '../config/env.js';

const shared = {
  standardHeaders: true,
  legacyHeaders: false,
  // Disabled under test so suites don't trip the limiter.
  skip: () => config.isTest,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later' } },
};

/** Sign-in is unauthenticated and hits Google — keyed by IP, kept tight. */
export const authLimiter = rateLimit({
  ...shared,
  windowMs: 15 * 60 * 1000,
  limit: 20,
});

/**
 * Keyed by user, not IP: a whole sari-sari neighbourhood can share one NAT'd
 * mobile IP, and one busy store must not rate-limit its neighbours.
 */
export const syncLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 1000,
  limit: 60,
  keyGenerator: (req) => (req.userId ? String(req.userId) : req.ip),
});

export const billingLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 60 * 1000,
  limit: 30,
  keyGenerator: (req) => (req.userId ? String(req.userId) : req.ip),
});
