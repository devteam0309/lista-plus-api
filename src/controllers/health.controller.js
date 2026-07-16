import { isDbConnected } from '../config/db.js';

export function health(_req, res) {
  const dbConnected = isDbConnected();
  res.status(dbConnected ? 200 : 503).json({
    status: dbConnected ? 'ok' : 'degraded',
    dbConnected,
    serverTime: Date.now(),
  });
}
