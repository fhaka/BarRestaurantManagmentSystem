import { API_BASE_PATH } from '@tavolina/shared/client';

/** An error from the API ({ error: { code, message, details } }) or the network. */
export class GuestApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = 'GuestApiError';
  }
}

/** Calls the guest API. The guest session cookie travels automatically (same origin). */
export async function guestApi<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_PATH}/guest${path}`, {
      method,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new GuestApiError(0, 'NETWORK');
  }
  if (!res.ok) {
    const json = (await res.json().catch(() => null)) as {
      error?: { code?: string; details?: Record<string, unknown> };
    } | null;
    throw new GuestApiError(
      res.status,
      json?.error?.code ?? 'INTERNAL_ERROR',
      json?.error?.details,
    );
  }
  return (await res.json()) as T;
}
