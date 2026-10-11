import { PIN_LOCK_MINUTES, PIN_MAX_ATTEMPTS } from '@tavolina/shared';
import { AppError } from '../../lib/errors.js';
import { verifySecret } from '../../lib/crypto.js';
import * as repo from './repo.js';
import type { UserRow } from './repo.js';

/**
 * Checks a user's PIN with lockout: after PIN_MAX_ATTEMPTS wrong tries the PIN is locked for
 * PIN_LOCK_MINUTES. Used by PIN switch and by manager approvals, so both share one counter.
 */
export async function verifyUserPin(user: UserRow, pin: string): Promise<void> {
  if (!user.pin_hash) {
    throw AppError.conflict('PIN_NOT_SET', 'This person has no PIN yet. A manager can set one.');
  }

  const lockedUntil = user.pin_locked_until;
  if (lockedUntil && lockedUntil.getTime() > Date.now()) {
    throw new AppError(423, 'PIN_LOCKED', 'Too many wrong PINs. Try again later.', {
      lockedUntil: lockedUntil.toISOString(),
    });
  }

  if (await verifySecret(pin, user.pin_hash)) {
    if (user.pin_failed_attempts > 0 || lockedUntil) await repo.resetPinFailures(user.id);
    return;
  }

  const failures = await repo.incrementPinFailures(user.id);
  if (failures >= PIN_MAX_ATTEMPTS) {
    const until = new Date(Date.now() + PIN_LOCK_MINUTES * 60_000);
    await repo.lockPin(user.id, until);
    throw new AppError(423, 'PIN_LOCKED', 'Too many wrong PINs. Try again later.', {
      lockedUntil: until.toISOString(),
    });
  }
  throw new AppError(401, 'INVALID_PIN', 'Wrong PIN.', {
    attemptsLeft: PIN_MAX_ATTEMPTS - failures,
  });
}
