import { z } from 'zod';
import { langSchema, type Lang } from './i18n.js';
import {
  APPROVAL_ACTIONS,
  type ApprovalAction,
  type Permission,
  type RoleKey,
} from './permissions.js';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_DAYS = 14;
export const PIN_MAX_ATTEMPTS = 5;
export const PIN_LOCK_MINUTES = 5;
export const APPROVAL_TTL_SECONDS = 60;

export const pinSchema = z.string().regex(/^\d{4}$/, { message: 'pin' });
export const passwordSchema = z.string().min(8, { message: 'passwordLength' }).max(128);

export const DEVICE_TYPES = ['pos', 'waiter', 'kds', 'print_bridge'] as const;
export type DeviceType = (typeof DEVICE_TYPES)[number];

export const deviceInfoSchema = z.object({
  /** Generated once per browser and kept in localStorage. */
  uuid: z.uuid(),
  name: z.string().trim().min(1).max(100).default('Browser'),
  type: z.enum(DEVICE_TYPES).default('pos'),
});

export const loginRequestSchema = z.object({
  email: z.email().trim().toLowerCase(),
  password: z.string().min(1).max(128),
  device: deviceInfoSchema.optional(),
});
export type LoginRequest = z.input<typeof loginRequestSchema>;

/** Quick staff switch on a device that already has a session. */
export const pinLoginRequestSchema = z.object({
  userId: z.number().int().positive(),
  pin: pinSchema,
  locationId: z.number().int().positive(),
});
export type PinLoginRequest = z.infer<typeof pinLoginRequestSchema>;

/** Manager PIN → single-use approval token for one action on one entity. */
export const approvalRequestSchema = z.object({
  approverId: z.number().int().positive(),
  pin: pinSchema,
  action: z.enum(APPROVAL_ACTIONS),
  entityType: z.string().min(1).max(50),
  entityId: z.union([z.string().min(1).max(64), z.number().int()]).transform(String),
});
export type ApprovalRequest = z.input<typeof approvalRequestSchema>;

export interface ApprovalResponse {
  approvalToken: string;
  expiresAt: string;
  approverId: number;
  action: ApprovalAction;
}

export interface LocationAccess {
  id: number;
  name: string;
  roleKey: RoleKey;
}

export interface SessionUser {
  id: number;
  name: string;
  email: string | null;
  lang: Lang;
  locations: LocationAccess[];
}

export interface AuthResponse {
  accessToken: string;
  /** ISO time when the access token expires. */
  expiresAt: string;
  user: SessionUser;
}

export interface MeResponse {
  user: SessionUser;
  /** Present when the request carried a valid X-Location-Id. */
  location: (LocationAccess & { permissions: Permission[] }) | null;
}

/** A staff member shown on the PIN switch screen. */
export interface PinUser {
  id: number;
  name: string;
  roleKey: RoleKey;
  locked: boolean;
}

export const langPreferenceSchema = z.object({ lang: langSchema });
