import dns from 'node:dns';
import mongoose from 'mongoose';
import { config } from './env.js';
import { logger } from '../utils/logger.js';

mongoose.set('strictQuery', true);

export async function connectDb(uri = config.mongodbUri) {
  // Opt-in only. Some Windows hosts leave c-ares unable to read the system
  // resolvers, so it falls back to 127.0.0.1 and every mongodb+srv:// lookup
  // dies with querySrv ECONNREFUSED even though the network is healthy.
  if (config.dnsServers.length > 0) {
    dns.setServers(config.dnsServers);
    logger.info({ dnsServers: config.dnsServers }, 'DNS resolvers overridden via DNS_SERVERS');
  }

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10_000,
  });
  logger.info({ db: mongoose.connection.name }, 'MongoDB connected');
  return mongoose.connection;
}

export async function disconnectDb() {
  await mongoose.disconnect();
}

export function isDbConnected() {
  return mongoose.connection.readyState === 1;
}

let transactionSupport = null;

/**
 * Batch push is wrapped in a transaction when the deployment can do it
 * (replica set / mongos). Standalone Mongo and mongodb-memory-server cannot,
 * so we probe once and fall back to per-change conditional writes.
 */
export async function supportsTransactions() {
  if (transactionSupport !== null) return transactionSupport;
  try {
    const info = await mongoose.connection.db.admin().command({ hello: 1 });
    transactionSupport = Boolean(info.setName) || info.msg === 'isdbgrid';
  } catch (err) {
    logger.warn({ err }, 'Could not probe transaction support; assuming standalone');
    transactionSupport = false;
  }
  logger.info({ transactions: transactionSupport }, 'Transaction capability resolved');
  return transactionSupport;
}

/** Test seam — lets the suite reset the memoised probe between connections. */
export function resetTransactionSupport() {
  transactionSupport = null;
}
