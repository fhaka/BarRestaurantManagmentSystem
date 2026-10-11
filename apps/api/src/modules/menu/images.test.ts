import { existsSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { createApp } from '../../app.js';
import { uploadsDir } from '../../lib/storage.js';
import { as, login, resetAndSeed, type Fixture } from '../../test/fixtures.js';

const app = createApp();
let fx: Fixture;
let manager: ReturnType<typeof as>;
let itemId: number;

beforeEach(async () => {
  fx = await resetAndSeed();
  manager = as(app, await login(app, fx.users.manager.email), fx.locationId);
  const category = await manager.post('/api/v1/menu/categories').send({ name: 'Kafe' });
  const item = await manager
    .post('/api/v1/menu/items')
    .send({ categoryId: category.body.id, stationId: null, name: 'Espresso', priceMinor: 10_000 });
  itemId = item.body.id;
});

const photo = (width = 2000, height = 1500) =>
  sharp({ create: { width, height, channels: 3, background: '#7a4a2a' } })
    .jpeg()
    .toBuffer();

const fileFor = (url: string) => path.join(uploadsDir, url.replace(/^\/uploads\//, ''));

describe('menu item images', () => {
  it('re-encodes to WebP (max 1200 px) with a 480×360 thumbnail, served from /uploads', async () => {
    const res = await manager
      .post(`/api/v1/menu/items/${itemId}/image`)
      .attach('image', await photo(), 'kafe.jpg');
    expect(res.status).toBe(200);
    expect(res.body.imageUrl).toMatch(/^\/uploads\/menu\/\d+\/[0-9a-f-]+\.webp$/);
    expect(res.body.thumbUrl).toBe(res.body.imageUrl.replace('.webp', '-thumb.webp'));

    const full = await sharp(fileFor(res.body.imageUrl)).metadata();
    expect(full).toMatchObject({ format: 'webp', width: 1200, height: 900 });
    const thumb = await sharp(fileFor(res.body.thumbUrl)).metadata();
    expect(thumb).toMatchObject({ width: 480, height: 360 });

    const served = await request(app).get(res.body.imageUrl);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('image/webp');
  });

  it('replacing or removing a photo deletes the old files', async () => {
    const first = await manager
      .post(`/api/v1/menu/items/${itemId}/image`)
      .attach('image', await photo(), 'a.jpg');
    const second = await manager
      .post(`/api/v1/menu/items/${itemId}/image`)
      .attach('image', await photo(800, 800), 'b.jpg');
    expect(existsSync(fileFor(first.body.imageUrl))).toBe(false);
    expect(existsSync(fileFor(second.body.imageUrl))).toBe(true);

    const removed = await manager.delete(`/api/v1/menu/items/${itemId}/image`);
    expect(removed.body.imageUrl).toBeNull();
    expect(existsSync(fileFor(second.body.imageUrl))).toBe(false);
  });

  it('checks the real file type, not the name', async () => {
    const res = await manager
      .post(`/api/v1/menu/items/${itemId}/image`)
      .attach('image', Buffer.from('<?php echo "hi"; ?>'), {
        filename: 'photo.jpg',
        contentType: 'image/jpeg',
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_IMAGE');
  });

  it('rejects files over 5 MB', async () => {
    const res = await manager
      .post(`/api/v1/menu/items/${itemId}/image`)
      .attach('image', Buffer.alloc(5 * 1024 * 1024 + 1), 'big.jpg');
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('waiters cannot upload', async () => {
    const waiter = as(app, await login(app, fx.users.waiter.email), fx.locationId);
    const res = await waiter
      .post(`/api/v1/menu/items/${itemId}/image`)
      .attach('image', await photo(), 'kafe.jpg');
    expect(res.status).toBe(403);
  });
});
