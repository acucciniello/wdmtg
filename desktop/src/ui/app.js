// Dashboard. Plain DOM, no framework. All text goes in through textContent, so
// a strange window title can never run as code.

const MIN = 60_000;
const HOUR = 60 * MIN;
const BUCKETS = ['money', 'life', 'busy', 'lost'];
const NAMES = { money: 'Making money', life: 'Life', busy: 'Busywork', lost: 'Lost', unsorted: 'Not sorted yet', away: 'Off screens', sleep: 'Asleep', untracked: 'Not tracked yet' };
const SHORT = { money: 'Money', life: 'Life', busy: 'Busywork', lost: 'Lost' };
const HELP = {
  money: 'Deals, content, sales calls',
  life: 'Time you chose to enjoy',
  busy: 'Email, chat, admin, driving',
  lost: 'Feeds, video, news',
};

// ---------- tiny helpers ----------
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v; // only used for the QR code we generate ourselves
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

function fmt(ms) {
  const m = Math.round(ms / MIN);
  if (m < 1) return ms > 0 ? '<1m' : '0m';
  if (m < 60) return `${m}m`;
  const hrs = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${hrs}h ${String(r).padStart(2, '0')}m` : `${hrs}h`;
}
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const shift = (s, days) => { const d = parse(s); d.setDate(d.getDate() + days); return ymd(d); };
const today = () => ymd(new Date());
const longDate = (s) => (s === today() ? 'Today' : s === shift(today(), -1) ? 'Yesterday' : parse(s).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }));
const ago = (ms) => {
  if (!ms) return 'never';
  const d = Date.now() - ms;
  if (d < 2 * MIN) return 'just now';
  if (d < HOUR) return `${Math.round(d / MIN)} minutes ago`;
  if (d < 48 * HOUR) return `${Math.round(d / HOUR)} hours ago`;
  return `${Math.round(d / (24 * HOUR))} days ago`;
};

// ---------- talking to the desktop app ----------
const params = new URLSearchParams(location.search);
if (params.get('token')) {
  try { localStorage.setItem('wdmtg-token', params.get('token')); } catch { /* private mode */ }
  history.replaceState(null, '', location.pathname);
}
let token = params.get('token');
try { token ||= localStorage.getItem('wdmtg-token'); } catch { /* private mode */ }

async function api(path, body) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw Object.assign(new Error((await res.json().catch(() => ({}))).error || res.statusText), { status: res.status });
  return res.json();
}

// ---------- tooltip ----------
const tip = document.getElementById('tip');
function showTip(evt, ...content) {
  tip.replaceChildren(...content);
  tip.hidden = false;
  const pt = evt.touches?.[0] || evt;
  const anchor = pt.clientX != null && (pt.clientX || pt.clientY) ? { x: pt.clientX, y: pt.clientY } : (() => { const r = evt.currentTarget.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top }; })();
  const r = tip.getBoundingClientRect();
  tip.style.left = Math.max(8, Math.min(window.innerWidth - r.width - 8, anchor.x - r.width / 2)) + 'px';
  tip.style.top = (anchor.y - r.height - 12 < 8 ? anchor.y + 18 : anchor.y - r.height - 12) + 'px';
}
const hideTip = () => { tip.hidden = true; };
function withTip(el, make) {
  el.addEventListener('pointermove', (e) => showTip(e, ...make()));
  el.addEventListener('pointerleave', hideTip);
  el.addEventListener('focus', (e) => showTip(e, ...make()));
  el.addEventListener('blur', hideTip);
  return el;
}

// ---------- state ----------
const state = { view: location.hash === '#setup' ? 'setup' : 'today', date: today(), status: null, open: new Set() };
const main = document.getElementById('main');

async function setRule(keys, bucket) {
  for (const key of [].concat(keys)) await api('/api/rule', { key, bucket });
  render();
}

function picker(key, current) {
  return h('div', { class: 'pick', role: 'group', 'aria-label': 'Where does this belong?' },
    BUCKETS.map((b) => h('button', { class: `b-${b}`, 'aria-pressed': String(current === b), onclick: () => setRule(key, b) }, SHORT[b])),
    current && current !== 'unsorted' && h('button', { class: 'clear', onclick: () => setRule(key, null) }, 'Reset'));
}

function stepper(label, onStep, canForward) {
  return h('div', { class: 'when' },
    h('button', { 'aria-label': 'Earlier', onclick: () => onStep(-1) }, '‹'),
    h('span', { class: 'date' }, label),
    h('button', { 'aria-label': 'Later', disabled: !canForward, onclick: () => onStep(1) }, '›'),
    state.status?.demo && h('span', { class: 'pill' }, 'Sample data'),
    state.status?.paused && h('span', { class: 'pill' }, 'Tracking paused'));
}

// "Out of 16h awake, 2h 09m went to making money (13%) and 3h 03m was lost (19%)."
function verdict(d) {
  if (d.awakeMs < 5 * MIN) return h('p', { class: 'verdict' }, d.headline);
  return h('p', { class: 'verdict' },
    `Out of ${fmt(d.awakeMs)} awake, `,
    `${fmt(d.totals.money)} made money and ${fmt(d.totals.lost)} was lost.`);
}

function tape(d) {
  const span = d.to - d.from;
  const pos = (ms) => ((ms - d.from) / span) * 100;
  const bar = h('div', { class: 'tape', role: 'img', 'aria-label': 'Your day from midnight to midnight, coloured by where the time went' });
  for (const r of d.timeline) {
    const seg = h('i', { class: `b-${r.b}`, style: `left:${pos(r.s)}%;width:${pos(r.e) - pos(r.s)}%` });
    withTip(seg, () => [
      h('b', null, `${clock(r.s)} to ${clock(r.e)}`),
      h('span', { class: `dot b-${r.b}` }, `${NAMES[r.b]}, ${fmt(r.e - r.s)}`),
      r.b !== 'away' && r.b !== 'sleep' && r.b !== 'untracked' && h('span', null, r.n.join(', ')),
    ]);
    bar.append(seg);
  }
  if (d.now < d.to) bar.append(h('span', { class: 'now', style: `left:${pos(d.now)}%` }));
  const hours = h('div', { class: 'hours', 'aria-hidden': 'true' },
    [0, 3, 6, 9, 12, 15, 18, 21].map((hr) => h('span', { style: `left:${(hr / 24) * 100}%` }, hr === 0 ? '12am' : hr === 12 ? '12pm' : hr < 12 ? `${hr}am` : `${hr - 12}pm`)));
  const used = ['money', 'life', 'busy', 'lost', 'unsorted', 'away', 'sleep'].filter((b) => d.totals[b] > 0);
  return h('div', { class: 'tape-wrap' }, bar, hours,
    h('ul', { class: 'legend' }, used.map((b) => h('li', { class: `b-${b}` }, NAMES[b]))));
}

function split(d, of = 'your day') {
  const awake = Math.max(1, d.awakeMs);
  return h('div', { class: 'split' }, BUCKETS.map((b) =>
    h('div', { class: `b-${b}` },
      h('h3', null, NAMES[b]),
      h('div', { class: 'big' }, fmt(d.totals[b])),
      h('div', { class: 'share' }, `${Math.round((d.totals[b] / awake) * 100)}% of ${of}. ${HELP[b]}.`),
      h('div', { class: 'meter' }, h('b', { style: `width:${(d.totals[b] / awake) * 100}%` })))));
}

function devices(d) {
  const { mac, iphone, calls } = d.devices;
  const bits = [];
  if (mac.activeMs || mac.openIdleMs) bits.push(h('span', null, 'Laptop: ', h('b', null, fmt(mac.activeMs)), ' in use', mac.openIdleMs >= MIN ? [', ', h('b', null, fmt(mac.openIdleMs)), ' open with nobody at it'] : null, '. '));
  if (iphone.activeMs) bits.push(h('span', null, 'iPhone: ', h('b', null, fmt(iphone.activeMs)), ` in your hand, picked up ${iphone.pickups} times. `));
  if (calls.ms) bits.push(h('span', null, 'Calls: ', h('b', null, fmt(calls.ms)), ` across ${calls.count}. `));
  if (d.totals.away >= MIN) bits.push(h('span', null, 'Off every screen: ', h('b', null, fmt(d.totals.away)), '. '));
  if (d.totals.unsorted >= MIN) bits.push(h('span', null, 'Not sorted yet: ', h('b', null, fmt(d.totals.unsorted)), '. '));
  return bits.length ? h('p', { class: 'aside' }, bits) : null;
}

function leaks(d, emptyText) {
  if (!d.leaks.length) return h('div', { class: 'panel empty' }, emptyText);
  return h('ol', { class: 'panel leaks' }, d.leaks.map((l) =>
    h('li', null,
      h('div', { class: l.ms ? 'amt' : 'amt none' }, l.ms ? fmt(l.ms) : 'Pattern'),
      h('div', null,
        h('h3', null, l.title),
        h('p', null, l.detail),
        l.fix && h('p', { class: 'fix' }, l.fix, l.action === 'sort' && [' ', h('button', { class: 'link', onclick: () => go('sort') }, 'Sort now')])))));
}

function rows(items, { max, sortable = true, labels = true } = {}) {
  const top = max ?? Math.max(1, ...items.map((i) => i.ms));
  return h('ul', { class: 'rows' }, items.map((it) => {
    const open = state.open.has(it.key);
    const canSort = sortable && it.kind !== 'manual';
    return h('li', { class: `b-${it.bucket}` },
      h('span', { class: 'name' }, it.name,
        labels && it.label && h('span', { class: 'meta' }, it.label),
        canSort && h('button', { class: `chip dot b-${it.bucket}`, 'aria-expanded': String(open), title: 'Change where this belongs', onclick: () => { open ? state.open.delete(it.key) : state.open.add(it.key); render(); } }, SHORT[it.bucket] || 'Sort')),
      h('span', { class: 'ms' }, fmt(it.ms)),
      h('span', { class: 'track' }, h('b', { style: `width:${(it.ms / top) * 100}%` })),
      open && canSort && picker(it.keys || it.key, it.bucket));
  }));
}

function gaps(d) {
  if (!d.gaps?.length) return null;
  return [
    h('h2', null, 'Time off every screen', h('small', null, 'Tell me what it was')),
    h('ul', { class: 'panel leaks gaps' }, d.gaps.map((g) => {
      const input = h('input', { type: 'text', placeholder: 'Showing, gym, family...', 'aria-label': 'What were you doing?', maxlength: 60 });
      const save = async (bucket) => {
        await api('/api/manual', { start: g.start, end: g.end, title: input.value.trim() || NAMES[bucket], bucket });
        render();
      };
      return h('li', null,
        h('div', { class: 'q' }, `${clock(g.start)} to ${clock(g.end)}`, h('span', null, fmt(g.end - g.start))),
        h('form', { onsubmit: (e) => e.preventDefault() }, input,
          h('div', { class: 'pick' }, BUCKETS.map((b) => h('button', { type: 'button', class: `b-${b}`, onclick: () => save(b) }, SHORT[b])))));
    })),
  ];
}

// ---------- views ----------
async function viewToday() {
  const d = await api(`/api/day?date=${state.date}`);
  const isToday = state.date === today();
  return [
    stepper(longDate(state.date), (n) => { state.date = shift(state.date, n); render(); }, !isToday),
    verdict(d),
    h('p', { class: 'sub' }, d.awakeMs < 5 * MIN ? 'Leave the app running. Your day fills in here as it happens.' : 'Every second of the day, on one line. Hover any block to see what it was.'),
    tape(d),
    split(d),
    devices(d),
    h('h2', null, 'Where the time leaked', d.leaks.length ? h('small', null, 'Biggest first') : null),
    leaks(d, d.awakeMs < 30 * MIN ? 'Not enough tracked yet to call anything a leak.' : 'No leaks worth mentioning. Good day.'),
    h('div', { class: 'two' },
      h('div', null, h('h2', null, 'What you spent it on'), d.top.length ? h('div', { class: 'panel' }, rows(d.top.slice(0, 12))) : h('div', { class: 'panel empty' }, 'Nothing yet.')),
      h('div', null, h('h2', null, 'Who you were on the phone with'), d.calls.length ? h('div', { class: 'panel' }, rows(d.calls, { labels: false })) : h('div', { class: 'panel empty' }, isToday ? 'No calls yet today.' : 'No calls that day.'))),
    gaps(d),
  ];
}

function weekChart(w) {
  const order = ['money', 'life', 'busy', 'lost', 'unsorted', 'away'];
  const awake = (t) => order.reduce((n, b) => n + t[b], 0);
  const max = Math.max(8 * HOUR, ...w.days.map((d) => awake(d.totals)));
  const top = Math.ceil(max / (4 * HOUR)) * 4 * HOUR;
  const ticks = [];
  for (let t = 0; t <= top; t += 4 * HOUR) ticks.push(t);
  const cols = h('div', { class: 'cols' },
    h('div', { class: 'axis', 'aria-hidden': 'true' }, ticks.map((t) => h('span', { style: `bottom:${(t / top) * 100}%` }, `${t / HOUR}h`))),
    ticks.map((t) => h('div', { class: 'grid', style: `bottom:${(t / top) * 100}%` })),
    w.days.map((day) => {
      const col = h('button', { class: 'col', 'aria-label': `${longDate(day.date)}. Open this day.`, onclick: () => { state.date = day.date; go('today'); } },
        order.filter((b) => day.totals[b] >= MIN).map((b) => h('span', { class: `seg b-${b}`, style: `height:${(day.totals[b] / top) * 100}%` })));
      return withTip(col, () => [
        h('b', null, parse(day.date).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })),
        ...order.filter((b) => day.totals[b] >= MIN).map((b) => h('span', { class: `dot b-${b}` }, `${NAMES[b]}: ${fmt(day.totals[b])}`)),
      ]);
    }));
  const days = h('div', { class: 'days' }, h('span'), w.days.map((day) =>
    h('span', null, h('b', null, parse(day.date).toLocaleDateString([], { weekday: 'short' })), day.totals.money >= MIN ? fmt(day.totals.money) : '')));
  return h('div', { class: 'panel week' }, cols, days,
    h('ul', { class: 'legend' }, order.map((b) => h('li', { class: `b-${b}` }, NAMES[b]))),
    h('p', { class: 'aside' }, 'The time under each day is what went to making money. Click a day to open it.'));
}

async function viewWeek() {
  const w = await api(`/api/week?end=${state.date}`);
  const label = `${parse(w.startDate).toLocaleDateString([], { month: 'short', day: 'numeric' })} to ${parse(w.endDate).toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
  return [
    stepper(label, (n) => { state.date = shift(state.date, 7 * n); if (state.date > today()) state.date = today(); render(); }, state.date < today()),
    verdict(w),
    h('p', { class: 'sub' }, `Seven days ending ${longDate(w.endDate).toLowerCase()}. ${w.daysTracked} of them have data.`),
    weekChart(w),
    split(w, 'your waking week'),
    devices(w),
    h('h2', null, 'Where the week leaked', w.leaks.length ? h('small', null, 'Biggest first') : null),
    leaks(w, 'Not enough tracked yet to call anything a leak.'),
    h('div', { class: 'two' },
      h('div', null, h('h2', null, 'What you spent it on'), w.top.length ? h('div', { class: 'panel' }, rows(w.top)) : h('div', { class: 'panel empty' }, 'Nothing yet.')),
      h('div', null, h('h2', null, 'Who you were on the phone with'), w.calls.length ? h('div', { class: 'panel' }, rows(w.calls, { labels: false })) : h('div', { class: 'panel empty' }, 'No calls this week.'))),
  ];
}

async function viewSort() {
  const w = await api(`/api/week?end=${today()}`);
  const sorted = w.top.filter((t) => t.bucket !== 'unsorted' && t.kind !== 'manual');
  const item = (it) => h('li', { class: `b-${it.bucket}` },
    h('span', { class: 'name' }, it.name, h('span', { class: 'meta' }, it.kind === 'person' ? 'Phone calls' : it.kind === 'site' ? 'Website' : it.kind === 'place' ? 'Place' : it.kind === 'activity' ? 'Activity' : 'App')),
    h('span', { class: 'ms' }, fmt(it.ms)),
    picker(it.keys || it.key, it.bucket));
  return [
    h('p', { class: 'verdict' }, w.unsorted.length ? `${w.unsorted.length} things need a home.` : 'Everything is sorted.'),
    h('p', { class: 'sub' }, 'One tap each. Ask yourself: did this make money, was it busywork, was it life, or was it lost? Your answer applies to past and future time.'),
    w.unsorted.length ? h('ul', { class: 'panel rows' }, w.unsorted.map(item)) : null,
    h('h2', null, 'Already sorted', h('small', null, 'Change any guess that is wrong for you')),
    sorted.length ? h('ul', { class: 'panel rows' }, sorted.map(item)) : h('div', { class: 'panel empty' }, 'Nothing here yet.'),
  ];
}

function step(mark, title, state_, ...body) {
  const sym = { ok: '✓', todo: '!', off: '–' }[mark];
  return h('li', null, h('span', { class: `mark ${mark}`, 'aria-hidden': 'true' }, sym), h('div', null, h('h3', null, title), state_ && h('p', { class: 'state' }, state_), body));
}
const act = (label, name, extra = {}, quiet = false) =>
  h('button', { class: quiet ? 'btn quiet' : 'btn', onclick: async (e) => { e.currentTarget.disabled = true; try { await api('/api/action', { name, ...extra }); } catch (err) { alert(err.message); } render(); } }, label);

async function viewSetup() {
  const s = state.status = await api('/api/status');
  let pair = null;
  try { pair = await api('/api/pair'); } catch { /* only available on the computer itself */ }
  const onDesktop = Boolean(pair);
  const mac = s.platform === 'darwin';
  const need = (r) => r && !r.ok && r.reason === 'no-access';
  const items = [];

  items.push(step(s.paused ? 'todo' : s.tracking.on ? 'ok' : s.demo ? 'off' : 'todo', 'This computer',
    s.demo ? 'Showing sample data.' : s.paused ? 'Paused.' : s.tracking.on ? `Tracking. Right now: ${s.tracking.app || 'nothing in front'}${s.tracking.idleSec >= 120 ? ' (nobody at the keyboard)' : ''}.` : 'Not tracking.',
    h('p', null, 'Checks once a second which app and window is in front, and whether you touched the keyboard or mouse in the last 2 minutes. No keystrokes, no screenshots. Everything stays on this computer.'),
    onDesktop && !s.demo && act(s.paused ? 'Resume tracking' : 'Pause tracking', 'pause', { paused: !s.paused }, true)));

  if (!s.demo && mac) {
    items.push(step(s.tracking.titles ? 'ok' : 'todo', 'See which page or document, not just which app',
      s.tracking.titles ? 'Working.' : 'Needs two permissions.',
      !s.tracking.titles && [
        h('p', null, 'Without this I only know "Chrome", not "Zillow" or "YouTube". Turn on WDMTG in both lists, then quit and reopen the app.'),
        onDesktop && act('Open Screen Recording', 'open-settings', { pane: 'screen' }),
        onDesktop && act('Open Accessibility', 'open-settings', { pane: 'accessibility' }),
      ],
      h('p', null, 'The first time you use each browser, macOS asks whether WDMTG may control it. Click Allow. That is how I read the address of the page you are on.')));

    const ip = s.iphone;
    const ipOk = ip?.ok && ip.devices?.some((d) => d.intervals > 0);
    items.push(step(ipOk ? 'ok' : 'todo', 'iPhone app usage',
      ipOk ? `Working. ${ip.devices.map((d) => d.name).join(', ')}. Latest data: ${ago(s.iphoneLatest)}.`
        : need(ip) ? 'Needs Full Disk Access.' : ip?.ok ? 'Connected, but your iPhone has not shared anything yet.' : 'Not set up yet.',
      !ipOk && [
        h('p', null, 'Apple does not let any iPhone app see your other apps. But your iPhone can share its Screen Time with this Mac through iCloud, and I can read it here.'),
        h('ol', null,
          h('li', null, 'On your iPhone: Settings, Screen Time, turn on Share Across Devices.'),
          h('li', null, 'On this Mac: System Settings, Screen Time, turn on Share Across Devices (same Apple Account).'),
          h('li', null, 'On this Mac: System Settings, Privacy & Security, Full Disk Access, turn on WDMTG. Then quit and reopen the app.'),
          h('li', null, 'Give it up to an hour the first time. Apple syncs on its own schedule.')),
        onDesktop && act('Open Full Disk Access', 'open-settings', { pane: 'disk' }),
      ],
      ipOk && h('p', null, 'Apple syncs phone usage to the Mac every so often, so the phone can run an hour or two behind.')));

    const c = s.calls;
    const callsOk = c?.ok && c.imported > 0;
    items.push(step(callsOk && c.hasKey ? 'ok' : 'todo', 'Phone calls: who and how long',
      callsOk ? `${c.imported} calls found. Latest: ${ago(s.callsLatest)}.${c.hasKey ? '' : ' Names are still locked.'}`
        : need(c) ? 'Needs Full Disk Access (same switch as above).' : c?.ok ? 'Connected, no calls found yet.' : 'Not set up yet.',
      h('p', null, 'Your iPhone call history syncs to this Mac through iCloud. Call lengths work with Full Disk Access. To see who each call was with, macOS will ask for your Mac password once, because the numbers are locked with a key in your keychain. Choose Always Allow.'),
      onDesktop && !c?.hasKey && act('Unlock caller names', 'connect-calls')));
  }

  if (!s.demo && !mac && onDesktop) {
    items.push(step('off', 'iPhone app usage and call history', 'Mac only.',
      h('p', null, 'Apple only shares iPhone Screen Time and call history with a Mac signed in to the same Apple Account. On Windows I track this computer, plus anything you log from the phone.')));
  }

  if (onDesktop) {
    const p = s.phoneApp;
    items.push(step(p ? 'ok' : 'off', 'Your phone',
      p ? `${p.device} last synced ${ago(p.at)}.` : 'Optional.',
      pair.url ? [
        h('p', null, 'Point your iPhone camera at this code while on the same Wi-Fi. It opens this dashboard on your phone. With the WDMTG iPhone app installed, the page offers to connect it too, so your drives and off-screen time get logged.'),
        h('div', { class: 'qr', html: pair.qr }),
        h('p', null, 'Or type this into Safari on your phone: ', h('code', null, pair.url)),
      ] : h('p', null, 'Connect this computer to Wi-Fi to pair your phone.')));

    if (!s.demo) {
      items.push(step(s.autoLaunch ? 'ok' : 'todo', 'Start when you log in', s.autoLaunch ? 'On.' : 'Off. Tracking stops whenever the app is not running.',
        act(s.autoLaunch ? 'Turn off' : 'Turn on', 'autolaunch', { on: !s.autoLaunch }, s.autoLaunch)));
      items.push(step('off', 'Refresh', `Last checked iPhone and calls: ${ago(s.lastSync)}.`, act('Check now', 'sync', {}, true)));
    }
  } else if (token) {
    const link = `wdmtg://pair?host=${location.hostname}&port=${location.port || 80}&token=${token}`;
    items.push(step('off', 'Connect the iPhone app', 'Optional.',
      h('p', null, 'If you installed the WDMTG iPhone app, tap below to connect it to this computer. It logs your drives and lets you say what you were doing off screen.'),
      h('a', { class: 'btn', href: link, style: 'display:inline-block;text-decoration:none' }, 'Connect the iPhone app')));
  }

  return [
    h('p', { class: 'verdict' }, 'Setup'),
    h('p', { class: 'sub' }, 'The more of these are green, the fewer blind spots in your day.'),
    h('ul', { class: 'panel steps' }, items),
  ];
}

// ---------- shell ----------
const VIEWS = { today: viewToday, week: viewWeek, sort: viewSort, setup: viewSetup };
let renderSeq = 0;

async function render() {
  const seq = ++renderSeq;
  hideTip();
  for (const b of document.querySelectorAll('.tabs button')) {
    if (b.dataset.view === state.view) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  try {
    state.status ??= await api('/api/status');
    const content = await VIEWS[state.view]();
    if (seq !== renderSeq) return;
    const y = window.scrollY;
    main.replaceChildren(...content.flat(Infinity).filter(Boolean));
    window.scrollTo(0, y);
    refreshCount();
  } catch (err) {
    if (seq !== renderSeq) return;
    main.replaceChildren(
      h('p', { class: 'verdict' }, err.status === 401 ? 'This phone is not paired yet.' : 'Cannot reach the app.'),
      h('p', { class: 'sub' }, err.status === 401 ? 'Open WDMTG on your computer, go to Setup, and scan the code under "Your phone".' : 'Make sure WDMTG is running on your computer and you are on the same Wi-Fi.'));
  }
}

async function refreshCount() {
  try {
    const w = await api(`/api/week?end=${today()}`);
    const badge = document.getElementById('sort-count');
    badge.hidden = !w.unsorted.length;
    badge.textContent = w.unsorted.length;
  } catch { /* cosmetic */ }
}

function go(view) {
  state.view = view;
  state.open.clear();
  window.scrollTo(0, 0);
  render();
}

for (const b of document.querySelectorAll('.tabs button')) b.addEventListener('click', () => go(b.dataset.view));
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
setInterval(() => {
  // Keep today fresh, but never while you are typing or picking something.
  const busy = state.open.size || ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);
  if (!document.hidden && !busy && (state.view === 'today' || state.view === 'setup')) render();
}, 60_000);
render();
