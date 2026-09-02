import { isDbConnected } from '../config/db.js';
import { describeCredentials } from '../services/playBilling.service.js';

export function health(_req, res) {
  const dbConnected = isDbConnected();
  res.status(dbConnected ? 200 : 503).json({
    status: dbConnected ? 'ok' : 'degraded',
    dbConnected,
    // Which Play service account this deployment holds. See
    // describeCredentials() — identity only, never the credential.
    billing: describeCredentials(),
    serverTime: Date.now(),
  });
}
