// Turns bundle ids like "com.burbn.instagram" into names people recognise.
import { execFile } from 'node:child_process';
import path from 'node:path';
import { IOS_NAMES } from './rules-default.js';

const known = new Map(Object.entries(IOS_NAMES).map(([k, v]) => [k.toLowerCase(), v]));

function macName(bundle) {
  if (process.platform !== 'darwin' || !/^[\w.-]+$/.test(bundle)) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile('/usr/bin/mdfind', [`kMDItemCFBundleIdentifier == '${bundle}'`], { timeout: 5000 }, (err, stdout) => {
      const first = (stdout || '').split('\n').find((l) => l.endsWith('.app'));
      resolve(err || !first ? null : path.basename(first, '.app'));
    });
  });
}

/** Apple's public App Store lookup. Sends only the app's id, nothing about you. */
async function storeName(bundle) {
  try {
    const res = await fetch(`https://itunes.apple.com/lookup?bundleId=${encodeURIComponent(bundle)}`, { signal: AbortSignal.timeout(8000) });
    const body = await res.json();
    const name = body?.results?.[0]?.trackName;
    // "Instagram: Photos & Reels" -> "Instagram"
    return name ? name.split(/\s[:\-–—|]\s|:\s/)[0].trim() : null;
  } catch {
    return null;
  }
}

/** Fill in names for segments that only have a bundle id. */
export async function fillNames(store, { online = true, limit = 40 } = {}) {
  const rows = store.db
    .prepare(
      `SELECT bundle, source, SUM(end - start) AS ms FROM segments
       WHERE bundle IS NOT NULL AND source IN ('iphone', 'mac-history')
         AND bundle NOT IN (SELECT id FROM names)
       GROUP BY bundle ORDER BY ms DESC LIMIT ?`
    )
    .all(limit);
  let filled = 0;
  for (const { bundle, source } of rows) {
    let name = known.get(bundle.toLowerCase()) || null;
    if (!name && source === 'mac-history') name = await macName(bundle);
    if (!name && online && !bundle.startsWith('com.apple.')) name = await storeName(bundle);
    // Remember misses too (as the id) so we do not ask again every time.
    store.setName(bundle, name || bundle);
    if (name) {
      store.db.prepare("UPDATE segments SET app = ? WHERE bundle = ? AND source IN ('iphone', 'mac-history')").run(name, bundle);
      filled++;
    }
  }
  return filled;
}
