import { randomUUID } from 'node:crypto';
import { User } from '../../src/models/User.js';
import { issueApiToken } from '../../src/services/googleAuth.service.js';

let seq = 0;

export async function createUser({ premium = true, ...overrides } = {}) {
  seq += 1;
  const user = await User.create({
    googleSub: `google-sub-${seq}-${randomUUID()}`,
    email: `owner${seq}@example.com`,
    displayName: `Store Owner ${seq}`,
    premium,
    premiumSince: premium ? Date.now() : null,
    ...overrides,
  });
  return { user, token: issueApiToken(user) };
}

export const auth = (token) => ({ Authorization: `Bearer ${token}` });

/** A valid customer SyncChange; pass `payload: null` for a tombstone. */
export function customerChange(overrides = {}) {
  const { payload, ...rest } = overrides;
  const defaults = {
    fullName: 'Aling Nena',
    nickname: 'Nena',
    phone: '09171234567',
    address: 'Purok 3',
    creditLimit: 500,
    notes: null,
    isActive: true,
  };

  return {
    entityType: 'customer',
    globalId: randomUUID(),
    updatedAt: 1000,
    deleted: false,
    ...rest,
    payload: payload === null ? null : { ...defaults, ...payload },
  };
}
