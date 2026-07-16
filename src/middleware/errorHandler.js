import { ZodError } from 'zod';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/env.js';

export function notFoundHandler(req, _res, next) {
  next(ApiError.notFound(`No route for ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity.
export function errorHandler(err, req, res, _next) {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong';
  let details;

  if (err instanceof ApiError) {
    ({ status, code, message, details } = err);
  } else if (err instanceof ZodError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Request validation failed';
    details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  } else if (err?.name === 'CastError') {
    status = 400;
    code = 'BAD_REQUEST';
    message = 'Malformed identifier';
  } else if (err?.code === 11000) {
    status = 409;
    code = 'CONFLICT';
    message = 'Duplicate key';
  } else if (err?.type === 'entity.parse.failed') {
    status = 400;
    code = 'BAD_REQUEST';
    message = 'Malformed JSON body';
  } else if (err?.type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'Request body is too large';
  }

  const log = status >= 500 ? logger.error.bind(logger) : logger.warn.bind(logger);
  log({ err: err.message, stack: status >= 500 ? err.stack : undefined, reqId: req.id, status, code }, 'request failed');

  res.status(status).json({
    error: {
      code,
      message,
      ...(details ? { details } : {}),
      // Never leak internals in prod; keep them locally for debugging.
      ...(status >= 500 && !config.isProd ? { stack: err.stack } : {}),
    },
  });
}
