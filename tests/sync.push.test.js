import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { config } from '../src/config/env.js';
import { Customer } from '../src/models/Customer.js';
import { MAX_UPDATED_AT_SKEW_MS } from '../src/services/sync.service.js';
import { createUser, auth, customerChange } from './helpers/factory.js';

const app = createApp();

const push = (token, changes) =>
  request(app).post('/api/v1/sync/push').set(auth(token)).send({ changes });

describe('POST /api/v1/sync/push — last-write-wins', () => {
  it('inserts a change the server has never seen', async () => {
    const { token, user } = await createUser();
    const change = customerChange({ updatedAt: 1000 });

    const res = await push(token, [change]);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ applied: 1, skipped: 0 });
    expect(typeof res.body.serverTime).toBe('number');

    const stored = await Customer.findOne({ userId: user._id, globalId: change.globalId });
    expect(stored.fullName).toBe('Aling Nena');
    expect(stored.updatedAt).toBe(1000);
  });

  it('newer wins: a change with a greater updatedAt overwrites the stored copy', async () => {
    const { token, user } = await createUser();
    const globalId = randomUUID();
    await push(token, [customerChange({ globalId, updatedAt: 1000 })]);

    const res = await push(token, [
      customerChange({ globalId, updatedAt: 2000, payload: { fullName: 'Nena Santos' } }),
    ]);

    expect(res.body).toMatchObject({ applied: 1, skipped: 0 });
    const stored = await Customer.findOne({ userId: user._id, globalId });
    expect(stored.fullName).toBe('Nena Santos');
    expect(stored.updatedAt).toBe(2000);
  });

  it('older loses: a change with a smaller updatedAt is skipped, leaving the stored copy intact', async () => {
    const { token, user } = await createUser();
    const globalId = randomUUID();
    await push(token, [customerChange({ globalId, updatedAt: 2000, payload: { fullName: 'Newer' } })]);

    const res = await push(token, [
      customerChange({ globalId, updatedAt: 1000, payload: { fullName: 'Older' } }),
    ]);

    expect(res.body).toMatchObject({ applied: 0, skipped: 1 });
    const stored = await Customer.findOne({ userId: user._id, globalId });
    expect(stored.fullName).toBe('Newer');
    expect(stored.updatedAt).toBe(2000);
  });

  it('an equal updatedAt is skipped (strictly-greater rule), making replays idempotent', async () => {
    const { token } = await createUser();
    const change = customerChange({ updatedAt: 1000 });

    const first = await push(token, [change]);
    const replay = await push(token, [change]);

    expect(first.body).toMatchObject({ applied: 1, skipped: 0 });
    expect(replay.body).toMatchObject({ applied: 0, skipped: 1 });
    expect(await Customer.countDocuments()).toBe(1);
  });

  it('applies a tombstone and keeps the row', async () => {
    const { token, user } = await createUser();
    const globalId = randomUUID();
    await push(token, [customerChange({ globalId, updatedAt: 1000 })]);

    const res = await push(token, [
      { entityType: 'customer', globalId, updatedAt: 2000, deleted: true, payload: null },
    ]);

    expect(res.body).toMatchObject({ applied: 1, skipped: 0 });
    const stored = await Customer.findOne({ userId: user._id, globalId });
    expect(stored.deleted).toBe(true);
    expect(stored.updatedAt).toBe(2000);
    // Row is retained so the delete stays auditable.
    expect(stored.fullName).toBe('Aling Nena');
  });

  it('a stale tombstone loses to a newer edit', async () => {
    const { token, user } = await createUser();
    const globalId = randomUUID();
    await push(token, [customerChange({ globalId, updatedAt: 3000, payload: { fullName: 'Alive' } })]);

    const res = await push(token, [
      { entityType: 'customer', globalId, updatedAt: 2000, deleted: true, payload: null },
    ]);

    expect(res.body).toMatchObject({ applied: 0, skipped: 1 });
    const stored = await Customer.findOne({ userId: user._id, globalId });
    expect(stored.deleted).toBe(false);
    expect(stored.fullName).toBe('Alive');
  });

  it('a tombstone for an unseen entity still lands (delete may arrive before insert)', async () => {
    const { token } = await createUser();
    const globalId = randomUUID();

    const res = await push(token, [
      { entityType: 'customer', globalId, updatedAt: 1000, deleted: true, payload: null },
    ]);

    expect(res.body).toMatchObject({ applied: 1, skipped: 0 });
    const stored = await Customer.findOne({ globalId });
    expect(stored.deleted).toBe(true);
  });

  it('resolves per-change within a mixed batch', async () => {
    const { token } = await createUser();
    const staleId = randomUUID();
    const freshId = randomUUID();
    await push(token, [customerChange({ globalId: staleId, updatedAt: 5000 })]);

    const res = await push(token, [
      customerChange({ globalId: staleId, updatedAt: 1000 }), // loses
      customerChange({ globalId: freshId, updatedAt: 1000 }), // wins (new)
    ]);

    expect(res.body).toMatchObject({ applied: 1, skipped: 1 });
  });

  it('accepts an empty batch', async () => {
    const { token } = await createUser();

    const res = await push(token, []);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ applied: 0, skipped: 0 });
  });
});

describe('POST /api/v1/sync/push — validation', () => {
  it('rejects the whole batch when one change is malformed, writing nothing', async () => {
    const { token } = await createUser();

    const res = await push(token, [
      customerChange({ updatedAt: 1000 }),
      { entityType: 'customer', globalId: randomUUID(), updatedAt: 2000, deleted: false, payload: null },
    ]);

    expect(res.status).toBe(400);
    expect(await Customer.countDocuments()).toBe(0);
  });

  it('rejects an unknown entityType', async () => {
    const { token } = await createUser();

    const res = await push(token, [
      { entityType: 'suki_points', globalId: randomUUID(), updatedAt: 1, deleted: false, payload: {} },
    ]);

    expect(res.status).toBe(400);
  });

  it('rejects a local Room int where a globalId UUID belongs', async () => {
    const { token } = await createUser();

    const res = await push(token, [
      {
        entityType: 'transaction',
        globalId: randomUUID(),
        updatedAt: 1000,
        deleted: false,
        payload: {
          customerGlobalId: '42', // the pre-migration client bug we want to catch loudly
          transactionDate: 1736899200000,
          totalAmount: 250,
          amountPaid: 0,
          status: 'unpaid',
          notes: null,
        },
      },
    ]);

    expect(res.status).toBe(400);
    expect(res.body.error.details.issues[0].path).toBe('customerGlobalId');
  });

  it('stores money without float drift', async () => {
    const { token, user } = await createUser();
    const globalId = randomUUID();

    await push(token, [customerChange({ globalId, payload: { creditLimit: 0.1 } })]);
    const stored = await Customer.findOne({ userId: user._id, globalId });

    expect(stored.creditLimit.toString()).toBe('0.1000');
  });

  it('rejects an absurd money value', async () => {
    const { token } = await createUser();

    const res = await push(token, [customerChange({ payload: { creditLimit: 1e15 } })]);

    expect(res.status).toBe(400);
    expect(await Customer.countDocuments()).toBe(0);
  });
});

describe('POST /api/v1/sync/push — abuse guards', () => {
  it('clamps a far-future updatedAt so the row can still be overwritten by honest edits', async () => {
    const { token, user } = await createUser();
    const globalId = randomUUID();
    const farFuture = Date.now() + 365 * 24 * 60 * 60 * 1000;

    const res = await push(token, [customerChange({ globalId, updatedAt: farFuture })]);
    expect(res.body).toMatchObject({ applied: 1, skipped: 0 });

    const stored = await Customer.findOne({ userId: user._id, globalId });
    expect(stored.updatedAt).toBeLessThanOrEqual(Date.now() + MAX_UPDATED_AT_SKEW_MS);

    // The point of the clamp: a later honest edit still wins.
    const honest = await push(token, [
      customerChange({ globalId, updatedAt: stored.updatedAt + 1, payload: { fullName: 'Recovered' } }),
    ]);
    expect(honest.body).toMatchObject({ applied: 1, skipped: 0 });
  });

  it('leaves an updatedAt within the skew allowance untouched', async () => {
    const { token, user } = await createUser();
    const globalId = randomUUID();
    const slightlyAhead = Date.now() + 60 * 60 * 1000; // 1h fast clock

    await push(token, [customerChange({ globalId, updatedAt: slightlyAhead })]);

    const stored = await Customer.findOne({ userId: user._id, globalId });
    expect(stored.updatedAt).toBe(slightlyAhead);
  });

  it('refuses a push once the account is at its document quota', async () => {
    const { token } = await createUser();
    const previous = config.syncMaxDocsPerUser;
    config.syncMaxDocsPerUser = 2;

    try {
      const ok = await push(token, [customerChange(), customerChange()]);
      expect(ok.body).toMatchObject({ applied: 2, skipped: 0 });

      const refused = await push(token, [customerChange()]);
      expect(refused.status).toBe(403);
      expect(refused.body.error.code).toBe('QUOTA_EXCEEDED');
      expect(await Customer.countDocuments()).toBe(2);
    } finally {
      config.syncMaxDocsPerUser = previous;
    }
  });

  it('quota is per user: one full account does not block another', async () => {
    const { token: fullToken } = await createUser();
    const { token: freshToken } = await createUser();
    const previous = config.syncMaxDocsPerUser;
    config.syncMaxDocsPerUser = 1;

    try {
      await push(fullToken, [customerChange()]);
      const refused = await push(fullToken, [customerChange()]);
      expect(refused.status).toBe(403);

      const fresh = await push(freshToken, [customerChange()]);
      expect(fresh.body).toMatchObject({ applied: 1, skipped: 0 });
    } finally {
      config.syncMaxDocsPerUser = previous;
    }
  });
});

describe('POST /api/v1/sync/push — access control', () => {
  it('requires authentication', async () => {
    const res = await request(app).post('/api/v1/sync/push').send({ changes: [] });

    expect(res.status).toBe(401);
  });

  it('refuses a free-tier account: cloud sync is Premium-only', async () => {
    const { token } = await createUser({ premium: false });

    const res = await push(token, [customerChange()]);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PREMIUM_REQUIRED');
    expect(await Customer.countDocuments()).toBe(0);
  });
});
