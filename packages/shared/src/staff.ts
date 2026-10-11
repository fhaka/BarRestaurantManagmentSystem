import { z } from 'zod';
import { langSchema, type Lang } from './i18n.js';
import { passwordSchema, pinSchema } from './auth.js';
import { ROLE_KEYS, type RoleKey } from './permissions.js';

const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[\d\s-]{6,20}$/, { message: 'phone' });

/** Empty strings from forms mean "not set". */
const emptyToNull = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? null : value;

export const staffCreateSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.preprocess(emptyToNull, z.email().trim().toLowerCase().nullish()),
  phone: z.preprocess(emptyToNull, phoneSchema.nullish()),
  roleKey: z.enum(ROLE_KEYS),
  lang: langSchema.default('sq'),
  /** Needed only for staff who sign devices in with email + password. */
  password: z.preprocess(emptyToNull, passwordSchema.nullish()),
  pin: z.preprocess(emptyToNull, pinSchema.nullish()),
});
export type StaffCreateInput = z.input<typeof staffCreateSchema>;

export const staffUpdateSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  email: z.preprocess(emptyToNull, z.email().trim().toLowerCase().nullish()),
  phone: z.preprocess(emptyToNull, phoneSchema.nullish()),
  roleKey: z.enum(ROLE_KEYS).optional(),
  lang: langSchema.optional(),
  active: z.boolean().optional(),
});
export type StaffUpdateInput = z.input<typeof staffUpdateSchema>;

export const staffCredentialsSchema = z
  .object({
    password: z.preprocess(emptyToNull, passwordSchema.nullish()),
    pin: z.preprocess(emptyToNull, pinSchema.nullish()),
  })
  .refine((v) => v.password != null || v.pin != null, { message: 'credentialsRequired' });
export type StaffCredentialsInput = z.input<typeof staffCredentialsSchema>;

export interface StaffMember {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  roleKey: RoleKey;
  lang: Lang;
  active: boolean;
  hasPassword: boolean;
  hasPin: boolean;
  pinLocked: boolean;
  lastLoginAt: string | null;
}
