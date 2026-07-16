import { User } from '../models/User.js';
import { verifyApiToken } from '../services/googleAuth.service.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/**
 * Resolves `req.userId` / `req.user` from the Bearer token.
 * Every downstream query scopes on req.userId — a client-supplied userId is
 * never trusted anywhere in this codebase.
 */
export const requireAuth = asyncHandler(async (req, _res, next) => {
  const header = req.get('authorization') ?? '';
  const [scheme, token] = header.split(' ');

  if (!token || scheme.toLowerCase() !== 'bearer') {
    throw ApiError.unauthorized('Missing Bearer token');
  }

  const claims = verifyApiToken(token);
  const user = await User.findById(claims.userId);
  // Covers a deleted account still holding a signed, unexpired token.
  if (!user) throw ApiError.unauthorized('Account no longer exists');

  req.userId = user._id;
  req.user = user;
  next();
});

/** Cloud sync is a Premium-only feature; the free tier stays fully offline. */
export const requirePremium = (req, _res, next) => {
  if (!req.user?.premium) return next(ApiError.premiumRequired());
  next();
};
