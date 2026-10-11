import { describe, expect, it } from 'vitest';
import { pickLang } from './i18n.js';

describe('pickLang', () => {
  it('picks the first supported base language', () => {
    expect(pickLang(['de-DE', 'it-IT', 'en'])).toBe('it');
    expect(pickLang(['EN-us'])).toBe('en');
  });

  it('falls back to Albanian', () => {
    expect(pickLang(['de', 'fr'])).toBe('sq');
    expect(pickLang([])).toBe('sq');
  });
});
