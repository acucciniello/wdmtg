import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/core/store.js';
import { readSegb } from '../src/core/collectors/segb.js';
import { parseTransition, stitch, importBiome } from '../src/core/collectors/biome.js';
import { focusRecord, writeSegbV1, writeSegbV2 } from './helpers/segb.js';

const T0 = 800_000_000; // seconds since 2001
const records = [
  { data: focusRecord(T0, 'com.burbn.instagram', true) },
  { data: Buffer.alloc(13), state: 3 }, // deleted record, must be ignored
  { data: focusRecord(T0 + 90.5, 'com.burbn.instagram', false) },
  { data: focusRecord(T0 + 100, 'com.apple.MobileSMS', true) },
  { data: focusRecord(T0 + 130, 'com.zillow.ZillowMap', true) },
  { data: focusRecord(T0 + 400, 'com.zillow.ZillowMap', false) },
];

for (const [name, write] of [['v1', writeSegbV1], ['v2', writeSegbV2]]) {
  test(`SEGB ${name}: reads every record, checks CRCs, keeps states`, () => {
    const recs = readSegb(write(records));
    assert.equal(recs.length, records.length);
    assert.ok(recs.every((r) => r.crcOk));
    assert.deepEqual(recs.map((r) => r.state), [1, 3, 1, 1, 1, 1]);
    assert.deepEqual(parseTransition(recs[0].data), { time: T0, bundle: 'com.burbn.instagram', gained: true });
    assert.deepEqual(parseTransition(recs[2].data), { time: T0 + 90.5, bundle: 'com.burbn.instagram', gained: false });
  });
}

test('SEGB: a damaged record fails its CRC', () => {
  const buf = writeSegbV2(records);
  buf[32 + 8 + 20] ^= 0xff;
  assert.equal(readSegb(buf)[0].crcOk, false);
  assert.throws(() => readSegb(Buffer.from('nope')));
});

test('stitch: focus changes become usage intervals', () => {
  const t = (time, bundle, gained) => ({ time, bundle, gained });
  const { closed, open } = stitch([
    t(0, 'a', true), t(5, 'a', true), // repeated gain keeps the first start
    t(60, 'a', false),
    t(100, 'b', true), t(130, 'c', true), // switching apps closes the previous one
    t(200, 'x', false), // a stray "lost" for another app changes nothing
  ]);
  assert.deepEqual(closed, [{ bundle: 'a', start: 0, end: 60 }, { bundle: 'b', start: 100, end: 130 }]);
  assert.deepEqual(open, { bundle: 'c', start: 130 });
});

test('importBiome: reads a device folder into iPhone segments and is safe to repeat', () => {
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'wdmtg-lib-'));
  const dir = path.join(lib, 'Biome/streams/restricted/App.InFocus/remote/DEVICE-1');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '700000000000000'), writeSegbV2(records.slice(0, 4)));
  // the interval that is open at the end of the first file is closed by the second file
  fs.writeFileSync(path.join(dir, '700000500000000'), writeSegbV1(records.slice(4)));
  fs.writeFileSync(path.join(dir, 'tombstone'), 'ignored');

  const store = new Store();
  const first = importBiome(store, { library: lib });
  assert.equal(first.ok, true);
  assert.equal(first.devices.length, 1);
  const segs = store.range(0, Number.MAX_SAFE_INTEGER);
  assert.deepEqual(segs.map((s) => [s.app, (s.end - s.start) / 1000]), [['Instagram', 90.5], ['Messages', 30], ['Zillow', 270]]);
  assert.equal(new Date(segs[0].start).toISOString(), '2026-05-09T06:13:20.000Z');

  importBiome(store, { library: lib });
  fs.appendFileSync(path.join(dir, 'tombstone'), 'x');
  store.set('biome:DEVICE-1', null); // force a full re-read
  importBiome(store, { library: lib });
  assert.equal(store.count('iphone'), 3, 'no duplicates');
  fs.rmSync(lib, { recursive: true });
});

test('importBiome: explains itself when the data is not there', () => {
  const res = importBiome(new Store(), { library: '/nonexistent' });
  assert.deepEqual([res.ok, res.reason], [false, 'not-found']);
});
