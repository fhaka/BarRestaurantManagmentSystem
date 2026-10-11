import { create } from 'zustand';
import type { AuthResponse, MeResponse, Permission, RoleKey, SessionUser } from '@tavolina/shared';

/**
 * booting       – restoring the session from the refresh cookie
 * anonymous     – nobody signed in on this device
 * authenticated – a staff member is using the device
 * locked        – the device is signed in but waiting for a PIN (see D-019)
 * unreachable   – restoring the session, but the server cannot be reached right now
 */
export type SessionStatus = 'booting' | 'anonymous' | 'authenticated' | 'locked' | 'unreachable';

const LOCATION_KEY = 'tavolina.locationId';
const LOCKED_KEY = 'tavolina.locked';
/** Set while this browser holds a refresh cookie, so boot can skip a pointless refresh. */
const SESSION_HINT_KEY = 'tavolina.hasSession';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage unavailable (private mode); the session still works for this tab.
  }
}

export function storedLocationId(): number | null {
  const value = Number(read(LOCATION_KEY));
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function isDeviceLocked(): boolean {
  return read(LOCKED_KEY) === '1';
}

export function hasSessionHint(): boolean {
  return read(SESSION_HINT_KEY) === '1';
}

interface SessionState {
  status: SessionStatus;
  accessToken: string | null;
  user: SessionUser | null;
  locationId: number | null;
  locationName: string | null;
  roleKey: RoleKey | null;
  permissions: ReadonlySet<Permission>;
  /** Stores a fresh access token + user from login, refresh or PIN switch. */
  setAuth: (auth: AuthResponse) => void;
  /** Stores the role and permissions for the chosen location (from GET /me). */
  setLocationContext: (me: MeResponse) => void;
  /** Locks the device: forgets the token in memory; a PIN is needed to continue. */
  lock: () => void;
  /** Forgets everything (logout or session expiry). */
  clear: () => void;
  /** Boot could not reach the server; it keeps retrying. */
  setUnreachable: () => void;
  can: (permission: Permission) => boolean;
}

export const useSession = create<SessionState>((set, get) => ({
  status: 'booting',
  accessToken: null,
  user: null,
  locationId: storedLocationId(),
  locationName: null,
  roleKey: null,
  permissions: new Set(),

  setAuth: (auth) => {
    write(LOCKED_KEY, null);
    write(SESSION_HINT_KEY, '1');
    set({ accessToken: auth.accessToken, user: auth.user });
  },

  setLocationContext: (me) => {
    if (!me.location) return;
    write(LOCATION_KEY, String(me.location.id));
    set({
      status: 'authenticated',
      user: me.user,
      locationId: me.location.id,
      locationName: me.location.name,
      roleKey: me.location.roleKey,
      permissions: new Set(me.location.permissions),
    });
  },

  lock: () => {
    write(LOCKED_KEY, '1');
    set({ status: 'locked', accessToken: null, permissions: new Set(), roleKey: null });
  },

  clear: () => {
    write(LOCKED_KEY, null);
    write(SESSION_HINT_KEY, null);
    set({
      status: 'anonymous',
      accessToken: null,
      user: null,
      roleKey: null,
      locationName: null,
      permissions: new Set(),
    });
  },

  setUnreachable: () => set({ status: 'unreachable' }),

  can: (permission) => get().permissions.has(permission),
}));

/** Picks the stored location if the user still has it, otherwise their first location. */
export function chooseLocationId(user: SessionUser, preferred = storedLocationId()): number | null {
  if (preferred && user.locations.some((l) => l.id === preferred)) return preferred;
  return user.locations[0]?.id ?? null;
}
