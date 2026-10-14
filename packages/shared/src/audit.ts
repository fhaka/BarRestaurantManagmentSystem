import { z } from 'zod';

/** Plan §5.14: filters for the audit log viewer; newest first, paged by id. */
export const auditQuerySchema = z
  .object({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    /** An action key or a prefix ending in "." (e.g. "order_item." for all item events). */
    action: z.string().trim().max(80).optional(),
    userId: z.coerce.number().int().positive().optional(),
    entityType: z.string().trim().max(50).optional(),
    entityId: z.string().trim().max(64).optional(),
    /** Only rows a manager approved (voids, discounts, refunds…). */
    approved: z.enum(['true', 'false']).optional(),
    /** Rows older than this id (the previous page's `nextCursor`). */
    before: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: 'dateRange', path: ['to'] });

export interface AuditLogEntry {
  id: number;
  at: string;
  action: string;
  entityType: string;
  entityId: string | null;
  userId: number | null;
  userName: string | null;
  approvedById: number | null;
  approvedByName: string | null;
  deviceName: string | null;
  ip: string | null;
  requestId: string | null;
  before: unknown;
  after: unknown;
}

export interface AuditLogPage {
  rows: AuditLogEntry[];
  /** Pass as `before` for the next (older) page; null at the end. */
  nextCursor: number | null;
}
