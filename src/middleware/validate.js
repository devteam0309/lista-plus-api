/**
 * Replaces the raw request part with the Zod-parsed value, so controllers only
 * ever see validated, coerced, unknown-key-stripped data.
 */
export const validateBody = (schema) => (req, _res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) return next(result.error);
  req.body = result.data;
  next();
};

export const validateQuery = (schema) => (req, _res, next) => {
  const result = schema.safeParse(req.query);
  if (!result.success) return next(result.error);
  // Kept off req.query: Express 5 makes it getter-only, so this stays portable.
  req.validatedQuery = result.data;
  next();
};
