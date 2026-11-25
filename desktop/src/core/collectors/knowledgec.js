// This Mac's own app history from before WDMTG was installed, so the first
// report is not empty. Source: Screen Time's knowledgeC.db (needs Full Disk Access).
import os from 'node:os';
import path from 'node:path';
import { withCopy, appleToMs } from './sqlcopy.js';

const QUERY = `
SELECT o.ZVALUESTRING AS bundle, o.ZSTARTDATE AS start, o.ZENDDATE AS end
FROM ZOBJECT o
LEFT JOIN ZSOURCE s ON s.Z_PK = o.ZSOURCE
WHERE o.ZSTREAMNAME = '/app/usage' AND s.ZDEVICEID IS NULL AND o.ZENDDATE > o.ZSTARTDATE
ORDER BY o.ZSTARTDATE`;

export function importMacHistory(store, {
  file = path.join(os.homedir(), 'Library/Application Support/Knowledge/knowledgeC.db'),
  before = Date.now(),
  device = 'Mac',
} = {}) {
  let rows;
  try {
    rows = withCopy(file, (db) => db.prepare(QUERY).all());
  } catch (err) {
    const reason = err.code === 'ENOENT' ? 'not-found' : err.code === 'EPERM' || err.code === 'EACCES' ? 'no-access' : 'error';
    return { ok: false, reason, imported: 0, detail: String(err.message || err) };
  }
  const segs = [];
  for (const r of rows) {
    const start = appleToMs(r.start);
    const end = Math.min(appleToMs(r.end), before);
    if (!r.bundle || end <= start) continue;
    segs.push({
      source: 'mac-history',
      device,
      start,
      end,
      app: store.name(r.bundle),
      bundle: r.bundle,
      extId: `kc:${Math.round(r.start * 1000)}:${r.bundle}`,
    });
  }
  return { ok: true, imported: store.upsertMany(segs) };
}
