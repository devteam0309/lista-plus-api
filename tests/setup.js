import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { jest } from '@jest/globals';
import { resetTransactionSupport } from '../src/config/db.js';
import { ENTITY_REGISTRY } from '../src/models/registry.js';
import { User } from '../src/models/User.js';

jest.setTimeout(60_000);

let mongo;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());

  // mongodb-memory-server is standalone, so supportsTransactions() resolves
  // false and the suite exercises the conditional-upsert path. That is the
  // path most self-hosted deployments will run, so it is the right default to
  // test; the transactional path is covered by running against a replica set.
  resetTransactionSupport();

  // Build indexes up front — the unique (userId, globalId) index is what makes
  // the last-write-wins upsert correct, so tests must not race index creation.
  await Promise.all([
    User.init(),
    ...Object.values(ENTITY_REGISTRY).map((entry) => entry.model.init()),
  ]);
});

afterEach(async () => {
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});
