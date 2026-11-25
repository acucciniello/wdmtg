import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/core/store.js';
import { classify } from '../src/core/rules.js';
import { flatten, fillGaps, buildTimeline, dayStart, nextDay, MIN, HOUR } from '../src/core/timeline.js';

const T = dayStart('2026-03-10');
const at = (h, m = 0) => T + h * HOUR + m * MIN;
const total = (slices, f) => slices.filter(f).reduce((n, s) => n + s.end - s.start, 0);

test('classify: sites, apps, people, overrides', () => {
  const chrome = { source: 'mac', app: 'Google Chrome', bundle: 'com.google.Chrome' };
  assert.equal(classify({ ...chrome, url: 'https://www.zillow.com/homes/x' }).bucket, 'money');
  assert.equal(classify({ ...chrome, url: 'https://www.youtube.com/watch?v=1' }).bucket, 'lost');
  assert.equal(classify({ ...chrome, url: 'https://studio.youtube.com/channel/1' }).bucket, 'money', 'longest match wins');
  assert.equal(classify({ ...chrome, url: 'https://docs.google.com/spreadsheets/d/1' }).key, 'site:docs.google.com/spreadsheets');
  assert.equal(classify({ ...chrome, url: 'https://docs.google.com/spreadsheets/d/1' }).name, 'Google Sheets');
  assert.equal(classify({ ...chrome, url: 'https://app.propstream.com/search' }).key, 'site:propstream.com', 'subdomains fold into the site');
  assert.equal(classify({ ...chrome, url: 'https://docs.google.com/document/d/1' }).bucket, 'unsorted');
  assert.equal(classify({ ...chrome, title: 'Inbox (3) - Gmail' }).label, 'Email', 'falls back to the tab title');
  assert.equal(classify({ source: 'iphone', bundle: 'com.burbn.instagram' }).name, 'Instagram');
  assert.equal(classify({ source: 'iphone', bundle: 'com.burbn.instagram' }).bucket, 'lost');
  assert.equal(classify({ source: 'mac', app: 'Slack', bundle: 'com.tinyspeck.slackmacgap' }).label, 'Chat');
  assert.equal(classify({ source: 'mac', app: 'Jobs Tracker', bundle: 'com.acme.jobs' }).bucket, 'unsorted', 'no accidental substring matches');
  assert.equal(classify({ source: 'call', title: 'Mike Russo' }).key, 'person:mike russo');
  assert.equal(classify({ source: 'manual', title: 'Gym', bucket: 'life' }).bucket, 'life');
  const user = new Map([['app:com.burbn.instagram', { bucket: 'money' }]]);
  assert.equal(classify({ source: 'iphone', bundle: 'com.burbn.instagram' }, user).bucket, 'money', 'your sorting wins');
});

test('overlaps: a call beats the laptop, the laptop beats the phone', () => {
  const segs = [
    { source: 'mac', start: at(9), end: at(10), app: 'Slack', bundle: 'com.tinyspeck.slackmacgap' },
    { source: 'iphone', start: at(9, 30), end: at(10, 30), bundle: 'com.burbn.instagram' },
    { source: 'call', start: at(9, 10), end: at(9, 20), title: 'Mike' },
  ];
  const s = flatten(segs, at(0), at(24));
  assert.equal(total(s, (x) => x.source === 'call'), 10 * MIN);
  assert.equal(total(s, (x) => x.source === 'mac'), 50 * MIN);
  assert.equal(total(s, (x) => x.source === 'iphone'), 30 * MIN);
  assert.equal(total(s, () => true), 90 * MIN, 'no second is counted twice');
});

test('an idle laptop does not count: the phone or a gap shows through', () => {
  const segs = [
    { source: 'mac', start: at(9), end: at(10), app: 'Slack', bundle: 'slack', idle: 1 },
    { source: 'iphone', start: at(9, 15), end: at(9, 30), bundle: 'com.zhiliaoapp.musically' },
  ];
  const s = flatten(segs, at(0), at(24));
  assert.equal(s.length, 1);
  assert.equal(s[0].name, 'TikTok');
});

test('gaps: overnight is sleep, daytime is off screens, before install is untracked', () => {
  const slices = flatten([
    { source: 'mac', start: at(8), end: at(12), app: 'Slack', bundle: 'slack' },
    { source: 'mac', start: at(14), end: at(22), app: 'Slack', bundle: 'slack' },
  ], at(0), at(24));
  const f = fillGaps(slices, at(0), at(24), { trackedFrom: at(0) });
  assert.deepEqual(f.map((x) => x.bucket), ['sleep', 'busy', 'away', 'busy', 'away']);
  assert.equal(total(f, () => true), 24 * HOUR);
  const g = fillGaps(slices, at(0), at(24), { trackedFrom: at(8) });
  assert.equal(g[0].bucket, 'untracked');
});

test('buildTimeline covers the whole day exactly once and stops at "now"', () => {
  const store = new Store();
  store.add({ source: 'mac', start: at(-2), end: at(-1), app: 'Slack', bundle: 'slack' }); // 10pm-11pm the night before
  store.add({ source: 'mac', start: at(7), end: at(9), app: 'Slack', bundle: 'slack' });
  const now = at(15);
  const tl = buildTimeline(store, T, nextDay(T), { now });
  assert.equal(tl[0].start, T);
  assert.equal(tl.at(-1).end, now);
  assert.equal(total(tl, () => true), 15 * HOUR);
  assert.equal(tl[0].bucket, 'sleep', 'sleep that began before midnight is still seen as sleep');
  for (let i = 1; i < tl.length; i++) assert.equal(tl[i].start, tl[i - 1].end);
});
