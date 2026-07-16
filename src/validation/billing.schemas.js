import { z } from 'zod';

export const verifyPurchaseBodySchema = z.object({
  productId: z.string().min(1),
  purchaseToken: z.string().min(1),
});
