// Decides which bucket a slice of time belongs to.
import { APP_RULES, SITE_RULES, BROWSERS, TITLE_HINTS, IOS_NAMES } from './rules-default.js';

export const BUCKETS = ['money', 'busy', 'life', 'lost'];
export const BUCKET_NAMES = {
  money: 'Making money',
  busy: 'Busywork',
  life: 'Life',
  lost: 'Lost',
  unsorted: 'Not sorted yet',
  away: 'Off screens',
  sleep: 'Asleep',
  untracked: 'Not tracked',
};

const SITE_NAMES = {
  'docs.google.com/spreadsheets': 'Google Sheets', 'mail.google.com': 'Gmail', 'studio.youtube.com': 'YouTube Studio',
  'calendar.google.com': 'Google Calendar', 'drive.google.com': 'Google Drive', 'meet.google.com': 'Google Meet',
  'x.com': 'X', 'qbo.intuit.com': 'QuickBooks', 'quickbooks.intuit.com': 'QuickBooks', 'web.whatsapp.com': 'WhatsApp Web',
  'youtube.com': 'YouTube', 'instagram.com': 'Instagram', 'tiktok.com': 'TikTok', 'facebook.com': 'Facebook',
  'reddit.com': 'Reddit', 'linkedin.com': 'LinkedIn', 'netflix.com': 'Netflix', 'amazon.com': 'Amazon',
  'zillow.com': 'Zillow', 'redfin.com': 'Redfin', 'propstream.com': 'PropStream', 'pandadoc.com': 'PandaDoc',
  'canva.com': 'Canva', 'kajabi.com': 'Kajabi', 'slack.com': 'Slack', 'zoom.us': 'Zoom', 'espn.com': 'ESPN',
  'apartments.com/rental-manager': 'Apartments.com Rental Manager', 'news.ycombinator.com': 'Hacker News',
};

const lc = (s) => (s || '').toLowerCase();
const browserSet = new Set(BROWSERS);
const iosNames = new Map(Object.entries(IOS_NAMES).map(([k, v]) => [lc(k), v]));

// Index default app rules: ids (contain a dot) match by prefix, names match exactly.
const appExact = new Map();
const appPrefix = [];
for (const rule of APP_RULES) {
  const p = lc(rule.pattern);
  if (!appExact.has(p)) appExact.set(p, rule);
  if (p.includes('.')) appPrefix.push([p, rule]);
}
appPrefix.sort((a, b) => b[0].length - a[0].length);

const siteRules = SITE_RULES.map((rule) => {
  const [host, ...rest] = lc(rule.pattern).split('/');
  return { ...rule, host, path: rest.length ? '/' + rest.join('/') : '' };
}).sort((a, b) => b.pattern.length - a.pattern.length);

export function isBrowser(seg) {
  return browserSet.has(lc(seg.bundle)) || browserSet.has(lc(seg.app));
}

/** "https://www.zillow.com/homes/x" -> { host: "zillow.com", path: "/homes/x" } */
export function parseUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url.includes('://') ? url : 'https://' + url);
    if (!u.hostname.includes('.')) return null;
    return { host: lc(u.hostname).replace(/^www\./, ''), path: u.pathname || '/' };
  } catch {
    return null;
  }
}

function matchSite(host, path) {
  for (const rule of siteRules) {
    const hostOk = host === rule.host || host.endsWith('.' + rule.host);
    if (hostOk && (!rule.path || path.startsWith(rule.path))) return rule;
  }
  return null;
}

function siteFromTitle(title) {
  const t = lc(title);
  if (!t) return null;
  for (const [hint, site] of TITLE_HINTS) {
    if (t.includes(hint)) return parseUrl(site);
  }
  return null;
}

function matchApp(bundle, app) {
  const b = lc(bundle);
  const a = lc(app);
  if (b && appExact.has(b)) return appExact.get(b);
  if (b) for (const [p, rule] of appPrefix) if (b.startsWith(p + '.')) return rule;
  if (a && appExact.has(a)) return appExact.get(a);
  return null;
}

/** Nice display name for an app when all we have is an id. */
export function prettyName(bundle, app) {
  if (app && app !== bundle) return app;
  const known = iosNames.get(lc(bundle));
  if (known) return known;
  if (!bundle) return 'Unknown';
  const last = bundle.split('.').filter(Boolean).pop() || bundle;
  return last.charAt(0).toUpperCase() + last.slice(1);
}

/**
 * Classify one segment.
 * @returns {{key:string,name:string,bucket:string,label:string|null,passive:boolean,kind:string}}
 */
export function classify(seg, userRules) {
  const out = (key, name, kind, def) => {
    const user = userRules?.get(key);
    return {
      key,
      name,
      kind,
      bucket: user?.bucket || def?.bucket || 'unsorted',
      label: user?.label || def?.label || null,
      passive: Boolean(def?.passive),
    };
  };

  switch (seg.source) {
    case 'call': {
      const who = seg.title || 'Unknown caller';
      return out('person:' + lc(who), who, 'person', { bucket: 'unsorted', label: 'Phone calls' });
    }
    case 'manual': {
      const what = seg.title || 'Logged activity';
      return out('manual:' + lc(what), what, 'manual', { bucket: seg.bucket || 'unsorted', label: 'Logged by you' });
    }
    case 'motion': {
      const what = seg.title || 'Driving';
      return out('activity:' + lc(what), what, 'activity', { bucket: 'busy', label: what });
    }
    case 'place': {
      const where = seg.title || 'Somewhere';
      return out('place:' + lc(where), where, 'place', { bucket: 'unsorted', label: 'Places' });
    }
    default:
  }

  if (isBrowser(seg)) {
    const site = parseUrl(seg.url) || siteFromTitle(seg.title);
    if (site) {
      const rule = matchSite(site.host, site.path);
      const key = 'site:' + (rule ? rule.pattern : site.host);
      const name = rule ? SITE_NAMES[rule.pattern] || rule.pattern : site.host;
      return out(key, name, 'site', rule);
    }
    const name = prettyName(seg.bundle, seg.app);
    return out('app:' + lc(seg.bundle || seg.app), name, 'app', null);
  }

  const rule = matchApp(seg.bundle, seg.app);
  return out('app:' + lc(seg.bundle || seg.app || 'unknown'), prettyName(seg.bundle, seg.app), 'app', rule);
}

/** Is it normal to sit still in this app (video, calls)? Used by the tracker. */
export function isPassive(sample, userRules) {
  return classify({ source: 'mac', ...sample }, userRules).passive;
}
