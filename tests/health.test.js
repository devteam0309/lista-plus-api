import request from 'supertest';
import { createApp } from '../src/app.js';

const app = createApp();

describe('GET /api/v1/health', () => {
  it('reports db connectivity and server time', async () => {
    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', dbConnected: true });
    expect(typeof res.body.serverTime).toBe('number');
  });

  it('reports which Play service account is configured', async () => {
    const res = await request(app).get('/api/v1/health');

    // The suite runs without GOOGLE_PLAY_SA_KEY, so billing reads as absent —
    // which is itself the signal a deployment missing the key would show.
    expect(res.body.billing).toBeDefined();
    expect(typeof res.body.billing.configured).toBe('boolean');
  });

  it('never exposes any part of the credential', async () => {
    const body = JSON.stringify((await request(app).get('/api/v1/health')).body);

    // Identity only. A leak here would be public and unauthenticated.
    expect(body).not.toMatch(/PRIVATE KEY/i);
    expect(body).not.toMatch(/private_key/i);
    expect(body).not.toMatch(/\.iam\.gserviceaccount\.com/);
  });
});

describe('unknown routes', () => {
  it('404s with the standard error envelope', async () => {
    const res = await request(app).get('/api/v1/nope');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
