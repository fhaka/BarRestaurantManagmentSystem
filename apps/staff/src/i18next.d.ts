import 'i18next';
import type common from './locales/sq/common.json';
import type app from './locales/sq/app.json';
import type auth from './locales/sq/auth.json';
import type errors from './locales/sq/errors.json';
import type staff from './locales/sq/staff.json';
import type business from './locales/sq/business.json';
import type menu from './locales/sq/menu.json';
import type floor from './locales/sq/floor.json';
import type orders from './locales/sq/orders.json';
import type kds from './locales/sq/kds.json';
import type billing from './locales/sq/billing.json';
import type inventory from './locales/sq/inventory.json';
import type reservations from './locales/sq/reservations.json';
import type showcase from './locales/sq/showcase.json';

// Type-safe translation keys, checked against the Albanian source files.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: {
      common: typeof common;
      app: typeof app;
      auth: typeof auth;
      errors: typeof errors;
      staff: typeof staff;
      business: typeof business;
      menu: typeof menu;
      floor: typeof floor;
      orders: typeof orders;
      kds: typeof kds;
      billing: typeof billing;
      inventory: typeof inventory;
      reservations: typeof reservations;
      showcase: typeof showcase;
    };
    returnNull: false;
  }
}
