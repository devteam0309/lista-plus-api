import { asyncHandler } from '../utils/asyncHandler.js';
import {
  verifyGoogleIdToken,
  upsertUserFromGoogle,
  issueApiToken,
} from '../services/googleAuth.service.js';

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
