import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { config } from '../config/env.js';
import { User } from '../models/User.js';
import { verifyPurchase, acknowledgePurchase } from '../services/playBilling.service.js';
import { logger } from '../utils/logger.js';

export const verify = asyncHandler(async (req, res) => {
  const { productId, purchaseToken } = req.body;

  // Only the configured premium SKU(s) may unlock Premium. Without this, any
  // purchased product in the package — a future consumable, a test SKU —
  // would grant the lifetime entitlement.
  if (!config.premiumProductIds.includes(productId)) {
    return res.status(400).json({
      error: { code: 'PURCHASE_INVALID', message: 'Not a recognised premium product' },
    });
  }

  // One purchase unlocks one account. Without this, a single token could be
  // passed around to unlock Premium for everyone.
  const boundToSomeoneElse = await User.exists({
    purchaseToken,
    _id: { $ne: req.userId },
  });
  if (boundToSomeoneElse) {
    throw new ApiError(409, 'PURCHASE_ALREADY_CLAIMED', 'This purchase is already linked to another account');
  }

  const result = await verifyPurchase({ productId, purchaseToken });

  if (!result.valid) {
    // Not an exception: a refunded or pending purchase is an expected answer.
    return res.status(400).json({
      error: { code: 'PURCHASE_INVALID', message: result.reason },
    });
  }

  if (!result.acknowledged) {
    const ok = await acknowledgePurchase({ productId, purchaseToken });
    if (!ok) {
      // Entitlement is still granted — Play retries are cheap, a locked-out
      // paying customer is not. Next verify call re-attempts the ack.
      logger.warn({ userId: String(req.userId) }, 'granting premium despite failed acknowledgement');
    }
  }

  const premiumSince = req.user.premiumSince ?? result.purchaseTimeMillis ?? Date.now();

  let user;
  try {
    user = await User.findByIdAndUpdate(
      req.userId,
      {
        $set: {
          premium: true,
          premiumSince,
          purchaseToken,
          purchaseProductId: productId,
          purchaseOrderId: result.orderId ?? null,
        },
      },
      { new: true }
    );
  } catch (err) {
    // Loser of a concurrent verify of the same token on another account —
    // the unique purchaseToken index fired after the exists() check passed.
    if (err?.code === 11000) {
      throw new ApiError(409, 'PURCHASE_ALREADY_CLAIMED', 'This purchase is already linked to another account');
    }
    throw err;
  }

  logger.info({ userId: String(req.userId), productId }, 'premium unlocked');

  res.json({ premium: user.premium, premiumSince: user.premiumSince });
});
