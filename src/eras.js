// Era clock: a timeline of musical sections measured in bars of run time.
// Each era is CHILL_BARS of chill, then BUILD_BARS of build-up that drops into the next era.
// The build-up is only promised when the next era is ready (gate); otherwise an extra
// chill phrase plays and the gate is checked again. Era 7 stays chill forever.
import { BAR, CHILL_BARS, BUILD_BARS, EXTRA_CHILL_BARS, ERA_COUNT, DECIDE_LEAD } from './config.js';

export class EraClock {
  constructor(gate = () => true, startEra = 1) {
    this.gate = gate;
    this.sections = [{ start: 0, end: CHILL_BARS, era: startEra, kind: 'chill' }];
  }

  // Extend the timeline so that it covers time t + DECIDE_LEAD. Returns newly decided sections.
  plan(t) {
    const added = [];
    let last = this.sections[this.sections.length - 1];
    while (last.end * BAR - DECIDE_LEAD <= t) {
      if (last.kind === 'build') {
        last = this.#push({ start: last.end, end: last.end + CHILL_BARS, era: last.era + 1, kind: 'chill' }, added);
      } else if (last.era < ERA_COUNT && this.gate(last.era + 1)) {
        last = this.#push({ start: last.end, end: last.end + BUILD_BARS, era: last.era, kind: 'build' }, added);
      } else {
        const len = last.era < ERA_COUNT ? EXTRA_CHILL_BARS : CHILL_BARS;
        last = this.#push({ start: last.end, end: last.end + len, era: last.era, kind: 'chill' }, added);
      }
    }
    return added;
  }

  #push(section, added) {
    this.sections.push(section);
    added.push(section);
    // Keep the timeline short; sections far in the past are no longer needed.
    if (this.sections.length > 64) this.sections.splice(0, this.sections.length - 32);
    return section;
  }

  sectionAtBar(bar) {
    for (let i = this.sections.length - 1; i >= 0; i--) {
      const s = this.sections[i];
      if (bar >= s.start && bar < s.end) return s;
    }
    return null;
  }

  sectionAt(t) {
    return this.sectionAtBar(Math.floor(t / BAR));
  }

  eraAt(t) {
    return this.sectionAt(t)?.era ?? 1;
  }

  // Time of the next era drop (first bar of the next era) that has been decided, if any.
  nextDropTime(t) {
    for (const s of this.sections) {
      if (s.kind === 'build' && s.end * BAR > t) return s.end * BAR;
    }
    return null;
  }

  // Era drops that are decided, as times (used by the spawner's breather rule).
  dropTimes() {
    return this.sections.filter((s) => s.kind === 'build').map((s) => s.end * BAR);
  }
}
