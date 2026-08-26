import request from 'supertest';

import { createApp } from '../src/app.js';
import { User } from '../src/models/User.js';
import { ENTITY_REGISTRY, ENTITY_TYPES } from '../src/models/registry.js';
import { createUser, auth, customerChange } from './helpers/factory.js';

const app = createApp();

/** Seeds one document of every synced entity type for a user. */
async function seedAllEntities(userId, updatedAt = 1000) {
  for (const type of ENTITY_TYPES) {
    await ENTITY_REGISTRY[type].model.create({
      userId,
      globalId: `${type}-${userId}`,
      updatedAt,
      deleted: false,
    });
  }
}

async function countAllEntities(userId) {
  const counts = await Promise.all(
    ENTITY_TYPES.map((type) => ENTITY_REGISTRY[type].model.countDocuments({ userId }))
  );
  return counts.reduce((sum, n) => sum + n, 0);
}

describe('DELETE /api/v1/auth/me', () => {
  it('erases the user and every synced document they own', async () => {
    const { user, token } = await createUser();
    await seedAllEntities(user._id);
    expect(await countAllEntities(user._id)).toBe(ENTITY_TYPES.length);

    const res = await request(app).delete('/api/v1/auth/me').set(auth(token));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.total).toBe(ENTITY_TYPES.length);
    // Every registered type is reported, so a missed collection is visible.
    expect(Object.keys(res.body.deleted).sort()).toEqual([...ENTITY_TYPES].sort());

    expect(await User.findById(user._id)).toBeNull();
    expect(await countAllEntities(user._id)).toBe(0);
  });

  it('leaves another account untouched', async () => {
    const victim = await createUser();
    const bystander = await createUser();
    await seedAllEntities(victim.user._id);
    await seedAllEntities(bystander.user._id);

    await request(app).delete('/api/v1/auth/me').set(auth(victim.token)).expect(200);

    expect(await countAllEntities(bystander.user._id)).toBe(ENTITY_TYPES.length);
    expect(await User.findById(bystander.user._id)).not.toBeNull();
  });

  it('invalidates the deleted account’s own token on the next request', async () => {
    const { token } = await createUser();

    await request(app).delete('/api/v1/auth/me').set(auth(token)).expect(200);

    // Same token, still unexpired and correctly signed — rejected because the
    // account is gone. This is what signs other devices out.
    await request(app).get('/api/v1/auth/me').set(auth(token)).expect(401);
    await request(app).delete('/api/v1/auth/me').set(auth(token)).expect(401);
  });

  it('is available to a free account, not just Premium', async () => {
    const { user, token } = await createUser({ premium: false });

    await request(app).delete('/api/v1/auth/me').set(auth(token)).expect(200);

    expect(await User.findById(user._id)).toBeNull();
  });

  it('rejects an unauthenticated request', async () => {
    const { user } = await createUser();

    await request(app).delete('/api/v1/auth/me').expect(401);

    expect(await User.findById(user._id)).not.toBeNull();
  });

  it('removes data that arrived through the real sync push path', async () => {
    const { user, token } = await createUser();
    const change = customerChange();
    await request(app)
      .post('/api/v1/sync/push')
      .set(auth(token))
      .send({ changes: [change] })
      .expect(200);
    expect(await ENTITY_REGISTRY.customer.model.countDocuments({ userId: user._id })).toBe(1);

    await request(app).delete('/api/v1/auth/me').set(auth(token)).expect(200);

    expect(await ENTITY_REGISTRY.customer.model.countDocuments({ userId: user._id })).toBe(0);
  });
});
