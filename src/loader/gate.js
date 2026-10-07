// The way past the loading wheel. Once the fancy wheel plays ("page loading done") the screen shows
// nothing but the wheel for LOADER.quiet s, and input is ignored. After that each attempt (click,
// tap, Space) has a chance to bring out the menu, as if the game might still need a moment:
// base + perMiss·misses + perSec·(s since it opened), and the `sure`-th attempt always works. An
// attempt only hits once the menu really is loaded.
import { LOADER } from '../config.js';

export function chance(sinceOpen, misses, odds = LOADER.odds) {
  if (misses + 1 >= odds.sure) return 1;
  return Math.min(1, odds.base + odds.perMiss * misses + odds.perSec * Math.max(0, sinceOpen));
}

// The menu is ready with the obstacle sprites and the 3D donut compiled; without 3D (or after
// LOADER.need3D s of waiting for it) the CSS donut stands in.
export function menuReady({ atlas, donut, threeD, sinceStart }) {
  return !!atlas && (!!donut || !threeD || sinceStart >= LOADER.need3D);
}

export class Gate {
  constructor({ quiet = LOADER.quiet, debounce = LOADER.debounce, odds = LOADER.odds, random = Math.random } = {}) {
    this.quiet = quiet;
    this.debounce = debounce;
    this.odds = odds;
    this.random = random;
    this.start = null; // when the fancy wheel started playing
    this.misses = 0;
    this.last = -Infinity;
  }

  begin(now) {
    if (this.start === null) this.start = now;
  }

  isOpen(now) {
    return this.start !== null && now - this.start >= this.quiet;
  }

  // 'ignored' (too early), 'merged' (part of the previous attempt), 'miss' or 'hit'.
  attempt(now, ready) {
    if (!this.isOpen(now)) return 'ignored';
    if (now - this.last < this.debounce) return 'merged';
    this.last = now;
    const p = chance(now - this.start - this.quiet, this.misses, this.odds);
    if (ready && this.random() < p) return 'hit';
    this.misses++;
    return 'miss';
  }
}
