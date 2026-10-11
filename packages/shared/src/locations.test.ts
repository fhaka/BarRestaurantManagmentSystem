import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCATION_SETTINGS,
  locationCreateSchema,
  niptSchema,
  normalizeLocationSettings,
} from './locations.js';

describe('niptSchema', () => {
  it('accepts and normalises valid NIPT', () => {
    expect(niptSchema.parse(' l12345678a ')).toBe('L12345678A');
  });

  it.each(['12345678A', 'L1234567A', 'L123456789A', 'LL2345678A'])('rejects %s', (value) => {
    expect(niptSchema.safeParse(value).success).toBe(false);
  });
});

describe('location settings', () => {
  it('defaults guest orders to require waiter confirmation (plan §5.5)', () => {
    expect(DEFAULT_LOCATION_SETTINGS.guestOrdersRequireConfirmation).toBe(true);
    expect(DEFAULT_LOCATION_SETTINGS.defaultLang).toBe('sq');
    expect(DEFAULT_LOCATION_SETTINGS.openingHours).toHaveLength(7);
  });

  it('fills missing keys from older saved settings', () => {
    const s = normalizeLocationSettings({ serviceChargeBp: 500 });
    expect(s.serviceChargeBp).toBe(500);
    expect(s.voidRequiresApproval).toBe(true);
  });

  it('falls back to defaults for corrupt JSON', () => {
    expect(normalizeLocationSettings({ serviceChargeBp: -1 })).toEqual(DEFAULT_LOCATION_SETTINGS);
  });

  it('validates create payloads', () => {
    expect(locationCreateSchema.safeParse({ name: 'X' }).success).toBe(false);
    expect(locationCreateSchema.parse({ name: 'Las Vegas Durrës' }).address).toBe('');
  });
});
