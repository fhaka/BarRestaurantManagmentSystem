import { z } from 'zod';

export { API_BASE_PATH } from './constants.js';

/** Machine-readable error codes. Extend as modules are added. */
export const ERROR_CODES = [
  'BAD_REQUEST',
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'INTERNAL_ERROR',
  // Auth & access
  'INVALID_CREDENTIALS',
  'SESSION_EXPIRED',
  'INVALID_PIN',
  'PIN_LOCKED',
  'PIN_NOT_SET',
  'LOCATION_REQUIRED',
  'LOCATION_FORBIDDEN',
  'APPROVAL_INVALID',
  'ROLE_NOT_GRANTABLE',
  'CANNOT_CHANGE_SELF',
  // Staff
  'EMAIL_TAKEN',
  // Menu
  'INVALID_IMAGE',
  'CATEGORY_NOT_EMPTY',
  'INVALID_REFERENCE',
  'IMPORT_INVALID',
  // Floor & tables
  'AREA_NOT_EMPTY',
  'TABLE_OCCUPIED',
  'TABLE_OVERLAP',
  'NOT_YOUR_TABLE',
  'SESSION_STATE',
  'BALANCE_DUE',
  // Orders & KDS
  'ORDER_ITEM_ALREADY_SENT',
  'ORDER_ITEM_STATE',
  'ORDER_CLOSED',
  'ITEM_UNAVAILABLE',
  'MODIFIERS_INVALID',
  'COMBO_INVALID',
  'GUEST_ORDERING_DISABLED',
  'GUEST_BLOCKED',
  'TOO_MANY_ORDERS',
  'ITEM_NOT_AVAILABLE_NOW',
  // Idempotency
  'IDEMPOTENCY_KEY_REUSED',
  'IDEMPOTENCY_IN_PROGRESS',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number] | (string & {});

/** The single error envelope every API error uses. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).default({}),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/** Cursor pagination query used by every list endpoint. */
export const paginationQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
