import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { apiErrorSchema, healthResponseSchema } from '@tavolina/shared';
import { createApp } from './app.js';

const app = createApp();

describe('GET /api/v1/health', () => {
  it('returns a valid health payload with a request id', async () => {
    const res = await request(app).get('/api/v1/health');

    expect([200, 503]).toContain(res.status);
    expect(healthResponseSchema.parse(res.body).checks.database).toBe(
      res.status === 200 ? 'up' : 'down',
    );
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('reports the database as up when MySQL is running', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.checks.database).toBe('up');
  });

  it('echoes a valid incoming request id', async () => {
    const res = await request(app).get('/api/v1/health').set('X-Request-Id', 'abc-123');
    expect(res.headers['x-request-id']).toBe('abc-123');
  });
});

describe('error envelope', () => {
  it('returns NOT_FOUND in the standard format for unknown routes', async () => {
    const res = await request(app).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(apiErrorSchema.parse(res.body).error.code).toBe('NOT_FOUND');
  });

  it('returns BAD_REQUEST in the standard format for malformed JSON', async () => {
    const res = await request(app)
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send('{"broken":');
    expect(res.status).toBe(400);
    expect(apiErrorSchema.parse(res.body).error.code).toBe('BAD_REQUEST');
  });

  it('returns PAYLOAD_TOO_LARGE for oversized bodies', async () => {
    const res = await request(app)
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ blob: 'x'.repeat(1_100_000) }));
    expect(res.status).toBe(413);
    expect(apiErrorSchema.parse(res.body).error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});
