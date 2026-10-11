import type { Permission, RoleKey } from '@tavolina/shared';

declare global {
  namespace Express {
    interface Request {
      /** Correlation id set by the request-id middleware. */
      id: string;
      /** Set by requireAuth. */
      auth?: {
        userId: number;
        accountId: number;
        deviceId: number | null;
        name: string;
      };
      /** Set by requireLocation from the X-Location-Id header. */
      location?: {
        id: number;
        accountId: number;
        name: string;
        roleKey: RoleKey;
        permissions: ReadonlySet<Permission>;
      };
    }
  }
}

export {};
