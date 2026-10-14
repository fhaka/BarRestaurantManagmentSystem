/**
 * Counts the SQL queries and time per API endpoint against the demo database (Phase 10
 * performance pass): an endpoint whose query count grows with the data has an N+1 problem.
 * Run: npm run profile:queries -w @tavolina/api
 */
import request from 'supertest';

// Quiet request logs; set before the app (and its logger) is loaded.
process.env.LOG_LEVEL ??= 'silent';
const { createApp } = await import('../src/app.js');
const { db } = await import('../src/db/knex.js');
const { DEMO_PASSWORD } = await import('../src/db/seeds/01_demo_access.js');

let queries = 0;
db.on('query', () => {
  queries++;
});

const app = createApp();
const login = await request(app)
  .post('/api/v1/auth/login')
  .send({ email: 'menaxher@lasvegas.test', password: DEMO_PASSWORD });
const token = login.body.accessToken as string;
const locationId = String(login.body.user.locations[0].id);
const today = new Date().toISOString().slice(0, 10);
const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
const order = await db('orders').where({ status: 'open' }).first('id');

const endpoints = [
  '/floor',
  '/orders',
  `/orders/${order?.id}`,
  `/orders/${order?.id}/bill`,
  '/kds/stations/1/board',
  '/menu',
  '/staff',
  '/ingredients',
  '/costing',
  '/purchase-orders',
  '/stock-counts',
  '/stock-movements',
  `/reservations?date=${today}`,
  `/reservations/availability?date=${today}&partySize=2`,
  '/reports/dashboard',
  `/reports/sales?from=${monthAgo}&to=${today}`,
  `/reports/items?from=${monthAgo}&to=${today}`,
  `/reports/staff?from=${monthAgo}&to=${today}`,
  `/reports/discounts-voids?from=${monthAgo}&to=${today}`,
  `/reports/inventory?from=${monthAgo}&to=${today}`,
  `/time-entries/hours?from=${monthAgo}&to=${today}`,
  `/audit-logs?limit=50`,
];

console.log('endpoint'.padEnd(58), 'status', 'queries', 'ms');
for (const path of endpoints) {
  queries = 0;
  const started = performance.now();
  const res = await request(app)
    .get(`/api/v1${path}`)
    .set('Authorization', `Bearer ${token}`)
    .set('X-Location-Id', locationId);
  const ms = Math.round(performance.now() - started);
  console.log(
    path.slice(0, 57).padEnd(58),
    String(res.status).padEnd(6),
    String(queries).padEnd(7),
    ms,
  );
}
await db.destroy();
process.exit(0);
