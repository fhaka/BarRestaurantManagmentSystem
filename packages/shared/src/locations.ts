import { z } from 'zod';
import { langSchema } from './i18n.js';

export const TIMEZONE = 'Europe/Tirane';

/** Albanian tax ID (NIPT/NUIS): letter, 8 digits, letter — e.g. L12345678A. */
export const niptSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]\d{8}[A-Z]$/, { message: 'nipt' });

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'time' });

export const openingHoursSchema = z.object({
  /** 0 = Monday … 6 = Sunday */
  weekday: z.number().int().min(0).max(6),
  open: timeOfDay,
  /** May be earlier than `open` when the location closes after midnight. */
  close: timeOfDay,
});

const DEFAULT_OPENING_HOURS = Array.from({ length: 7 }, (_, weekday) => ({
  weekday,
  open: '07:00',
  close: '23:00',
}));

/** Per-location settings, stored as JSON on `locations.settings`. Percentages in basis points. */
export const locationSettingsSchema = z.object({
  defaultLang: langSchema.default('sq'),
  languages: z.array(langSchema).min(1).default(['sq', 'en', 'it']),
  currencyDisplay: z.enum(['L', 'ALL']).default('L'),
  serviceChargeBp: z.number().int().min(0).max(3000).default(0),
  tipOptionsBp: z.array(z.number().int().min(0).max(5000)).max(5).default([500, 1000, 1500]),
  receiptHeader: z.string().max(500).default(''),
  receiptFooter: z.string().max(500).default(''),
  openingHours: z.array(openingHoursSchema).max(14).default(DEFAULT_OPENING_HOURS),
  guestOrderingEnabled: z.boolean().default(true),
  /** Default per plan §5.5: guest orders wait for a waiter to confirm. */
  guestOrdersRequireConfirmation: z.boolean().default(true),
  waitersSeeAllTables: z.boolean().default(false),
  /** Voiding a sent item needs manager PIN approval. */
  voidRequiresApproval: z.boolean().default(true),
  /** Discounts above this need manager PIN approval (1000 = 10%). */
  discountApprovalThresholdBp: z.number().int().min(0).max(10000).default(1000),
  /** Business rule 7: stock is booked out when the order is sent (default) or when it is paid. */
  stockDeductOn: z.enum(['send', 'payment']).default('send'),
  /** Business rule 3: a void after the kitchen started counts the dish as waste. */
  voidedPreparedIsWaste: z.boolean().default(true),
  /** Printers by role (stations have their own); null = screens only. */
  receiptPrinterId: z.number().int().positive().nullable().default(null),
  reportPrinterId: z.number().int().positive().nullable().default(null),
  /** Fiscal codes issued by the tax authority (DPT); placeholders until registration. */
  fiscal: z
    .object({
      businessUnitCode: z.string().trim().max(20).default('ab123cd456'),
      tcrCode: z.string().trim().max(20).default('ef789gh012'),
      softwareCode: z.string().trim().max(20).default('tv000tv000'),
      maintainerCode: z.string().trim().max(20).default('mn000mn000'),
    })
    .default({
      businessUnitCode: 'ab123cd456',
      tcrCode: 'ef789gh012',
      softwareCode: 'tv000tv000',
      maintainerCode: 'mn000mn000',
    }),
});
export type LocationSettings = z.infer<typeof locationSettingsSchema>;

export const DEFAULT_LOCATION_SETTINGS: LocationSettings = locationSettingsSchema.parse({});

/** Fills in defaults for settings saved by older versions. */
export function normalizeLocationSettings(raw: unknown): LocationSettings {
  const parsed = locationSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : DEFAULT_LOCATION_SETTINGS;
}

export const locationCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  address: z.string().trim().max(255).default(''),
  nipt: niptSchema.nullish(),
  settings: locationSettingsSchema.partial().optional(),
});
export type LocationCreateInput = z.infer<typeof locationCreateSchema>;

export const locationUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  address: z.string().trim().max(255).optional(),
  nipt: niptSchema.nullish(),
  /** Partial: only the given keys change. */
  settings: locationSettingsSchema.partial().optional(),
});
export type LocationUpdateInput = z.infer<typeof locationUpdateSchema>;

export interface Location {
  id: number;
  accountId: number;
  name: string;
  address: string;
  nipt: string | null;
  timezone: string;
  currency: string;
  settings: LocationSettings;
}
