import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { z } from 'zod';
import { ApiRequestError, NetworkError } from './api';

/** Message keys our shared schemas use for custom checks. */
const FIELD_KEYS = new Set([
  'pin',
  'phone',
  'nipt',
  'passwordLength',
  'time',
  'date',
  'credentialsRequired',
  'timeRange',
  'dateRange',
  'minMax',
  'requiredMin',
  'maxOptions',
  'percentMax',
]);

type Issue = Pick<z.core.$ZodIssue, 'code' | 'message' | 'path'> & {
  minimum?: unknown;
  maximum?: unknown;
  format?: string;
};

function valueAt(source: unknown, path: readonly PropertyKey[]): unknown {
  let current = source;
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<PropertyKey, unknown>)[key];
  }
  return current;
}

function issueMessage(issue: Issue, t: TFunction<'errors'>, source?: unknown): string {
  // Rule-specific messages (e.g. "fill in both times") are the most helpful; use them first.
  if (FIELD_KEYS.has(issue.message)) return t(`fields.${issue.message}` as 'fields.pin');
  // Otherwise an empty field reads better as "required" than as "too short" or "invalid format".
  const value = source === undefined ? undefined : valueAt(source, issue.path);
  if (source !== undefined && (value === '' || value === undefined || value === null)) {
    return t('fields.required');
  }
  // NaN comes from number inputs holding text that is not a number.
  if (typeof value === 'number' && Number.isNaN(value)) return t('fields.invalid');
  switch (issue.code) {
    case 'too_small':
      return Number(issue.minimum) <= 1
        ? t('fields.required')
        : t('fields.tooShort', { min: Number(issue.minimum) });
    case 'too_big':
      return t('fields.tooLong', { max: Number(issue.maximum) });
    case 'invalid_format':
      return issue.format === 'email' ? t('fields.email') : t('fields.invalid');
    case 'invalid_value':
      return t('fields.choose');
    case 'invalid_type':
      return t('fields.required');
    default:
      return t('fields.invalid');
  }
}

/** Maps zod issues (client-side or from a VALIDATION_ERROR response) to { field: message }. */
export function issuesToFieldErrors(
  issues: readonly Issue[],
  t: TFunction<'errors'>,
  source?: unknown,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join('.') || '_form';
    // Form-level issues (empty path) describe the whole object, not an empty field.
    out[key] ??= issueMessage(issue, t, issue.path.length ? source : undefined);
  }
  return out;
}

export function useErrorMessages() {
  const { t } = useTranslation('errors');

  /** A sentence for a toast or banner. */
  const message = useCallback(
    (err: unknown): string => {
      if (err instanceof NetworkError) return t('NETWORK');
      if (err instanceof ApiRequestError) {
        if (err.code === 'PIN_LOCKED' && typeof err.details.lockedUntil === 'string') {
          const minutes = Math.max(
            1,
            Math.ceil((new Date(err.details.lockedUntil).getTime() - Date.now()) / 60_000),
          );
          return t('PIN_LOCKED_MINUTES', { count: minutes });
        }
        if (err.code === 'INVALID_PIN' && typeof err.details.attemptsLeft === 'number') {
          return t('INVALID_PIN_ATTEMPTS', { count: err.details.attemptsLeft });
        }
        return t(err.code as 'INTERNAL_ERROR', { defaultValue: t('INTERNAL_ERROR') });
      }
      return t('INTERNAL_ERROR');
    },
    [t],
  );

  /** Field errors from a server VALIDATION_ERROR or a conflict tied to one field. */
  const fieldErrors = useCallback(
    (err: unknown): Record<string, string> => {
      if (!(err instanceof ApiRequestError)) return {};
      if (err.code === 'VALIDATION_ERROR' && Array.isArray(err.details.issues)) {
        return issuesToFieldErrors(
          (err.details.issues as { path: string; message: string }[]).map((i) => ({
            code: 'custom',
            message: i.message,
            path: i.path.split('.'),
          })),
          t,
        );
      }
      if (typeof err.details.field === 'string') return { [err.details.field]: message(err) };
      return {};
    },
    [t, message],
  );

  const validate = useCallback(
    <S extends z.ZodType>(schema: S, value: unknown) => {
      const result = schema.safeParse(value);
      return result.success
        ? { ok: true as const, data: result.data as z.output<S> }
        : { ok: false as const, errors: issuesToFieldErrors(result.error.issues, t, value) };
    },
    [t],
  );

  return { message, fieldErrors, validate };
}
