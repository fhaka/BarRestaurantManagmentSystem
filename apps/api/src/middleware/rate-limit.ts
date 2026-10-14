import { rateLimit, type Options } from 'express-rate-limit';
import type { ApiError } from '@tavolina/shared';
import { isTest } from '../config/env.js';

function limiter(limit: number, windowMs: number) {
  const handler: Options['handler'] = (_req, res) => {
    const body: ApiError = {
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests. Wait a moment and try again.',
        details: {},
      },
    };
    res.status(429).json(body);
  };
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    // Rate limits are tested separately; functional suites would trip them otherwise.
    skip: () => isTest,
    handler,
  });
}

/** Whole API: generous, protects against runaway clients. */
export const apiLimiter = limiter(600, 60_000);

/** Sign-in and PIN endpoints: strict per IP (PINs also lock per user). */
export const authLimiter = limiter(20, 60_000);

/** Public guest endpoints (QR menu): per IP, generous enough for a full table of phones. */
export const guestLimiter = limiter(120, 60_000);

/** Public online booking: a handful of bookings per IP, so nobody can fill the book. */
export const bookingLimiter = limiter(10, 10 * 60_000);
