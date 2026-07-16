import { jest } from '@jest/globals';
import request from 'supertest';

const verifyIdToken = jest.fn();

// Must be registered before app.js (and its import of googleAuth.service) loads.
jest.unstable_mockModule('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({ verifyIdToken })),
}));

const { createApp } = await import('../src/app.js');
const { User } = await import('../src/models/User.js');

const app = createApp();

const googlePayload = (overrides = {}) => ({
  sub: 'google-sub-123',
  email: 'nena@example.com',
  email_verified: true,
  name: 'Aling Nena',
  ...overrides,
});

const mockValidToken = (overrides) =>
  verifyIdToken.mockResolvedValue({ getPayload: () => googlePayload(overrides) });

describe('POST /api/v1/auth/google', () => {
  it('exchanges a valid Google ID token for an API token and creates the user', async () => {
    mockValidToken();

    const res = await request(app).post('/api/v1/auth/google').send({ idToken: 'valid-id-token' });

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.user).toMatchObject({
      email: 'nena@example.com',
      displayName: 'Aling Nena',
      premium: false,
      premiumSince: null,
    });
    expect(res.body.user.id).toBeDefined();

    // The token is pinned to our client ID, not just parsed.
    expect(verifyIdToken).toHaveBeenCalledWith(
      expect.objectContaining({ idToken: 'valid-id-token', audience: expect.any(String) })
    );

    const stored = await User.findOne({ googleSub: 'google-sub-123' });
    expect(stored).not.toBeNull();
  });

  it('is idempotent: signing in twice reuses the same user', async () => {
    mockValidToken();

    const first = await request(app).post('/api/v1/auth/google').send({ idToken: 't1' });
    const second = await request(app).post('/api/v1/auth/google').send({ idToken: 't2' });

    expect(second.body.user.id).toBe(first.body.user.id);
    expect(await User.countDocuments()).toBe(1);
  });

  it('updates the profile when Google reports a new name', async () => {
    mockValidToken();
    await request(app).post('/api/v1/auth/google').send({ idToken: 't1' });

    mockValidToken({ name: 'Nena Santos' });
    const res = await request(app).post('/api/v1/auth/google').send({ idToken: 't2' });

    expect(res.body.user.displayName).toBe('Nena Santos');
  });

  it('preserves premium across re-authentication', async () => {
    mockValidToken();
    const first = await request(app).post('/api/v1/auth/google').send({ idToken: 't1' });
    await User.findByIdAndUpdate(first.body.user.id, { premium: true, premiumSince: 42 });

    const second = await request(app).post('/api/v1/auth/google').send({ idToken: 't2' });

    expect(second.body.user).toMatchObject({ premium: true, premiumSince: 42 });
  });

  it('rejects an invalid or expired Google ID token', async () => {
    verifyIdToken.mockRejectedValue(new Error('Token used too late'));

    const res = await request(app).post('/api/v1/auth/google').send({ idToken: 'expired' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(await User.countDocuments()).toBe(0);
  });

  it('rejects a token whose email is unverified', async () => {
    mockValidToken({ email_verified: false });

    const res = await request(app).post('/api/v1/auth/google').send({ idToken: 'unverified' });

    expect(res.status).toBe(401);
  });

  it('rejects a missing idToken with 400', async () => {
    const res = await request(app).post('/api/v1/auth/google').send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('Bearer auth', () => {
  it('accepts the issued token on a protected route', async () => {
    mockValidToken();
    const signIn = await request(app).post('/api/v1/auth/google').send({ idToken: 'valid' });

    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${signIn.body.token}`);

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(signIn.body.user.id);
  });

  it.each([
    ['no header', undefined],
    ['garbage token', 'Bearer not-a-jwt'],
    ['wrong scheme', 'Basic abc123'],
  ])('rejects %s with 401', async (_label, header) => {
    const req = request(app).get('/api/v1/auth/me');
    if (header) req.set('Authorization', header);

    const res = await req;

    expect(res.status).toBe(401);
  });

  it('rejects a valid token whose account has been deleted', async () => {
    mockValidToken();
    const signIn = await request(app).post('/api/v1/auth/google').send({ idToken: 'valid' });
    await User.findByIdAndDelete(signIn.body.user.id);

    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${signIn.body.token}`);

    expect(res.status).toBe(401);
  });
});
