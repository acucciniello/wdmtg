// Samples the computer once a second and writes what you were doing as segments.
// "Active" means you touched the keyboard or mouse recently. If you did not, the
// time is stored as idle: the laptop was open but nobody was using it.

export class Tracker {
  /**
   * @param {object} o
   * @param {import('./store.js').Store} o.store
   * @param {() => Promise<{app?:string,bundle?:string,title?:string,url?:string}|null>} o.sample  frontmost window
   * @param {() => number} o.idleSeconds  seconds since the last key press or mouse move
   * @param {(win:object) => boolean} [o.isPassive]  true for apps where sitting still is normal
   */
  constructor({
    store,
    sample,
    idleSeconds,
    isPassive = () => false,
    now = Date.now,
    device = 'Mac',
    idleAfter = 120,
    passiveIdleAfter = 30 * 60,
    flushEvery = 5000,
    sleepGap = 15000,
  }) {
    Object.assign(this, { store, sample, idleSeconds, isPassive, now, device, idleAfter, passiveIdleAfter, flushEvery, sleepGap });
    this.cur = null;
    this.lastTick = 0;
    this.lastFlush = 0;
    this.lastSample = null;
    this.error = null;
    this.busy = false;
  }

  start(intervalMs = 1000) {
    this.stopTimer();
    this.timer = setInterval(() => this.tick().catch((err) => (this.error = String(err?.message || err))), intervalMs);
    this.timer.unref?.();
  }

  stopTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  stop() {
    this.stopTimer();
    this.pause();
  }

  /** Close the open segment (screen locked, lid closed, app quitting). */
  pause(at = this.lastTick || this.now()) {
    if (!this.cur) return;
    this.store.setEnd(this.cur.id, Math.max(this.cur.start, Math.min(at, this.now())));
    this.cur = null;
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const t = this.now();
      // The computer was asleep (or frozen): do not stretch the old segment over the hole.
      if (this.cur && this.lastTick && t - this.lastTick > this.sleepGap) this.pause(this.lastTick);
      this.lastTick = t;

      const idleSec = Math.max(0, this.idleSeconds());
      let win;
      try {
        // null means nothing is in front (bare desktop); that time is not counted.
        win = (await this.sample()) || { app: 'No window', bundle: 'wdmtg.none', title: null, url: null };
        this.error = null;
      } catch (err) {
        this.error = String(err?.message || err);
        win = { app: 'Unknown', bundle: null, title: null, url: null };
      }
      this.lastSample = { ...win, idleSec, at: t };

      const limit = this.isPassive(win) ? this.passiveIdleAfter : this.idleAfter;
      const idle = idleSec >= limit;
      const key = [win.bundle || win.app, win.title, win.url, idle].join('\u0001');

      if (this.cur && this.cur.key === key) {
        this.cur.end = t;
        if (t - this.lastFlush >= this.flushEvery) {
          this.store.setEnd(this.cur.id, t);
          this.lastFlush = t;
        }
        return;
      }

      let startAt = t;
      if (this.cur) {
        const wasIdle = this.cur.idle;
        this.pause(t);
        if (idle && !wasIdle) {
          // You stopped a while ago. Everything since your last touch was idle time.
          startAt = Math.max(0, t - idleSec * 1000);
          this.#markIdleSince(startAt, t);
        }
      }
      const seg = {
        source: 'mac',
        device: this.device,
        start: startAt,
        end: t,
        app: win.app || null,
        bundle: win.bundle || null,
        title: win.title || null,
        url: win.url || null,
        idle,
      };
      const id = this.store.add(seg);
      this.cur = { id, key, idle, start: startAt, end: t };
      this.lastFlush = t;
    } finally {
      this.busy = false;
    }
  }

  /** Rewrite the recent past: Mac segments after `since` become idle (one is split if needed). */
  #markIdleSince(since, t) {
    const rows = this.store.range(since, t + 1).filter((s) => s.source === 'mac' && !s.idle && s.device === this.device);
    for (const s of rows) {
      if (s.start >= since) {
        this.store.remove(s.id);
      } else if (s.end > since) {
        this.store.setEnd(s.id, since);
      }
    }
  }
}
