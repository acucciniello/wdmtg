// Which window is in front right now. macOS needs two permissions (Screen
// Recording and Accessibility) to see window titles and browser addresses;
// without them we still get the app name.
import path from 'node:path';

export const windowStatus = { titles: null, error: null };

/**
 * @param {() => boolean} [hasAccess]  true when the permissions are granted. When it
 *   says no we do not even try the full lookup, so macOS does not nag with prompts.
 */
export function makeSampler(hasAccess = () => true) {
  let lib = null;
  let retryAt = 0;
  return async function sampleActiveWindow() {
    lib ??= await import('get-windows');
    let w;
    let full = false;
    const now = Date.now();
    if (hasAccess() && now >= retryAt) {
      try {
        w = await lib.activeWindow();
        full = true;
        windowStatus.titles = true;
        windowStatus.error = null;
      } catch (err) {
        windowStatus.titles = false;
        windowStatus.error = String(err?.stderr || err?.message || err).trim().slice(0, 300);
        retryAt = now + 30_000;
      }
    } else if (!hasAccess()) {
      windowStatus.titles = false;
    }
    if (!full) w = await lib.activeWindow({ accessibilityPermission: false, screenRecordingPermission: false });
    if (!w) return null;
    const owner = w.owner || {};
    return {
      app: owner.name || (owner.path ? path.basename(owner.path) : 'Unknown'),
      bundle: owner.bundleId || (owner.path ? path.basename(owner.path).toLowerCase() : null),
      title: w.title || null,
      url: w.url || null,
    };
  };
}
