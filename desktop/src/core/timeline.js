// Turns overlapping raw segments (Mac, iPhone, calls, drives, manual logs) into
// one clean line of time where every second belongs to exactly one thing.
import { classify } from './rules.js';

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

// Higher wins when two things overlap.
const PRIORITY = { manual: 70, call: 60, motion: 50, mac: 40, 'mac-history': 35, iphone: 30, place: 10 };

/** Local midnight for "YYYY-MM-DD" (or today). */
export function dayStart(date) {
  if (!date) {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

export function dateString(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Start of the next local day (handles daylight-saving days). */
export function nextDay(ms) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
}

/**
 * Flatten segments into non-overlapping slices inside [from, to).
 * Idle Mac time and "ignore" apps are dropped so they fall through to whatever
 * else was happening (phone, call) or to a gap.
 */
export function flatten(segments, from, to, userRules) {
  const items = [];
  for (const seg of segments) {
    const start = Math.max(seg.start, from);
    const end = Math.min(seg.end, to);
    if (end <= start) continue;
    if (seg.idle) continue;
    const c = classify(seg, userRules);
    if (c.bucket === 'ignore') continue;
    items.push({ start, end, seg, c, pri: PRIORITY[seg.source] ?? 0 });
  }

  const points = new Set([from, to]);
  for (const it of items) {
    points.add(it.start);
    points.add(it.end);
  }
  const cuts = [...points].sort((a, b) => a - b);

  // Sweep: at each elementary interval pick the highest-priority covering item.
  items.sort((a, b) => a.start - b.start);
  const slices = [];
  let active = [];
  let next = 0;
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i];
    const b = cuts[i + 1];
    while (next < items.length && items[next].start <= a) active.push(items[next++]);
    active = active.filter((it) => it.end > a);
    let best = null;
    for (const it of active) {
      if (!best || it.pri > best.pri || (it.pri === best.pri && it.start > best.start)) best = it;
    }
    if (!best) continue;
    const last = slices[slices.length - 1];
    if (last && last.item === best && last.end === a) {
      last.end = b;
    } else {
      slices.push({ start: a, end: b, item: best });
    }
  }

  return slices.map(({ start, end, item }) => ({
    start,
    end,
    source: item.seg.source,
    device: item.seg.device,
    app: item.seg.app,
    title: item.seg.title,
    url: item.seg.url,
    ...item.c,
  }));
}

/**
 * Fill the gaps. A long gap overnight is sleep, time before tracking began is
 * "untracked", anything else is time off screens.
 */
export function fillGaps(slices, from, to, { trackedFrom = from, sleepMin = 3 * HOUR } = {}) {
  const out = [];
  const gap = (start, end) => {
    if (end <= start) return;
    if (end <= trackedFrom) {
      out.push({ start, end, bucket: 'untracked', key: 'untracked', name: 'Not tracked yet', source: 'gap' });
      return;
    }
    if (start < trackedFrom) {
      gap(start, trackedFrom);
      start = trackedFrom;
    }
    const mid = new Date((start + end) / 2).getHours();
    const night = mid >= 21 || mid < 10;
    const asleep = end - start >= sleepMin && night;
    out.push(
      asleep
        ? { start, end, bucket: 'sleep', key: 'sleep', name: 'Asleep', source: 'gap' }
        : { start, end, bucket: 'away', key: 'away', name: 'Off screens', source: 'gap' }
    );
  };
  let cursor = from;
  for (const s of slices) {
    gap(cursor, s.start);
    out.push(s);
    cursor = s.end;
  }
  gap(cursor, to);
  return out;
}

/** Full, gap-free timeline for a window. */
export function buildTimeline(store, from, to, { now = Date.now() } = {}) {
  const end = Math.min(to, now);
  if (end <= from) return [];
  // Look a few hours past both edges so an overnight gap is seen whole and
  // recognised as sleep, even though only part of it falls inside this window.
  const lookback = from - 6 * HOUR;
  const lookahead = Math.min(to + 6 * HOUR, now);
  const segs = store.range(lookback, lookahead);
  const rules = store.rules();
  const trackedFrom = store.get('tracked_from') ?? store.earliest() ?? now;
  const slices = flatten(segs, lookback, lookahead, rules);
  const filled = fillGaps(slices, lookback, lookahead, { trackedFrom });
  const out = [];
  for (const s of filled) {
    const start = Math.max(s.start, from);
    const stop = Math.min(s.end, end);
    if (stop <= start) continue;
    out.push({ ...s, start, end: stop });
  }
  return out;
}
