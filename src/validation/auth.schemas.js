import { z } from 'zod';

export const googleAuthBodySchema = z.object({
  idToken: z.string().min(1, 'idToken is required'),
});
