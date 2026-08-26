import { asyncHandler } from '../utils/asyncHandler.js';
import {
  verifyGoogleIdToken,
  upsertUserFromGoogle,
  issueApiToken,
} from '../services/googleAuth.service.js';
import { deleteAccount } from '../services/account.service.js';

export const googleSignIn = asyncHandler(async (req, res) => {
  const profile = await verifyGoogleIdToken(req.body.idToken);
  const user = await upsertUserFromGoogle(profile);
  const token = issueApiToken(user);

  res.json({ token, user: user.toPublicJSON() });
});

export const me = asyncHandler(async (req, res) => {
  res.json({ user: req.user.toPublicJSON() });
});

/**
 * Tokens are stateless, so this is a no-op the client can call for symmetry —
 * it discards the JWT locally. If revocation is ever needed, add a denylist
 * collection keyed by jti and check it in requireAuth.
 */
export const logout = asyncHandler(async (_req, res) => {
  res.json({ success: true });
});

/**
 * Permanently deletes the account and everything synced to it.
 *
 * Play requires an in-app deletion path for any app with account creation.
 * Deliberately not Premium-gated: a free user still has an account (sign-in
 * creates one), and a lapsed Premium user must not be trapped.
 *
 * The caller's own JWT stays cryptographically valid until it expires, but
 * `requireAuth` rejects it on the next request because the User is gone, so
 * no denylist is needed.
 */
export const deleteMe = asyncHandler(async (req, res) => {
  const { deleted, total } = await deleteAccount(req.userId);
  res.json({ success: true, deleted, total });
});
