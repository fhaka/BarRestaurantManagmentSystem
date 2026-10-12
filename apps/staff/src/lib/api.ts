import {
  API_BASE_PATH,
  apiErrorSchema,
  type ApiError,
  type AuthResponse,
  type MeResponse,
} from '@tavolina/shared';
import { chooseLocationId, hasSessionHint, isDeviceLocked, useSession } from './session';

/** Non-2xx response carrying the standard error envelope. */
export class ApiRequestError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;
  constructor(
    public readonly status: number,
    body: ApiError['error'],
  ) {
    super(body.message);
    this.name = 'ApiRequestError';
    this.code = body.code;
    this.details = body.details;
  }
}

/** The request never reached the API (offline, DNS, server down). */
export class NetworkError extends Error {
  constructor() {
    super('Network request failed');
    this.name = 'NetworkError';
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function parseError(res: Response): Promise<ApiRequestError> {
  const json: unknown = await res.json().catch(() => null);
  const parsed = apiErrorSchema.safeParse(json);
  return new ApiRequestError(
    res.status,
    parsed.success
      ? parsed.data.error
      : { code: 'INTERNAL_ERROR', message: res.statusText || 'Request failed', details: {} },
  );
}

async function rawFetch(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`${API_BASE_PATH}${path}`, { credentials: 'include', ...init });
  } catch {
    throw new NetworkError();
  }
}

// ---- Session refresh (single flight) ---------------------------------------------------------

/**
 * ok          – new access token stored
 * expired     – the session is over (401): sign in again
 * unavailable – the server could not be reached (network, 5xx): keep the session and retry
 */
export type RefreshResult = 'ok' | 'expired' | 'unavailable';

let refreshing: Promise<RefreshResult> | null = null;

async function doRefresh(): Promise<RefreshResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await rawFetch('/auth/refresh', {
        method: 'POST',
        headers: { Accept: 'application/json' },
      });
    } catch {
      return 'unavailable';
    }
    if (res.ok) {
      useSession.getState().setAuth((await res.json()) as AuthResponse);
      return 'ok';
    }
    if (res.status >= 500) return 'unavailable';
    const err = await parseError(res);
    // Another tab rotated the token a moment ago; its new cookie is already set.
    if (err.details.retry === true && attempt === 0) {
      await sleep(400);
      continue;
    }
    return 'expired';
  }
  return 'expired';
}

/** Gets a new access token from the refresh cookie. Concurrent callers share one request. */
export function refreshSession(): Promise<RefreshResult> {
  refreshing ??= doRefresh()
    .catch((): RefreshResult => 'unavailable')
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

// ---- Requests --------------------------------------------------------------------------------

export interface RequestOptions {
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /** Send X-Location-Id (default true). */
  withLocation?: boolean;
  /** Override the location (used when switching). */
  locationId?: number;
  /** How to read a successful response (default: JSON). */
  responseType?: 'json' | 'text';
  /** Reuse a key, e.g. when the offline outbox replays a queued action. */
  idempotencyKey?: string;
}

/**
 * Calls the API with the access token and current location. Mutations get an Idempotency-Key that
 * stays the same if the call is retried after a token refresh. A 401 triggers one refresh + retry.
 */
export async function api<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { body, query, withLocation = true } = options;
  const idempotencyKey =
    method === 'GET' ? undefined : (options.idempotencyKey ?? crypto.randomUUID());
  const search = query
    ? `?${new URLSearchParams(
        Object.entries(query)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)]),
      )}`
    : '';

  for (let attempt = 0; attempt < 2; attempt++) {
    const session = useSession.getState();
    const headers: Record<string, string> = { Accept: 'application/json' };
    const isForm = body instanceof FormData;
    if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
    if (session.accessToken) headers.Authorization = `Bearer ${session.accessToken}`;
    const locationId = options.locationId ?? session.locationId;
    if (withLocation && locationId) headers['X-Location-Id'] = String(locationId);
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

    const res = await rawFetch(`${path}${search}`, {
      method,
      headers,
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await parseError(res);
      // Only token problems trigger a refresh; e.g. INVALID_PIN is also a 401.
      const tokenProblem = err.code === 'UNAUTHENTICATED' || err.code === 'SESSION_EXPIRED';
      if (res.status === 401 && tokenProblem && attempt === 0 && session.status !== 'locked') {
        const refreshed = await refreshSession();
        if (refreshed === 'ok') continue;
        // A server hiccup is not a sign-out: keep the session and report the network problem.
        if (refreshed === 'unavailable') throw new NetworkError();
        useSession.getState().clear();
      }
      throw err;
    }
    if (res.status === 204) return undefined as T;
    if (options.responseType === 'text') return (await res.text()) as T;
    return (await res.json()) as T;
  }
  throw new ApiRequestError(401, {
    code: 'SESSION_EXPIRED',
    message: 'Session expired',
    details: {},
  });
}

// ---- Session lifecycle -----------------------------------------------------------------------

/** Loads role + permissions for a location and makes it current. */
export async function loadLocationContext(locationId: number): Promise<void> {
  const me = await api<MeResponse>('GET', '/me', { locationId });
  useSession.getState().setLocationContext(me);
}

/** After login / refresh / PIN switch: pick a location and load permissions. */
export async function enterSession(auth: AuthResponse, preferredLocationId?: number) {
  useSession.getState().setAuth(auth);
  const locationId = chooseLocationId(auth.user, preferredLocationId);
  if (!locationId) {
    useSession.getState().clear();
    throw new ApiRequestError(403, {
      code: 'LOCATION_FORBIDDEN',
      message: 'No locations',
      details: {},
    });
  }
  await loadLocationContext(locationId);
}

const BOOT_RETRY_MS = 3000;

/**
 * On app start: restore the session from the refresh cookie, unless the device is locked.
 * If the server cannot be reached (Wi-Fi drop, restart) the session is kept and boot retries
 * until it can decide, showing a "connecting" screen meanwhile.
 */
export async function bootSession(): Promise<void> {
  const session = useSession.getState();
  if (isDeviceLocked()) {
    session.lock();
    return;
  }
  // Never signed in on this browser: don't call refresh just to get a 401.
  if (!hasSessionHint()) return session.clear();

  for (;;) {
    const result = await refreshSession();
    if (result === 'expired') return session.clear();
    if (result === 'ok') {
      const { user } = useSession.getState();
      const locationId = user ? chooseLocationId(user) : null;
      if (!locationId) return session.clear();
      try {
        await loadLocationContext(locationId);
        return;
      } catch (err) {
        if (!(
          err instanceof NetworkError ||
          (err instanceof ApiRequestError && err.status >= 500)
        )) {
          return session.clear();
        }
      }
    }
    useSession.getState().setUnreachable();
    await sleep(BOOT_RETRY_MS);
  }
}

export async function logout(): Promise<void> {
  await rawFetch('/auth/logout', { method: 'POST' }).catch(() => undefined);
  useSession.getState().clear();
}

/** Public auth calls that run without an access token. */
export async function publicPost<T>(path: string, body: unknown): Promise<T> {
  const res = await rawFetch(path, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as T;
}

export async function publicGet<T>(path: string): Promise<T> {
  const res = await rawFetch(path, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as T;
}
