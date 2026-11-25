import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/core/store.js';
import { Tracker } from '../src/core/tracker.js';

function rig(opts = {}) {
  const store = new Store();
  const state = { t: 1_700_000_000_000, idle: 0, win: { app: 'Chrome', bundle: 'com.google.Chrome', title: 'Zillow', url: 'https://zillow.com' } };
  const tracker = new Tracker({ store, sample: async () => state.win, idleSeconds: () => state.idle, now: () => state.t, flushEvery: 0, ...opts });
  const run = async (seconds, change = {}) => {
    Object.assign(state, change);
    for (let i = 0; i < seconds; i++) {
      state.t += 1000;
      if (change.idleGrows) state.idle += 1;
      await tracker.tick();
    }
  };
  const segs = () => store.range(0, Number.MAX_SAFE_INTEGER).map((s) => ({ app: s.app, title: s.title, idle: s.idle, secs: (s.end - s.start) / 1000 }));
  return { store, state, tracker, run, segs };
}

test('one window for a while becomes one segment', async () => {
  const r = rig();
  await r.run(60);
  assert.deepEqual(r.segs(), [{ app: 'Chrome', title: 'Zillow', idle: 0, secs: 59 }]);
});

test('switching windows starts a new segment with no hole between them', async () => {
  const r = rig();
  await r.run(30);
  await r.run(20, { win: { app: 'Slack', bundle: 'slack', title: 'team' } });
  const s = r.store.range(0, Number.MAX_SAFE_INTEGER);
  assert.equal(s.length, 2);
  assert.equal(s[0].end, s[1].start);
  assert.equal(s[1].app, 'Slack');
});

test('walking away: idle time is backdated to the last key press', async () => {
  const r = rig({ idleAfter: 120 });
  await r.run(100); // working
  await r.run(300, { idleGrows: true }); // hands off for 5 minutes
  const s = r.segs();
  assert.equal(s.length, 2);
  assert.deepEqual(s.map((x) => x.idle), [0, 1]);
  assert.equal(s[0].secs, 99, 'active part ends at the last touch');
  assert.equal(s[1].secs, 300, 'all 5 minutes away count as idle, not just the part after the threshold');
});

test('idle backdating also rewrites windows that changed by themselves while away', async () => {
  const r = rig({ idleAfter: 120 });
  await r.run(50);
  await r.run(60, { idleGrows: true });
  await r.run(30, { idleGrows: true, win: { app: 'Chrome', bundle: 'com.google.Chrome', title: 'Zillow (1 new)', url: 'https://zillow.com' } });
  await r.run(60, { idleGrows: true });
  const s = r.segs();
  assert.equal(s.filter((x) => !x.idle).reduce((n, x) => n + x.secs, 0), 49);
  assert.equal(s.filter((x) => x.idle).reduce((n, x) => n + x.secs, 0), 150);
});

test('coming back ends the idle segment', async () => {
  const r = rig({ idleAfter: 120 });
  await r.run(10);
  await r.run(200, { idleGrows: true });
  await r.run(30, { idle: 0 });
  assert.deepEqual(r.segs().map((x) => x.idle), [0, 1, 0]);
});

test('video apps are not idle just because you are watching', async () => {
  const r = rig({ idleAfter: 120, passiveIdleAfter: 1800, isPassive: (w) => w.app === 'Zoom' });
  await r.run(600, { idleGrows: true, win: { app: 'Zoom', bundle: 'us.zoom.xos', title: 'Meeting' } });
  assert.deepEqual(r.segs().map((x) => x.idle), [0]);
});

test('a sleeping laptop leaves a hole instead of a stretched segment', async () => {
  const r = rig();
  await r.run(30);
  r.state.t += 3 * 3600 * 1000; // lid closed for 3 hours
  await r.run(30);
  const s = r.segs();
  assert.equal(s.length, 2);
  assert.ok(s[0].secs <= 30 && s[1].secs <= 30);
});

test('sampling errors do not stop tracking', async () => {
  const r = rig({ sample: async () => { throw new Error('no permission'); } });
  await r.run(10);
  assert.equal(r.segs()[0].app, 'Unknown');
  assert.match(r.tracker.error, /no permission/);
});

test('nothing in front (bare desktop) is recorded but never counted as your time', async () => {
  const { flatten } = await import('../src/core/timeline.js');
  const r = rig({ sample: async () => null });
  await r.run(30);
  const raw = r.store.range(0, Number.MAX_SAFE_INTEGER);
  assert.equal(raw[0].app, 'No window');
  assert.equal(flatten(raw, 0, Number.MAX_SAFE_INTEGER).length, 0);
});
