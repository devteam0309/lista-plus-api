import { jest } from '@jest/globals';
import request from 'supertest';

const productsGet = jest.fn();
const productsAcknowledge = jest.fn();

jest.unstable_mockModule('googleapis', () => ({
  google: {
    auth: { GoogleAuth: jest.fn().mockImplementation(() => ({})) },
    androidpublisher: jest.fn(() => ({
      purchases: { products: { get: productsGet, acknowledge: productsAcknowledge } },
    })),
  },
}));

const { createApp } = await import('../src/app.js');
const { User } = await import('../src/models/User.js');
const { createUser, auth } = await import('./helpers/factory.js');

const app = createApp();

const PRODUCT_ID = 'listaplus_premium_lifetime';
const body = { productId: PRODUCT_ID, purchaseToken: 'purchase-token-abc' };

const verify = (token, payload = body) =>
  request(app).post('/api/v1/billing/verify').set(auth(token)).send(payload);

const playResponse = (overrides = {}) => ({
  data: {
    purchaseState: 0,
    consumptionState: 0,
    acknowledgementState: 1,
    orderId: 'GPA.1234-5678',
    purchaseTimeMillis: '1736899200000',
    ...overrides,
  },
});

describe('POST /api/v1/billing/verify', () => {
  it('unlocks premium for a valid purchase', async () => {
    const { token, user } = await createUser({ premium: false });
    productsGet.mockResolvedValue(playResponse());

    const res = await verify(token);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ premium: true, premiumSince: 1736899200000 });
    expect(productsGet).toHaveBeenCalledWith({
      packageName: 'com.jorres.listaplus',
      productId: PRODUCT_ID,
      token: 'purchase-token-abc',
    });

    const stored = await User.findById(user._id);
    expect(stored.premium).toBe(true);
    expect(stored.purchaseOrderId).toBe('GPA.1234-5678');
  });

  it('acknowledges an unacknowledged purchase so Play does not auto-refund it', async () => {
    const { token } = await createUser({ premium: false });
    productsGet.mockResolvedValue(playResponse({ acknowledgementState: 0 }));
    productsAcknowledge.mockResolvedValue({});

    const res = await verify(token);

    expect(res.status).toBe(200);
    expect(productsAcknowledge).toHaveBeenCalledWith(
      expect.objectContaining({ productId: PRODUCT_ID, token: 'purchase-token-abc' })
    );
  });

  it('still grants premium when acknowledgement fails', async () => {
    const { token } = await createUser({ premium: false });
    productsGet.mockResolvedValue(playResponse({ acknowledgementState: 0 }));
    productsAcknowledge.mockRejectedValue(new Error('Play is down'));

    const res = await verify(token);

    expect(res.status).toBe(200);
    expect(res.body.premium).toBe(true);
  });

  it('unlocks sync: a free account can push right after verifying', async () => {
    const { token } = await createUser({ premium: false });
    productsGet.mockResolvedValue(playResponse());

    const blocked = await request(app).post('/api/v1/sync/push').set(auth(token)).send({ changes: [] });
    expect(blocked.status).toBe(403);

    await verify(token);

    const allowed = await request(app).post('/api/v1/sync/push').set(auth(token)).send({ changes: [] });
    expect(allowed.status).toBe(200);
  });

  it.each([
    ['refunded', { purchaseState: 1 }],
    ['pending', { purchaseState: 2 }],
    ['consumed', { consumptionState: 1 }],
  ])('refuses a %s purchase without granting premium', async (_label, overrides) => {
    const { token, user } = await createUser({ premium: false });
    productsGet.mockResolvedValue(playResponse(overrides));

    const res = await verify(token);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PURCHASE_INVALID');
    expect((await User.findById(user._id)).premium).toBe(false);
  });

  it('handles a token Play does not recognise', async () => {
    const { token } = await createUser({ premium: false });
    const err = new Error('Not Found');
    err.response = { status: 404 };
    productsGet.mockRejectedValue(err);

    const res = await verify(token);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PURCHASE_INVALID');
  });

  it('reports a Play outage as 502 rather than crashing', async () => {
    const { token } = await createUser({ premium: false });
    const err = new Error('Internal Error');
    err.response = { status: 500 };
    productsGet.mockRejectedValue(err);

    const res = await verify(token);

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('BILLING_UPSTREAM_ERROR');
  });

  it('refuses a purchase token already claimed by another account', async () => {
    const first = await createUser({ premium: false });
    const second = await createUser({ premium: false });
    productsGet.mockResolvedValue(playResponse());
    await verify(first.token);

    const res = await verify(second.token);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PURCHASE_ALREADY_CLAIMED');
    expect((await User.findById(second.user._id)).premium).toBe(false);
  });

  it('is idempotent for the same account and keeps the original premiumSince', async () => {
    const { token } = await createUser({ premium: false });
    productsGet.mockResolvedValue(playResponse());

    const first = await verify(token);
    const second = await verify(token);

    expect(second.status).toBe(200);
    expect(second.body.premiumSince).toBe(first.body.premiumSince);
  });

  it('requires authentication', async () => {
    const res = await request(app).post('/api/v1/billing/verify').send(body);

    expect(res.status).toBe(401);
  });

  it('rejects a missing purchaseToken', async () => {
    const { token } = await createUser({ premium: false });

    const res = await verify(token, { productId: PRODUCT_ID });

    expect(res.status).toBe(400);
  });
});
