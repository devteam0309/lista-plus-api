export class ApiError extends Error {
  /**
   * @param {number} status HTTP status
   * @param {string} code   stable machine-readable code for the client
   * @param {string} message human-readable message
   * @param {object} [details]
   */
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message, details) {
    return new ApiError(400, 'BAD_REQUEST', message, details);
  }

  static unauthorized(message = 'Authentication required') {
    return new ApiError(401, 'UNAUTHORIZED', message);
  }

  static premiumRequired(message = 'Cloud sync requires Lista+ Premium') {
    return new ApiError(403, 'PREMIUM_REQUIRED', message);
  }

  static notFound(message = 'Not found') {
    return new ApiError(404, 'NOT_FOUND', message);
  }
}
