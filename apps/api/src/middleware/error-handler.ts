import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { ApiError } from '@tavolina/shared';
import multer from 'multer';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

function send(res: Parameters<RequestHandler>[1], status: number, body: ApiError) {
  res.status(status).json(body);
}

export const notFound: RequestHandler = (req, res) => {
  send(res, 404, {
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} does not exist`,
      details: {},
    },
  });
};

/** Body-parser and similar middleware attach an HTTP status and a `type` to their errors. */
interface HttpLikeError {
  status?: number;
  statusCode?: number;
  type?: string;
  expose?: boolean;
  message?: string;
}

export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, _next) => {
  if (err instanceof AppError) {
    send(res, err.status, {
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }

  if (err instanceof ZodError) {
    send(res, 400, {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Some fields are missing or invalid',
        details: {
          issues: err.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      },
    });
    return;
  }

  if (err instanceof multer.MulterError) {
    const tooLarge = err.code === 'LIMIT_FILE_SIZE';
    send(res, tooLarge ? 413 : 400, {
      error: {
        code: tooLarge ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST',
        message: tooLarge
          ? 'The photo is larger than 5 MB.'
          : 'Upload one photo in the "image" field.',
        details: {},
      },
    });
    return;
  }

  const httpErr = (typeof err === 'object' && err !== null ? err : {}) as HttpLikeError;
  const status = httpErr.status ?? httpErr.statusCode;
  if (status && status >= 400 && status < 500 && httpErr.expose !== false) {
    const code =
      httpErr.type === 'entity.too.large'
        ? 'PAYLOAD_TOO_LARGE'
        : httpErr.type === 'entity.parse.failed'
          ? 'BAD_REQUEST'
          : status === 413
            ? 'PAYLOAD_TOO_LARGE'
            : status === 404
              ? 'NOT_FOUND'
              : 'BAD_REQUEST';
    send(res, status, {
      error: { code, message: httpErr.message ?? 'Bad request', details: {} },
    });
    return;
  }

  logger.error({ err, requestId: req.id }, 'Unhandled error');
  send(res, 500, {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong on our side. Please try again.',
      details: { requestId: req.id },
    },
  });
};
