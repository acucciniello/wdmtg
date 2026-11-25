// iPhone and iPad app usage. Apple does not let an iPhone app read this, but
// with Screen Time > "Share Across Devices" on, every device syncs its
// app-in-focus stream to this Mac through iCloud:
//   ~/Library/Biome/streams/restricted/App.InFocus/remote/<device-id>/<segment files>
// Reading it needs Full Disk Access. Approach and record layout follow
// nichtlegacy/screentime (MIT).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSegb, WRITTEN } from './segb.js';
import { withCopy, appleToMs } from './sqlcopy.js';
import { prettyName } from '../rules.js';

const STREAM = 'Biome/streams/restricted/App.InFocus/remote';
const SYNC_DB = 'Biome/sync/sync.db';

function varint(buf, i) {
  let value = 0;
  let mul = 1;
  for (;;) {
    if (i >= buf.length) throw new RangeError('truncated varint');
    const byte = buf[i++];
    value += (byte & 0x7f) * mul;
    if (byte < 0x80) return [value, i];
    mul *= 128;
  }
}

/** One AppInFocus record: field 3 = gained focus (1/0), field 4 = time, field 6 = bundle id. */
export function parseTransition(data) {
  const fields = {};
  let i = 0;
  try {
    while (i < data.length) {
      let key;
      [key, i] = varint(data, i);
      const number = Math.floor(key / 8);
      const wire = key & 7;
      if (wire === 0) {
        [fields[number], i] = varint(data, i);
      } else if (wire === 1) {
        fields[number] = data.readDoubleLE(i);
        i += 8;
      } else if (wire === 2) {
        let size;
        [size, i] = varint(data, i);
        if (i + size > data.length) return null;
        fields[number] = data.subarray(i, i + size);
        i += size;
      } else if (wire === 5) {
        i += 4;
      } else {
        return null;
      }
    }
  } catch {
    return null;
  }
  if (i !== data.length) return null;
  const bundle = Buffer.isBuffer(fields[6]) ? fields[6].toString('utf8') : '';
  const time = fields[4];
  if (!bundle || typeof time !== 'number' || !Number.isFinite(time)) return null;
  return { time, bundle, gained: fields[3] === 1 };
}

/** Focus transitions -> closed [bundle, start, end] intervals (Apple-epoch seconds). */
export function stitch(transitions, carry = null) {
  let current = carry;
  const closed = [];
  for (const { time, bundle, gained } of transitions) {
    if (current && current.bundle === bundle && gained) continue; // repeated gain keeps the first start
    if (current && (gained || current.bundle === bundle)) {
      if (time > current.start) closed.push({ bundle: current.bundle, start: current.start, end: time });
      current = null;
    }
    if (gained) current = { bundle, start: time };
  }
  return { closed, open: current };
}

function readSegment(file) {
  const out = [];
  try {
    for (const rec of readSegb(fs.readFileSync(file))) {
      if (rec.state !== WRITTEN || !rec.crcOk) continue;
      const t = parseTransition(rec.data);
      if (t) out.push(t);
    }
  } catch {
    // unreadable or half-written segment: use what we have
  }
  return out;
}

function deviceNames(library) {
  const names = new Map();
  try {
    withCopy(path.join(library, SYNC_DB), (db) => {
      for (const row of db.prepare('SELECT device_identifier AS id, name FROM DevicePeer').all()) {
        if (row.name) names.set(row.id, row.name);
      }
    });
  } catch {
    // names are optional
  }
  return names;
}

/**
 * Import every remote device's usage into the store.
 * @returns {{ok:boolean, reason?:string, devices:{id:string,name:string,intervals:number}[], imported:number}}
 */
export function importBiome(store, { library = path.join(os.homedir(), 'Library') } = {}) {
  const root = path.join(library, STREAM);
  let dirs;
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch (err) {
    const reason = err.code === 'ENOENT' ? 'not-found' : err.code === 'EPERM' || err.code === 'EACCES' ? 'no-access' : 'error';
    return { ok: false, reason, devices: [], imported: 0 };
  }
  const names = deviceNames(library);
  const devices = [];
  let imported = 0;
  for (const dir of dirs) {
    const full = path.join(root, dir.name);
    let files;
    try {
      files = fs.readdirSync(full).filter((f) => /^\d+$/.test(f)).sort((a, b) => Number(a) - Number(b));
    } catch {
      continue;
    }
    // Skip the work when nothing changed since the last import.
    const signature = files.map((f) => {
      const st = fs.statSync(path.join(full, f));
      return `${f}:${st.size}:${Math.round(st.mtimeMs)}`;
    }).join('|');
    const stateKey = 'biome:' + dir.name;
    const name = names.get(dir.name) || 'iPhone';
    const prev = store.get(stateKey);
    if (prev?.signature === signature) {
      devices.push({ id: dir.name, name, intervals: prev.intervals });
      continue;
    }
    let open = null;
    const rows = [];
    for (const f of files) {
      const res = stitch(readSegment(path.join(full, f)), open);
      open = res.open;
      for (const iv of res.closed) {
        // Anything longer than 6 hours is a missed "lost focus" event, not real use.
        if (iv.end - iv.start > 6 * 3600) continue;
        rows.push({
          source: 'iphone',
          device: name,
          start: appleToMs(iv.start),
          end: appleToMs(iv.end),
          app: store.name(iv.bundle) || prettyName(iv.bundle, null),
          bundle: iv.bundle,
          extId: `biome:${dir.name}:${Math.round(iv.start * 1000)}:${iv.bundle}`,
        });
      }
    }
    imported += store.upsertMany(rows);
    store.set(stateKey, { signature, intervals: rows.length });
    devices.push({ id: dir.name, name, intervals: rows.length });
  }
  return { ok: true, devices, imported };
}
