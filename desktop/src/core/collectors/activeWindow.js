// Which window is in front right now. macOS needs two permissions to see window
// titles and browser addresses; without them we still get the app name.
import path from 'node:path';

let lib = null;
let fullAccessRetryAt = 0;
export const windowStatus = { titles: null, error: null };

export async function sampleActiveWindow() {
  lib ??= await import('get-windows');
  let w;
  const now = Date.now();
  if (now >= fullAccessRetryAt) {
    try {
      w = await lib.activeWindow();
      windowStatus.titles = true;
      windowStatus.error = null;
    } catch (err) {
      // Usually a missing permission. Fall back to app name only, try again in a bit.
      windowStatus.titles = false;
      windowStatus.error = String(err?.stderr || err?.message || err).trim().slice(0, 300);
      fullAccessRetryAt = now + 30_000;
    }
  }
  if (w === undefined && windowStatus.titles === false) {
    w = await lib.activeWindow({ accessibilityPermission: false, screenRecordingPermission: false });
  }
  if (!w) return null;
  const owner = w.owner || {};
  return {
    app: owner.name || (owner.path ? path.basename(owner.path) : 'Unknown'),
    bundle: owner.bundleId || (owner.path ? path.basename(owner.path).toLowerCase() : null),
    title: w.title || null,
    url: w.url || null,
  };
}
