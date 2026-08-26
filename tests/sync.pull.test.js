import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { config } from '../src/config/env.js';
import { createUser, auth, customerChange } from './helpers/factory.js';

const app = createApp();

const push = (token, changes) =>
  request(app).post('/api/v1/sync/push').set(auth(token)).send({ changes });
const pull = (token, since) =>
  request(app).get(`/api/v1/sync/pull${since === undefined ? '' : `?since=${since}`}`).set(auth(token));

describe('GET /api/v1/sync/pull — since filtering', () => {
  it('since=0 returns everything (full sync)', async () => {
    const { token } = await createUser();
    await push(token, [
      customerChange({ updatedAt: 1000 }),
      customerChange({ updatedAt: 2000 }),
      customerChange({ updatedAt: 3000 }),
    ]);

    const res = await pull(token, 0);

    expect(res.status).toBe(200);
    expect(res.body.changes).toHaveLength(3);
    expect(typeof res.body.serverTime).toBe('number');
  });

  it('defaults to a full sync when since is omitted', async () => {
    const { token } = await createUser();
    await push(token, [customerChange({ updatedAt: 1000 })]);

    const res = await pull(token);

    expect(res.body.changes).toHaveLength(1);
  });

  it('returns only changes strictly newer than since', async () => {
    const { token } = await createUser();
    await push(token, [
      customerChange({ updatedAt: 1000 }),
      customerChange({ updatedAt: 2000 }),
      customerChange({ updatedAt: 3000 }),
    ]);

    const res = await pull(token, 2000);

    expect(res.body.changes.map((c) => c.updatedAt)).toEqual([3000]);
  });

  it('returns nothing when the client is already up to date', async () => {
    const { token } = await createUser();
    await push(token, [customerChange({ updatedAt: 1000 })]);

    const res = await pull(token, 5000);

    expect(res.body.changes).toEqual([]);
  });

  it('orders changes by updatedAt ascending across entity types', async () => {
    const { token } = await createUser();
    const customerId = randomUUID();
    await push(token, [
      customerChange({ globalId: customerId, updatedAt: 3000 }),
      {
        entityType: 'product',
        globalId: randomUUID(),
        updatedAt: 1000,
        deleted: false,
        payload: { name: 'Kopiko', category: 'Coffee', unit: 'sachet', price: 12, isActive: true },
      },
      {
        entityType: 'payment',
        globalId: randomUUID(),
        updatedAt: 2000,
        deleted: false,
        payload: { customerGlobalId: customerId, amount: 100, paymentDate: 1736899200000, notes: null },
      },
    ]);

    const res = await pull(token, 0);

    expect(res.body.changes.map((c) => c.updatedAt)).toEqual([1000, 2000, 3000]);
    expect(res.body.changes.map((c) => c.entityType)).toEqual(['product', 'payment', 'customer']);
  });

  it('round-trips a payload through push and pull unchanged', async () => {
    const { token } = await createUser();
    const change = customerChange({ updatedAt: 1000 });

    await push(token, [change]);
    const res = await pull(token, 0);

    expect(res.body.changes[0]).toEqual({
      entityType: 'customer',
      globalId: change.globalId,
      updatedAt: 1000,
      deleted: false,
      payload: change.payload,
    });
  });

  it('includes tombstones with a null payload so deletes propagate', async () => {
    const { token } = await createUser();
    const globalId = randomUUID();
    await push(token, [customerChange({ globalId, updatedAt: 1000 })]);
    await push(token, [{ entityType: 'customer', globalId, updatedAt: 2000, deleted: true, payload: null }]);

    const res = await pull(token, 1500);

    expect(res.body.changes).toHaveLength(1);
    expect(res.body.changes[0]).toMatchObject({ globalId, deleted: true, payload: null });
  });

  it('rejects a malformed since', async () => {
    const { token } = await createUser();

    const res = await pull(token, 'yesterday');

    expect(res.status).toBe(400);
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/v1/sync/pull?since=0');

    expect(res.status).toBe(401);
  });

  it('refuses a free-tier account', async () => {
    const { token } = await createUser({ premium: false });

    const res = await pull(token, 0);

    expect(res.status).toBe(403);
  });
});

describe('GET /api/v1/sync/pull — pagination', () => {
  const pullPage = (token, since, cursor) =>
    request(app)
      .get(`/api/v1/sync/pull?since=${since}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
      .set(auth(token));

  /** Follows nextCursor until hasMore is false; returns every page. */
  async function pullAllPages(token, since) {
    const pages = [];
    let cursor;
    do {
      const res = await pullPage(token, since, cursor);
      expect(res.status).toBe(200);
      pages.push(res.body);
      cursor = res.body.nextCursor;
    } while (pages[pages.length - 1].hasMore);
    return pages;
  }

  const originalLimit = config.syncPullMaxChanges;
  afterEach(() => {
    config.syncPullMaxChanges = originalLimit;
  });

  it('reports hasMore: false and no cursor when everything fits in one page', async () => {
    const { token } = await createUser();
    await push(token, [customerChange({ updatedAt: 1000 })]);

    const res = await pull(token, 0);

    expect(res.body.hasMore).toBe(false);
    expect(res.body.nextCursor).toBeUndefined();
  });

  it('caps a page and walks the cursor to deliver everything exactly once', async () => {
    config.syncPullMaxChanges = 2;
    const { token } = await createUser();
    const pushed = [1000, 2000, 3000, 4000, 5000].map((updatedAt) => customerChange({ updatedAt }));
    await push(token, pushed);

    const pages = await pullAllPages(token, 0);

    expect(pages.map((p) => p.changes.length)).toEqual([2, 2, 1]);
    expect(pages.map((p) => p.hasMore)).toEqual([true, true, false]);
    const delivered = pages.flatMap((p) => p.changes.map((c) => c.globalId));
    expect(new Set(delivered).size).toBe(5);
    expect(new Set(delivered)).toEqual(new Set(pushed.map((c) => c.globalId)));
  });

  it('paginates through updatedAt ties across entity types without loss or duplication', async () => {
    config.syncPullMaxChanges = 1;
    const { token } = await createUser();
    const customerId = randomUUID();
    // Everything shares one updatedAt — the shape a bulk Room migration produces.
    const pushed = [
      customerChange({ globalId: customerId, updatedAt: 1000 }),
      customerChange({ updatedAt: 1000 }),
      {
        entityType: 'product',
        globalId: randomUUID(),
        updatedAt: 1000,
        deleted: false,
        payload: { name: 'Kopiko', category: 'Coffee', unit: 'sachet', price: 12, isActive: true },
      },
      {
        entityType: 'payment',
        globalId: randomUUID(),
        updatedAt: 1000,
        deleted: false,
        payload: { customerGlobalId: customerId, amount: 100, paymentDate: 1736899200000, notes: null },
      },
    ];
    await push(token, pushed);

    const pages = await pullAllPages(token, 0);

    const delivered = pages.flatMap((p) => p.changes.map((c) => `${c.entityType}:${c.globalId}`));
    expect(delivered).toHaveLength(4);
    expect(new Set(delivered)).toEqual(new Set(pushed.map((c) => `${c.entityType}:${c.globalId}`)));
  });

  it('keeps serverTime constant across the pages of one paging cycle', async () => {
    config.syncPullMaxChanges = 1;
    const { token } = await createUser();
    await push(token, [customerChange({ updatedAt: 1000 }), customerChange({ updatedAt: 2000 })]);

    const pages = await pullAllPages(token, 0);

    expect(pages.length).toBeGreaterThan(1);
    expect(new Set(pages.map((p) => p.serverTime)).size).toBe(1);
  });

  it('still respects since while paginating', async () => {
    config.syncPullMaxChanges = 1;
    const { token } = await createUser();
    await push(token, [
      customerChange({ updatedAt: 1000 }),
      customerChange({ updatedAt: 2000 }),
      customerChange({ updatedAt: 3000 }),
    ]);

    const pages = await pullAllPages(token, 1500);

    const delivered = pages.flatMap((p) => p.changes.map((c) => c.updatedAt));
    expect(delivered).toEqual([2000, 3000]);
  });

  it('rejects a malformed cursor', async () => {
    const { token } = await createUser();

    const res = await pullPage(token, 0, 'not-a-cursor');

    expect(res.status).toBe(400);
  });

  it('rejects a cursor naming an unknown entity type', async () => {
    const { token } = await createUser();

    const res = await pullPage(token, 0, `1000:1000:not_an_entity:${randomUUID()}`);

    expect(res.status).toBe(400);
  });
});

describe('per-user isolation', () => {
  it('never returns another store owner’s changes', async () => {
    const nena = await createUser();
    const mang = await createUser();
    await push(nena.token, [customerChange({ updatedAt: 1000, payload: { fullName: 'Nena customer' } })]);

    const res = await pull(mang.token, 0);

    expect(res.body.changes).toEqual([]);
  });

  it('keeps the same globalId separate per user rather than colliding', async () => {
    const nena = await createUser();
    const mang = await createUser();
    const globalId = randomUUID(); // same id, two stores

    const a = await push(nena.token, [
      customerChange({ globalId, updatedAt: 2000, payload: { fullName: 'Nena customer' } }),
    ]);
    // Lower updatedAt: if the docs shared a row this would be skipped as stale.
    const b = await push(mang.token, [
      customerChange({ globalId, updatedAt: 1000, payload: { fullName: 'Mang customer' } }),
    ]);

    expect(a.body).toMatchObject({ applied: 1, skipped: 0 });
    expect(b.body).toMatchObject({ applied: 1, skipped: 0 });

    const nenaPull = await pull(nena.token, 0);
    const mangPull = await pull(mang.token, 0);
    expect(nenaPull.body.changes[0].payload.fullName).toBe('Nena customer');
    expect(mangPull.body.changes[0].payload.fullName).toBe('Mang customer');
  });

  it('cannot be tricked by a client-supplied userId in the payload', async () => {
    const nena = await createUser();
    const mang = await createUser();

    await request(app)
      .post('/api/v1/sync/push')
      .set(auth(nena.token))
      .send({
        changes: [{ ...customerChange({ updatedAt: 1000 }), userId: mang.user._id.toString() }],
      });

    expect((await pull(mang.token, 0)).body.changes).toEqual([]);
    expect((await pull(nena.token, 0)).body.changes).toHaveLength(1);
  });
});
