import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/core/store.js';
import { seedDemo } from '../src/core/demo.js';
import { summarizeDay, summarizeWeek, analyze, fmt } from '../src/core/insights.js';
import { flatten, fillGaps, dayStart, MIN, HOUR } from '../src/core/timeline.js';

const NOW = dayStart('2026-03-12') + 23 * HOUR; // a Thursday night

test('fmt', () => {
  assert.equal(fmt(0), '0m');
  assert.equal(fmt(59 * MIN), '59m');
  assert.equal(fmt(2 * HOUR), '2h');
  assert.equal(fmt(2 * HOUR + 5 * MIN), '2h 05m');
});

test('a day adds up: every awake second lands in exactly one bucket', () => {
  const store = new Store();
  seedDemo(store, { now: NOW });
  const day = summarizeDay(store, '2026-03-12', { now: NOW });
  const t = day.totals;
  const all = Object.values(t).reduce((a, b) => a + b, 0);
  assert.equal(all, 23 * HOUR, 'the whole day so far is accounted for');
  assert.equal(day.awakeMs, all - t.sleep - t.untracked);
  assert.ok(t.sleep > 5 * HOUR, 'the night is sleep');
  assert.ok(t.money > 30 * MIN && t.busy > HOUR && t.lost > HOUR);
  assert.match(day.headline, /went to making money/);
  const drawn = day.timeline.reduce((n, r) => n + r.e - r.s, 0);
  assert.equal(drawn, all, 'the drawn timeline has no holes');
});

test('leaks call out the real problems in plain words', () => {
  const store = new Store();
  seedDemo(store, { now: NOW });
  const day = summarizeDay(store, '2026-03-12', { now: NOW });
  const ids = day.leaks.map((l) => l.id);
  for (const id of ['lost', 'busy', 'checking', 'pickups', 'unsorted']) assert.ok(ids.includes(id), `expected leak "${id}", got ${ids}`);
  for (const l of day.leaks) {
    assert.ok(l.title && l.detail && l.fix, 'each leak says what, why and what to do');
    assert.doesNotMatch(l.title + l.detail + l.fix, /undefined|NaN|null/);
  }
  assert.ok(day.devices.mac.openIdleMs > 10 * MIN, 'laptop open but unused is measured');
  assert.ok(day.devices.iphone.pickups > 10);
  assert.ok(day.calls.length >= 1 && day.calls[0].ms > 0);
});

test('re-sorting an app moves its time everywhere, including the past', () => {
  const store = new Store();
  seedDemo(store, { now: NOW });
  const before = summarizeDay(store, '2026-03-11', { now: NOW });
  const insta = before.top.find((x) => x.name === 'Instagram');
  assert.deepEqual([...insta.keys].sort(), ['app:com.burbn.instagram', 'site:instagram.com'], 'the Mac site and the iPhone app are one row');
  for (const key of insta.keys) store.setRule(key, 'money');
  const after = summarizeDay(store, '2026-03-11', { now: NOW });
  assert.equal(after.totals.money - before.totals.money, insta.ms);
  assert.equal(before.totals.lost - after.totals.lost, insta.ms);
});

test('week view: seven days, each within 24h (25h on clock-change days)', () => {
  const store = new Store();
  seedDemo(store, { now: NOW });
  const week = summarizeWeek(store, '2026-03-12', { now: NOW });
  assert.equal(week.days.length, 7);
  assert.equal(week.days.at(-1).date, '2026-03-12');
  for (const d of week.days) assert.ok(Object.values(d.totals).reduce((a, b) => a + b, 0) <= 25 * HOUR);
  assert.ok(week.leaks.length >= 3);
});

test('an empty day does not invent anything', () => {
  const day = summarizeDay(new Store(), '2026-03-12', { now: NOW });
  assert.equal(day.leaks.length, 0);
  assert.match(day.headline, /Nothing tracked yet/);
});

test('pickups only count as interruptions when you were working on the laptop', () => {
  const T = dayStart('2026-03-12') + 9 * HOUR;
  const raw = [{ source: 'mac', start: T, end: T + 2 * HOUR, app: 'Slack', bundle: 'com.tinyspeck.slackmacgap' }];
  for (let i = 0; i < 6; i++) raw.push({ source: 'iphone', start: T + (10 + i * 15) * MIN, end: T + (12 + i * 15) * MIN, bundle: 'com.burbn.instagram', app: 'Instagram' });
  for (let i = 0; i < 6; i++) raw.push({ source: 'iphone', start: T + 5 * HOUR + i * 15 * MIN, end: T + 5 * HOUR + (2 + i * 15) * MIN, bundle: 'com.burbn.instagram', app: 'Instagram' });
  const tl = fillGaps(flatten(raw, T, T + 8 * HOUR), T, T + 8 * HOUR, { trackedFrom: T });
  const res = analyze(tl, raw, { from: T, to: T + 8 * HOUR });
  assert.equal(res.devices.iphone.pickups, 12);
  assert.equal(res.facts.workPickups, 6);
});
