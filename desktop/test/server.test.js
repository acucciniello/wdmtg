import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/core/store.js';
import { Engine } from '../src/core/engine.js';
import { createServer } from '../src/core/server.js';
import { seedDemo } from '../src/core/demo.js';
import { dayStart, dateString, HOUR, MIN } from '../src/core/timeline.js';

const uiDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/ui');

async function boot() {
  const store = new Store();
  seedDemo(store);
  const engine = new Engine({ store, demo: true });
  const app = createServer({ engine, uiDir, port: 0, actions: { ping: () => ({ pong: true }) } });
  const port = await app.listen();
  const call = (method, p, body, headers = {}) =>
    fetch(`http://127.0.0.1:${port}${p}`, { method, body: body ? JSON.stringify(body) : undefined, headers });
  return { store, engine, app, port, call };
}

test('dashboard data: day, week, status', async (t) => {
  const s = await boot();
  t.after(() => s.app.close());
  const day = await (await s.call('GET', '/api/day')).json();
  assert.equal(day.date, dateString(Date.now()));
  assert.ok(Array.isArray(day.leaks) && Array.isArray(day.timeline) && day.totals);
  const week = await (await s.call('GET', '/api/week')).json();
  assert.equal(week.days.length, 7);
  const status = await (await s.call('GET', '/api/status')).json();
  assert.equal(status.demo, true);
  assert.equal((await s.call('GET', '/')).status, 200);
  assert.equal((await s.call('GET', '/../package.json')).status, 404);
});

test('sorting an app and logging off-screen time', async (t) => {
  const s = await boot();
  t.after(() => s.app.close());
  assert.equal((await s.call('POST', '/api/rule', { key: 'app:notion.id', bucket: 'money' })).status, 200);
  assert.equal(s.store.rules().get('app:notion.id').bucket, 'money');
  assert.equal((await s.call('POST', '/api/rule', { key: 'app:notion.id', bucket: 'nonsense' })).status, 400);
  await s.call('POST', '/api/rule', { key: 'app:notion.id', bucket: null });
  assert.equal(s.store.rules().has('app:notion.id'), false);

  const start = dayStart() - 20 * HOUR;
  const res = await s.call('POST', '/api/manual', { start, end: start + 45 * MIN, title: 'Showing', bucket: 'money' });
  assert.equal(res.status, 200);
  assert.equal((await s.call('POST', '/api/manual', { start, end: start - 1, title: 'x', bucket: 'money' })).status, 400);
  assert.equal(s.store.range(start, start + 1).filter((x) => x.source === 'manual' && x.title === 'Showing').length, 1);
});

test('phone sync stores drives, logs and places once', async (t) => {
  const s = await boot();
  t.after(() => s.app.close());
  const T = dayStart() - 30 * HOUR;
  const body = {
    device: 'iPhone 17',
    motion: [{ type: 'driving', start: T, end: T + 20 * MIN }, { type: 'walking', start: T, end: T + MIN }],
    manual: [{ id: 'm1', start: T + HOUR, end: T + 2 * HOUR, title: 'Closing', bucket: 'money' }, { id: 'bad', start: 5, end: 1, title: 'x' }],
    visits: [{ id: 'v1', start: T + 3 * HOUR, end: T + 4 * HOUR, name: '123 Oak St' }],
  };
  const before = s.store.range(0, Number.MAX_SAFE_INTEGER).length;
  assert.deepEqual(await (await s.call('POST', '/api/phone/sync', body)).json(), { ok: true, received: 3 });
  await s.call('POST', '/api/phone/sync', body);
  assert.equal(s.store.range(0, Number.MAX_SAFE_INTEGER).length - before, 3);
  assert.equal(s.engine.status().phoneApp.device, 'iPhone 17');
});

test('pairing info and desktop actions are only for this computer; other sites are refused', async (t) => {
  const s = await boot();
  t.after(() => s.app.close());
  const pair = await (await s.call('GET', '/api/pair')).json();
  assert.equal(pair.token, s.app.token);
  assert.equal(pair.port, s.port);
  if (pair.url) assert.match(pair.qr, /<svg/);
  assert.deepEqual(await (await s.call('POST', '/api/action', { name: 'ping' })).json(), { pong: true });
  assert.equal((await s.call('POST', '/api/action', { name: 'nope' })).status, 404);
  assert.equal((await s.call('GET', '/api/day', null, { Origin: 'https://evil.example' })).status, 403);
});

test('requests over the network need the pairing token', async (t) => {
  const s = await boot();
  t.after(() => s.app.close());
  // Simulate a non-local caller by asking the request handler directly with a fake remote address.
  const ask = (headers, url = '/api/day') =>
    new Promise((resolve) => {
      const req = new http.IncomingMessage({ remoteAddress: '192.168.1.50' });
      Object.assign(req, { method: 'GET', url, headers: { host: 'x', ...headers } });
      const res = { writeHead: (status) => (res.status = status), end: () => resolve(res.status) };
      s.app.server.emit('request', req, res);
      req.push(null);
    });
  assert.equal(await ask({}), 401);
  assert.equal(await ask({ authorization: 'Bearer wrong' }), 401);
  assert.equal(await ask({ authorization: `Bearer ${s.app.token}` }), 200);
  assert.equal(await ask({}, `/api/day?token=${s.app.token}`), 200);
  assert.equal(await ask({ authorization: `Bearer ${s.app.token}` }, '/api/pair'), 404, 'pairing details never leave this computer');
});
