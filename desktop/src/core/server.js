// Small local web server: the dashboard, its data, and the endpoint the iPhone
// app syncs with. Requests from this computer are trusted; anything coming
// over Wi-Fi must carry the pairing token.
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { summarizeDay, summarizeWeek } from './insights.js';
import { BUCKETS } from './rules.js';
import { dateString, HOUR } from './timeline.js';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

export function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) out.push(a.address);
  }
  return out;
}

const isLoopback = (addr) => addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

async function readJson(req, limit = 4_000_000) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error('too large'), { status: 413 });
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('bad json'), { status: 400 });
  }
}

/**
 * @param {object} o
 * @param {import('./engine.js').Engine} o.engine
 * @param {Record<string, (body:object)=>any>} [o.actions]  extra desktop-only actions (open settings, ...)
 */
export function createServer({ engine, uiDir, port = 48321, actions = {}, now = Date.now }) {
  const { store } = engine;
  let token = store.get('pair_token');
  if (!token) {
    token = crypto.randomBytes(18).toString('base64url');
    store.set('pair_token', token);
  }

  const validDate = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d : dateString(now()));

  const routes = {
    'GET /api/day': (q) => summarizeDay(store, validDate(q.get('date')), { now: now() }),
    'GET /api/week': (q) => summarizeWeek(store, validDate(q.get('end')), { now: now() }),
    'GET /api/status': () => engine.status(),
    'GET /api/rules': () => [...store.rules().values()],
    'POST /api/rule': (q, body) => {
      if (typeof body.key !== 'string' || !body.key.includes(':')) throw Object.assign(new Error('bad key'), { status: 400 });
      if (body.bucket === null || body.bucket === 'unsorted') store.clearRule(body.key);
      else if (BUCKETS.includes(body.bucket)) store.setRule(body.key, body.bucket, null);
      else throw Object.assign(new Error('bad bucket'), { status: 400 });
      return { ok: true };
    },
    'POST /api/manual': (q, body) => {
      const { start, end } = body;
      const title = typeof body.title === 'string' ? body.title.trim().slice(0, 80) : '';
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 24 * HOUR || !title || !BUCKETS.includes(body.bucket)) {
        throw Object.assign(new Error('bad entry'), { status: 400 });
      }
      store.upsert({ source: 'manual', device: 'Desktop', start, end, title, bucket: body.bucket, extId: `manual:${start}:${end}` });
      return { ok: true };
    },
    'POST /api/phone/sync': (q, body) => engine.phoneSync(body),
    'POST /api/sync': async () => engine.sync(),
  };

  const localOnly = {
    'GET /api/pair': async () => {
      const addr = server.address();
      const hosts = lanAddresses();
      const host = hosts[0] || null;
      const url = host ? `http://${host}:${addr.port}/?token=${token}` : null;
      return {
        host,
        hosts,
        port: addr.port,
        token,
        url,
        appLink: host ? `wdmtg://pair?host=${host}&port=${addr.port}&token=${token}` : null,
        qr: url ? await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) : null,
      };
    },
    'POST /api/action': async (q, body) => {
      const fn = actions[body.name];
      if (!fn) throw Object.assign(new Error('unknown action'), { status: 404 });
      return (await fn(body)) ?? { ok: true };
    },
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const local = isLoopback(req.socket.remoteAddress);
    const send = (status, body, type = 'application/json') => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(type === 'application/json' ? JSON.stringify(body) : body);
    };
    try {
      // A page on another website must not be able to talk to this server:
      // we only answer when addressed by IP or "localhost" (blocks DNS rebinding)
      // and when the page making the request is our own.
      const hostname = String(req.headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
      if (hostname !== 'localhost' && !net.isIP(hostname)) return send(403, { error: 'forbidden' });
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) return send(403, { error: 'forbidden' });

      if (url.pathname.startsWith('/api/')) {
        const key = `${req.method} ${url.pathname}`;
        const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || url.searchParams.get('token');
        if (!local && !safeEqual(auth, token)) return send(401, { error: 'pair this device first' });
        const handler = routes[key] || (local ? localOnly[key] : null);
        if (!handler) return send(404, { error: 'not found' });
        const body = req.method === 'POST' ? await readJson(req) : {};
        return send(200, await handler(url.searchParams, body));
      }

      if (req.method !== 'GET') return send(405, { error: 'method not allowed' });
      const name = url.pathname === '/' ? 'index.html' : path.basename(url.pathname);
      const file = path.join(uiDir, name);
      if (!TYPES[path.extname(name)] || !fs.existsSync(file)) return send(404, 'Not found', 'text/plain');
      return send(200, fs.readFileSync(file), TYPES[path.extname(name)]);
    } catch (err) {
      return send(err.status || 500, { error: err.status ? err.message : 'internal error' });
    }
  });

  return {
    server,
    token,
    listen: () =>
      new Promise((resolve, reject) => {
        server.once('error', (err) => {
          if (err.code !== 'EADDRINUSE' || port === 0) return reject(err);
          server.listen(0, '0.0.0.0'); // preferred port taken: let the system pick one
        });
        server.once('listening', () => resolve(server.address().port));
        server.listen(port, '0.0.0.0');
      }),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
