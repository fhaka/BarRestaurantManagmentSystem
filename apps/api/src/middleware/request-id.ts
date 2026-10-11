import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

const HEADER = 'x-request-id';
const VALID_ID = /^[A-Za-z0-9._-]{1,64}$/;

/** Reuses a sane incoming X-Request-Id or generates one, and echoes it on the response. */
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.get(HEADER);
  const id = incoming && VALID_ID.test(incoming) ? incoming : randomUUID();
  req.id = id;
  res.setHeader(HEADER, id);
  next();
};
