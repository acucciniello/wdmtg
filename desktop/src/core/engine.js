// Ties everything together: live tracking on this computer plus periodic
// imports of iPhone usage and call history. Used by the Electron app and by
// the plain-Node dev server.
import os from 'node:os';
import { Tracker } from './tracker.js';
import { isPassive } from './rules.js';
import { importBiome } from './collectors/biome.js';
import { importMacHistory } from './collectors/knowledgec.js';
import { importCalls, loadContacts, fetchCallKey } from './collectors/calls.js';
import { fillNames } from './appnames.js';

export class Engine {
  constructor({ store, sample = null, idleSeconds = () => 0, windowStatus = {}, demo = false, version = '0.0.0' }) {
    Object.assign(this, { store, sample, idleSeconds, windowStatus, demo, version });
    this.isMac = process.platform === 'darwin';
    this.paused = false;
    this.sources = { iphone: null, calls: null, history: null };
    this.callKey = null;
    this.lastSync = null;
    this.syncing = null;
    if (!store.get('installed_at')) store.set('installed_at', Date.now());
    let rulesCache = null;
    let rulesAt = 0;
    const rules = () => {
      if (Date.now() - rulesAt > 10_000) {
        rulesCache = store.rules();
        rulesAt = Date.now();
      }
      return rulesCache;
    };
    this.tracker = sample
      ? new Tracker({
          store,
          sample,
          idleSeconds,
          device: os.hostname().replace(/\.local$/, ''),
          isPassive: (win) => isPassive(win, rules()),
        })
      : null;
  }

  start() {
    this.tracker?.start(1000);
    if (this.demo) return;
    this.sync();
    this.syncTimer = setInterval(() => this.sync(), 5 * 60_000);
    this.syncTimer.unref?.();
  }

  stop() {
    clearInterval(this.syncTimer);
    this.tracker?.stop();
  }

  setPaused(paused) {
    this.paused = paused;
    if (!this.tracker) return;
    if (paused) this.tracker.stop();
    else this.tracker.start(1000);
  }

  /** Screen locked or lid closed: close the open segment right now. */
  interrupt() {
    this.tracker?.pause(Date.now());
  }

  /** Pull in iPhone usage, call history and (once) this Mac's past history. */
  sync() {
    if (this.demo) return Promise.resolve(this.sources);
    this.syncing ??= this.#sync().finally(() => (this.syncing = null));
    return this.syncing;
  }

  async #sync() {
    const { store } = this;
    if (this.isMac) {
      try {
        this.sources.iphone = importBiome(store);
      } catch (err) {
        this.sources.iphone = { ok: false, reason: 'error', detail: String(err.message || err) };
      }
      try {
        if (this.callKey === null && store.get('calls_connected')) this.callKey = (await fetchCallKey()) || false;
        // Contacts rarely change: re-read them at most once an hour.
        if (!this.contacts || Date.now() - this.contactsAt > 3600_000) {
          this.contacts = loadContacts();
          this.contactsAt = Date.now();
        }
        const contacts = this.contacts;
        this.sources.calls = { ...importCalls(store, { key: this.callKey || null, contacts }), contacts: contacts.size, hasKey: Boolean(this.callKey) };
      } catch (err) {
        this.sources.calls = { ok: false, reason: 'error', detail: String(err.message || err) };
      }
      if (!store.get('history_imported')) {
        this.sources.history = importMacHistory(store, { before: store.get('installed_at') });
        if (this.sources.history.ok) store.set('history_imported', Date.now());
      }
      try {
        await fillNames(store, { online: store.get('lookup_names', true) });
      } catch {
        // names are cosmetic
      }
    }
    this.lastSync = Date.now();
    return this.sources;
  }

  /** The user agreed to let us read the call history key from the keychain. */
  async connectCalls() {
    this.callKey = (await fetchCallKey()) || false;
    if (this.callKey) this.store.set('calls_connected', true);
    await this.sync();
    return Boolean(this.callKey);
  }

  phoneSync(body) {
    const { store } = this;
    const device = String(body.device || 'iPhone').slice(0, 60);
    const ok = (a, b) => Number.isFinite(a) && Number.isFinite(b) && b > a && b - a < 24 * 3600_000;
    const text = (s, max = 80) => (typeof s === 'string' ? s.trim().slice(0, max) : '');
    const rows = [];
    for (const m of Array.isArray(body.motion) ? body.motion.slice(0, 5000) : []) {
      if (m.type !== 'driving' || !ok(m.start, m.end)) continue;
      rows.push({ source: 'motion', device, start: m.start, end: m.end, title: 'Driving', extId: `phone:motion:${Math.round(m.start / 1000)}` });
    }
    for (const m of Array.isArray(body.manual) ? body.manual.slice(0, 2000) : []) {
      if (!ok(m.start, m.end) || !text(m.title)) continue;
      const bucket = ['money', 'busy', 'life', 'lost'].includes(m.bucket) ? m.bucket : null;
      rows.push({ source: 'manual', device, start: m.start, end: m.end, title: text(m.title), bucket, extId: `phone:manual:${text(String(m.id), 64)}` });
    }
    for (const v of Array.isArray(body.visits) ? body.visits.slice(0, 2000) : []) {
      if (!ok(v.start, v.end) || !text(v.name)) continue;
      rows.push({ source: 'place', device, start: v.start, end: v.end, title: text(v.name), extId: `phone:place:${text(String(v.id), 64)}` });
    }
    store.upsertMany(rows);
    store.set('phone_app', { device, at: Date.now(), rows: rows.length });
    return { ok: true, received: rows.length };
  }

  status() {
    const { store, tracker } = this;
    const last = tracker?.lastSample;
    return {
      version: this.version,
      platform: process.platform,
      demo: this.demo,
      paused: this.paused,
      tracking: {
        on: Boolean(tracker?.timer),
        app: last?.app || null,
        idleSec: last?.idleSec ?? null,
        at: last?.at || null,
        titles: this.windowStatus.titles ?? null,
        error: this.windowStatus.error || tracker?.error || null,
      },
      iphone: this.demo ? { ok: true, devices: [{ name: 'iPhone', intervals: store.count('iphone') }] } : this.sources.iphone,
      iphoneLatest: store.latest('iphone'),
      calls: this.demo ? { ok: true, imported: store.count('call'), hasKey: true } : this.sources.calls,
      callsLatest: store.latest('call'),
      history: this.sources.history,
      phoneApp: store.get('phone_app'),
      lastSync: this.lastSync,
      installedAt: store.get('installed_at'),
      ...this.extraStatus?.(),
    };
  }
}
