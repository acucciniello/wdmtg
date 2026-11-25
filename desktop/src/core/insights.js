// Turns a timeline into plain-English answers: where did the time go and where was it lost.
import { BUCKET_NAMES } from './rules.js';
import { buildTimeline, dayStart, nextDay, dateString, MIN, HOUR } from './timeline.js';

export function fmt(ms) {
  const m = Math.round(ms / MIN);
  if (m < 1) return ms > 0 ? '<1m' : '0m';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${String(r).padStart(2, '0')}m` : `${h}h`;
}

const WORK = new Set(['money', 'busy']);
const CHECK_LABELS = new Set(['Email', 'Chat']);
const sum = (list, f = (x) => x.end - x.start) => list.reduce((n, x) => n + f(x), 0);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const listNames = (items, n = 3) =>
  items.slice(0, n).map((i) => `${i.name} (${fmt(i.ms)})`).join(', ');

/**
 * Group slices into a ranked list. The same thing on two devices (YouTube in a
 * Mac browser and the YouTube iPhone app) becomes one row that remembers both keys.
 */
function rank(slices) {
  const map = new Map();
  for (const s of slices) {
    const id = `${s.kind === 'person' ? 'person' : 'thing'}|${s.name.toLowerCase()}|${s.bucket}`;
    let row = map.get(id);
    if (!row) {
      row = { key: s.key, keys: new Set(), name: s.name, kind: s.kind, bucket: s.bucket, label: s.label, ms: 0, visits: 0, devices: new Set() };
      map.set(id, row);
    }
    row.keys.add(s.key);
    row.ms += s.end - s.start;
    row.visits += 1;
    row.devices.add(s.source === 'mac-history' ? 'mac' : s.source);
  }
  return [...map.values()]
    .map((r) => ({ ...r, keys: [...r.keys], devices: [...r.devices] }))
    .sort((a, b) => b.ms - a.ms);
}

/** Runs of slices matching `test`, bridging interruptions shorter than `bridge`. */
function runs(slices, test, bridge) {
  const out = [];
  let cur = null;
  for (const s of slices) {
    if (!test(s)) continue;
    if (cur && s.start - cur.end <= bridge) {
      cur.end = s.end;
      cur.ms += s.end - s.start;
      cur.names.set(s.name, (cur.names.get(s.name) || 0) + s.end - s.start);
    } else {
      cur = { start: s.start, end: s.end, ms: s.end - s.start, names: new Map([[s.name, s.end - s.start]]) };
      out.push(cur);
    }
  }
  return out;
}

/** Phone pickups: bursts of iPhone use separated by at least 2 minutes of no use. */
function pickups(rawSegs, from, to) {
  const phone = rawSegs
    .filter((s) => s.source === 'iphone' && s.end > from && s.start < to)
    .sort((a, b) => a.start - b.start);
  const out = [];
  let cur = null;
  for (const s of phone) {
    if (cur && s.start - cur.end < 2 * MIN) {
      cur.end = Math.max(cur.end, s.end);
      cur.ms += s.end - s.start;
    } else {
      cur = { start: s.start, end: s.end, ms: s.end - s.start, first: s };
      out.push(cur);
    }
  }
  return out;
}

/** Shrink the timeline to bucket-coloured runs for drawing. */
export function compact(timeline, minMs = 30_000) {
  const out = [];
  for (const s of timeline) {
    const last = out[out.length - 1];
    const tiny = s.end - s.start < minMs;
    if (last && (last.b === s.bucket || (tiny && last.e === s.start))) {
      last.e = s.end;
      if (last.b === s.bucket) last.n.set(s.name, (last.n.get(s.name) || 0) + s.end - s.start);
    } else {
      out.push({ s: s.start, e: s.end, b: s.bucket, n: new Map([[s.name, s.end - s.start]]) });
    }
  }
  return out.map((r) => ({
    s: r.s,
    e: r.e,
    b: r.b,
    n: [...r.n.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name]) => name),
  }));
}

/**
 * The core analysis. `timeline` is gap-free slices, `raw` the raw segments for
 * the same window, `days` how many days the window covers (for averages).
 */
export function analyze(timeline, raw, { from, to, days = 1 } = {}) {
  const totals = { money: 0, busy: 0, life: 0, lost: 0, unsorted: 0, away: 0, sleep: 0, untracked: 0 };
  for (const s of timeline) totals[s.bucket] = (totals[s.bucket] || 0) + s.end - s.start;
  const awakeMs = totals.money + totals.busy + totals.life + totals.lost + totals.unsorted + totals.away;
  const real = timeline.filter((s) => s.source !== 'gap');
  const ranked = rank(real);
  const per = days > 1 ? ' a day' : '';
  const avg = (n) => (days > 1 ? Math.round(n / days) : n);
  const when = days > 1 ? 'this week' : 'today';
  const amt = (ms) => (days > 1 ? `${fmt(ms / days)} a day` : fmt(ms));

  // --- devices: active vs just sitting open ---
  const inWin = (s) => Math.max(0, Math.min(s.end, to) - Math.max(s.start, from));
  const macActive = sum(real.filter((s) => s.source === 'mac' || s.source === 'mac-history'));
  const macOpenIdle = raw.filter((s) => s.source === 'mac' && s.idle).reduce((n, s) => n + inWin(s), 0);
  const phonePickups = pickups(raw, from, to);
  const phoneMs = raw.filter((s) => s.source === 'iphone').reduce((n, s) => n + inWin(s), 0);
  const callSlices = real.filter((s) => s.source === 'call');
  const callMs = sum(callSlices);

  // --- facts ---
  const macSlices = real.filter((s) => s.source === 'mac');
  let switches = 0;
  for (let i = 1; i < macSlices.length; i++) {
    if (macSlices[i].key !== macSlices[i - 1].key && macSlices[i].start - macSlices[i - 1].end < MIN) switches++;
  }
  const moneyRuns = runs(timeline, (s) => s.bucket === 'money', 2 * MIN);
  const longestMoney = moneyRuns.reduce((best, r) => (!best || r.ms > best.ms ? r : best), null);
  const checks = runs(real, (s) => CHECK_LABELS.has(s.label), MIN);
  const checkMs = sum(checks, (c) => c.ms);
  const workSlices = real.filter((s) => WORK.has(s.bucket));
  const workMs = totals.money + totals.busy;

  // Pickups that interrupted laptop work: phone came out within 2 minutes of working on the Mac.
  const macWork = macSlices.filter((s) => WORK.has(s.bucket));
  let wi = 0;
  const workPickups = phonePickups.filter((p) => {
    while (wi < macWork.length && macWork[wi].end < p.start - 2 * MIN) wi++;
    return wi < macWork.length && macWork[wi].start <= p.start;
  });
  const workPickupMs = sum(workPickups, (p) => p.ms);

  const late = workSlices.filter((s) => new Date(s.start).getHours() >= 20 || new Date(s.start).getHours() < 5);
  const lateMs = sum(late);

  // --- leaks ---
  const leaks = [];
  const lostTop = ranked.filter((r) => r.bucket === 'lost');
  if (totals.lost >= 10 * MIN * days) {
    const top = lostTop[0];
    leaks.push({
      id: 'lost',
      ms: totals.lost,
      title: `${fmt(totals.lost)} disappeared ${when}`,
      detail: `Mostly ${listNames(lostTop)}.`,
      fix: top
        ? `Start with ${top.name}. A ${top.ms / days > HOUR ? '30' : '15'}-minute daily limit in Screen Time gives you back about ${fmt(Math.max(0, top.ms / days - (top.ms / days > HOUR ? 30 : 15) * MIN))}${per}.`
        : null,
    });
  }

  const busyTop = ranked.filter((r) => r.bucket === 'busy');
  if (totals.busy >= 30 * MIN * days && totals.busy > totals.money) {
    const ratio = totals.money > 5 * MIN ? totals.busy / totals.money : null;
    leaks.push({
      id: 'busy',
      ms: totals.busy - totals.money,
      title: ratio
        ? `For every hour making money you spent ${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)} hours on busywork`
        : `${fmt(totals.busy)} of busywork and almost no money work`,
      detail: `${fmt(totals.busy)} busywork vs ${fmt(totals.money)} making money. Biggest: ${listNames(busyTop)}.`,
      fix: `Do 90 minutes of money work first thing, before you open ${busyTop[0]?.name || 'email'}.`,
    });
  }

  if (checks.length >= 8 * days) {
    const every = workMs > 0 ? Math.round(workMs / checks.length / MIN) : null;
    leaks.push({
      id: 'checking',
      ms: checkMs,
      title: `You checked email and chat ${avg(checks.length)} times${per}`,
      detail: `${amt(checkMs)} in total${every ? `, about once every ${plural(Math.max(1, every), 'minute')} of work` : ''}. Each check breaks your focus.`,
      fix: 'Pick 3 set times a day for email and chat. Close them the rest of the time.',
    });
  }

  if (workPickups.length >= 5 * days) {
    const names = new Map();
    for (const p of workPickups) {
      const n = p.first.app || p.first.bundle || 'your phone';
      names.set(n, (names.get(n) || 0) + 1);
    }
    const fav = [...names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    leaks.push({
      id: 'pickups',
      ms: workPickupMs,
      title: `You picked up your phone ${avg(workPickups.length)} times${per} while working`,
      detail: `Those pickups took ${amt(workPickupMs)}${fav ? `. It usually started with ${fav}` : ''}.`,
      fix: 'Put the phone in another room during work blocks.',
    });
  }

  if (totals.money >= 30 * MIN * days && longestMoney && longestMoney.ms < 25 * MIN) {
    leaks.push({
      id: 'fragmented',
      ms: 0,
      title: `Your longest stretch of money work was only ${fmt(longestMoney.ms)}`,
      detail: `${fmt(totals.money)} of money work was chopped into ${plural(moneyRuns.length, 'piece')}.`,
      fix: 'Block one 60-minute window tomorrow. One task, everything else closed.',
    });
  }

  const macHours = macActive / HOUR;
  if (days === 1 && macHours >= 1 && switches / macHours >= 40) {
    leaks.push({
      id: 'switching',
      ms: 0,
      title: `You switched apps ${switches} times on your laptop`,
      detail: `That is once every ${Math.max(1, Math.round((macActive / switches) / 1000))} seconds on average.`,
      fix: 'Work in full screen with one app at a time.',
    });
  }

  const callPeople = rank(callSlices);
  const unsortedCalls = callPeople.filter((p) => p.bucket === 'unsorted' || p.bucket === 'busy');
  const unsortedCallMs = sum(unsortedCalls, (p) => p.ms);
  if (unsortedCallMs >= 30 * MIN * days) {
    leaks.push({
      id: 'calls',
      ms: unsortedCallMs,
      title: `${fmt(unsortedCallMs)} on calls that are not tied to money`,
      detail: `Longest: ${listNames(unsortedCalls)}.`,
      fix: 'Sort your callers once so I can tell deal calls from the rest.',
      action: 'sort',
    });
  }

  if (lateMs >= 30 * MIN * days) {
    leaks.push({
      id: 'late',
      ms: lateMs,
      title: `You worked ${fmt(lateMs)} after 8pm ${when}`,
      detail: 'Work that leaks into the evening is time taken straight from your life.',
      fix: 'Set a hard stop. Anything left goes first on tomorrow\'s list.',
    });
  }

  const unsortedItems = ranked.filter((r) => r.bucket === 'unsorted');
  if (totals.unsorted >= 20 * MIN) {
    leaks.push({
      id: 'unsorted',
      ms: totals.unsorted,
      title: `${fmt(totals.unsorted)} is not sorted yet`,
      detail: `${plural(unsortedItems.length, 'thing')} I could not place yet: ${listNames(unsortedItems)}.`,
      fix: 'Sort them (takes a minute) and this report gets sharper.',
      action: 'sort',
    });
  }

  leaks.sort((a, b) => b.ms - a.ms);

  // --- one-line verdict ---
  let headline;
  if (awakeMs < 5 * MIN) {
    headline = 'Nothing tracked yet.';
  } else {
    const share = (ms) => Math.round((ms / awakeMs) * 100);
    headline = `Out of ${fmt(awakeMs)} awake, ${fmt(totals.money)} went to making money (${share(totals.money)}%) and ${fmt(totals.lost)} was lost (${share(totals.lost)}%).`;
  }

  return {
    headline,
    awakeMs,
    totals,
    names: BUCKET_NAMES,
    devices: {
      mac: { activeMs: macActive, openIdleMs: macOpenIdle },
      iphone: { activeMs: phoneMs, pickups: phonePickups.length },
      calls: { ms: callMs, count: callSlices.length },
    },
    facts: {
      switches,
      checks: checks.length,
      longestMoneyMs: longestMoney?.ms || 0,
      workPickups: workPickups.length,
      lateMs,
    },
    top: ranked.slice(0, 15),
    calls: callPeople.slice(0, 10),
    leaks,
    unsorted: unsortedItems.slice(0, 50),
  };
}

export function summarizeDay(store, date, { now = Date.now() } = {}) {
  const from = dayStart(date);
  const to = nextDay(from);
  const end = Math.min(to, now);
  const timeline = buildTimeline(store, from, to, { now });
  const raw = store.range(from, end);
  return {
    date: dateString(from),
    from,
    to,
    now: end,
    ...analyze(timeline, raw, { from, to: end }),
    timeline: compact(timeline),
    // The longest stretches away from every screen, so you can say what they were.
    gaps: timeline
      .filter((s) => s.bucket === 'away' && s.end - s.start >= 20 * MIN)
      .sort((a, b) => b.end - b.start - (a.end - a.start))
      .slice(0, 4)
      .sort((a, b) => a.start - b.start)
      .map((s) => ({ start: s.start, end: s.end })),
  };
}

export function summarizeWeek(store, endDate, { now = Date.now() } = {}) {
  const last = dayStart(endDate);
  const days = [];
  let cursor = last;
  for (let i = 0; i < 7; i++) {
    days.unshift(cursor);
    cursor = dayStart(dateString(cursor - 12 * HOUR));
  }
  const from = days[0];
  const to = nextDay(last);
  const end = Math.min(to, now);
  const timeline = buildTimeline(store, from, to, { now });
  const raw = store.range(from, end);
  const perDay = days.map((d) => {
    const dEnd = nextDay(d);
    const totals = { money: 0, busy: 0, life: 0, lost: 0, unsorted: 0, away: 0, sleep: 0, untracked: 0 };
    for (const s of timeline) {
      const ms = Math.min(s.end, dEnd) - Math.max(s.start, d);
      if (ms > 0) totals[s.bucket] += ms;
    }
    return { date: dateString(d), totals };
  });
  const tracked = perDay.filter((d) => d.totals.money + d.totals.busy + d.totals.life + d.totals.lost + d.totals.unsorted > 5 * MIN).length;
  return {
    from,
    to,
    now: end,
    startDate: dateString(from),
    endDate: dateString(last),
    daysTracked: tracked,
    ...analyze(timeline, raw, { from, to: end, days: Math.max(1, tracked) }),
    days: perDay,
  };
}
