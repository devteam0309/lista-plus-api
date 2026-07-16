import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';

const oauthClient = new OAuth2Client(config.googleClientId);

/**
 * Verifies the Google ID token the Android app obtained via Google Sign-In.
 * `audience` pins the token to our client ID — without it, a token minted for
 * any other app would be accepted.
 */
export async function verifyGoogleIdToken(idToken) {
  let ticket;
  try {
    ticket = await oauthClient.verifyIdToken({
      idToken,
      audience: config.googleClientId,
    });
  } catch (err) {
    logger.warn({ err: err.message }, 'Google ID token verification failed');
    throw ApiError.unauthorized('Invalid or expired Google ID token');
  }

  const payload = ticket.getPayload();
  if (!payload?.sub) throw ApiError.unauthorized('Google ID token has no subject');
  if (payload.email && payload.email_verified === false) {
    throw ApiError.unauthorized('Google account email is not verified');
  }

  return {
    googleSub: payload.sub,
    email: payload.email ?? null,
    displayName: payload.name ?? null,
  };
}

/** Upsert keyed on the Google subject — the only stable identifier (emails change). */
export async function upsertUserFromGoogle({ googleSub, email, displayName }) {
  const user = await User.findOneAndUpdate(
    { googleSub },
    {
      $set: { email, displayName },
      $setOnInsert: { googleSub, premium: false, premiumSince: null },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return user;
}

export function issueApiToken(user) {
  return jwt.sign({ userId: user._id.toString() }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

export function verifyApiToken(token) {
  try {
    // Pinned so a token can never downgrade the verification algorithm.
    return jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    throw ApiError.unauthorized('Invalid or expired token');
  }
}
