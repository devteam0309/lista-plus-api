import pino from 'pino';
import { config } from '../config/env.js';

export const logger = pino({
  level: config.isTest ? 'silent' : config.logLevel,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.body.idToken',
      'req.body.purchaseToken',
      'res.headers["set-cookie"]',
    ],
    censor: '[redacted]',
  },
  transport:
    config.isProd || config.isTest
      ? undefined
      : { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } },
});
