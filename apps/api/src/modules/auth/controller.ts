import type { CookieOptions, Request, Response } from 'express';
import { z } from 'zod';
import {
  API_BASE_PATH,
  loginRequestSchema,
  pinClockSchema,
  pinLoginRequestSchema,
} from '@tavolina/shared';
import { isProduction } from '../../config/env.js';
import { getAuth } from '../../middleware/auth.js';
import * as service from './service.js';
import type { RequestMeta, SessionResult } from './service.js';

export const REFRESH_COOKIE = 'tav_rt';

const cookieOptions: CookieOptions = {
  httpOnly: true,
  secure: isProduction,
  // Strict: the cookie is never sent on cross-site requests, which also blocks CSRF.
  sameSite: 'strict',
  path: `${API_BASE_PATH}/auth`,
};

function meta(req: Request): RequestMeta {
  return {
    ip: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
    requestId: String(req.id),
  };
}

function readRefreshCookie(req: Request): string | undefined {
  const value: unknown = req.cookies?.[REFRESH_COOKIE];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function sendSession(res: Response, session: SessionResult) {
  res.cookie(REFRESH_COOKIE, session.refreshToken, {
    ...cookieOptions,
    expires: session.refreshExpiresAt,
  });
  res.json(session.body);
}

export async function login(req: Request, res: Response) {
  const input = loginRequestSchema.parse(req.body);
  sendSession(res, await service.login(input, meta(req)));
}

export async function refresh(req: Request, res: Response) {
  try {
    sendSession(res, await service.refresh(readRefreshCookie(req), meta(req)));
  } catch (err) {
    res.clearCookie(REFRESH_COOKIE, cookieOptions);
    throw err;
  }
}

export async function logout(req: Request, res: Response) {
  await service.logout(readRefreshCookie(req));
  res.clearCookie(REFRESH_COOKIE, cookieOptions);
  res.status(204).end();
}

export async function pinUsers(req: Request, res: Response) {
  const { locationId } = z
    .object({ locationId: z.coerce.number().int().positive() })
    .parse(req.query);
  res.json(await service.listPinUsers(readRefreshCookie(req), locationId));
}

export async function pinLogin(req: Request, res: Response) {
  const input = pinLoginRequestSchema.parse(req.body);
  sendSession(res, await service.pinLogin(readRefreshCookie(req), input, meta(req)));
}

export async function pinClock(req: Request, res: Response) {
  const input = pinClockSchema.parse(req.body);
  res.json(await service.pinClock(readRefreshCookie(req), input, meta(req)));
}

export async function me(req: Request, res: Response) {
  res.json(await service.me(getAuth(req).userId, req.location));
}
