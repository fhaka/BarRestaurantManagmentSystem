import type { ErrorCode } from '@tavolina/shared';

/**
 * An error that maps directly to the API error envelope.
 * Throw these from services; the error handler turns them into responses.
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'AppError';
  }

  static badRequest(message: string, details?: Record<string, unknown>) {
    return new AppError(400, 'BAD_REQUEST', message, details);
  }
  static unauthenticated(message = 'Authentication required') {
    return new AppError(401, 'UNAUTHENTICATED', message);
  }
  static forbidden(message = 'You do not have permission to do this') {
    return new AppError(403, 'FORBIDDEN', message);
  }
  static notFound(message = 'Not found', details?: Record<string, unknown>) {
    return new AppError(404, 'NOT_FOUND', message, details);
  }
  static conflict(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    return new AppError(409, code, message, details);
  }
}
