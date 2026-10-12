/**
 * Entry point for browser bundles that must stay small (the guest QR app): only plain helpers and
 * constants, no zod schemas. Types can still be imported from '@tavolina/shared' with `import type`.
 */
export * from './constants.js';
export * from './money.js';
export * from './order-math.js';
export * from './allergens.js';
export { DEFAULT_LANG, LANGS, isLang, pickLang, type Lang } from './i18n.js';
