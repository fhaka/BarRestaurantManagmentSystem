import type { RequestHandler } from 'express';
import { db } from '../db/knex.js';
import { AppError } from '../lib/errors.js';
import { sha256 } from '../lib/crypto.js';
import { logger } from '../lib/logger.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const VALID_KEY = /^[A-Za-z0-9_-]{8,100}$/;

interface StoredKey {
  request_hash: string;
  status_code: number | null;
  response_body: unknown;
}

function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ER_DUP_ENTRY'
  );
}

/**
 * Makes mutating requests safe to replay (offline queue, double taps): the first response for an
 * Idempotency-Key is stored and returned again for repeats with the same body. Keys are scoped per
 * user. 5xx responses are not stored so the client can retry. Use after requireAuth.
 */
export const idempotency: RequestHandler = async (req, res, next) => {
  const key = req.get('idempotency-key');
  if (!key || !MUTATING.has(req.method) || !req.auth) return next();
  if (!VALID_KEY.test(key)) {
    throw AppError.badRequest('Idempotency-Key must be 8–100 letters, digits, "-" or "_".');
  }

  const scope = `user:${req.auth.userId}`;
  const requestHash = sha256(
    `${req.method} ${req.originalUrl}\n${req.get('x-location-id') ?? ''}\n${JSON.stringify(req.body ?? null)}`,
  );

  try {
    await db('idempotency_keys').insert({
      scope,
      idem_key: key,
      method: req.method,
      path: req.originalUrl.slice(0, 255),
      request_hash: requestHash,
    });
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
    const existing = await db('idempotency_keys')
      .where({ scope, idem_key: key })
      .first<StoredKey | undefined>('request_hash', 'status_code', 'response_body');
    if (!existing) throw err;
    if (existing.request_hash !== requestHash) {
      throw new AppError(
        422,
        'IDEMPOTENCY_KEY_REUSED',
        'This Idempotency-Key was already used for a different request.',
      );
    }
    if (existing.status_code === null) {
      throw AppError.conflict(
        'IDEMPOTENCY_IN_PROGRESS',
        'The original request is still being processed. Try again shortly.',
      );
    }
    const body =
      typeof existing.response_body === 'string'
        ? (JSON.parse(existing.response_body) as unknown)
        : existing.response_body;
    res.setHeader('Idempotent-Replayed', 'true');
    res.status(existing.status_code).json(body);
    return;
  }

  // Store the result before the response leaves, so an immediate retry is replayed, not rejected.
  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => {
    const where = db('idempotency_keys').where({ scope, idem_key: key });
    const store =
      res.statusCode >= 500
        ? where.delete()
        : where.update({
            status_code: res.statusCode,
            response_body: JSON.stringify(body ?? null),
          });
    store
      .catch((err: unknown) => logger.error({ err }, 'Failed to store idempotency result'))
      .finally(() => originalJson(body));
    return res;
  };

  next();
};
