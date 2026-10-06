// Audio engine: music scheduler synced to the sim clock, per-era instruments and effects,
// sound effects, tape-stop on hit and the start "crunch".
import workletUrl from './lofi.worklet.js?url';
import { barNotes } from './song.js';
import { beeper, chip, fm, makeWaves, makeNoise, fmVoice } from './retro.js';
import { BAR, STEP, STEPS_PER_BAR } from '../config.js';

const LOOKAHEAD = 0.2;

// Bus settings per era: lo-fi processor (bits, sample-and-hold, wow) and low-pass cutoff (Hz).
const ERA_FX = {
  1: { bits: 1, hold: 1, wow: 0, cutoff: 9000, sfxBits: 1 },
  2: { bits: 4, hold: 2, wow: 0, cutoff: 8000, sfxBits: 4 },
  3: { bits: 10, hold: 1, wow: 0, cutoff: 6000, sfxBits: 12 },
  4: { bits: 16, hold: 1.5, wow: 0, cutoff: 5000, sfxBits: 16 },
  5: { bits: 16, hold: 1, wow: 0.35, cutoff: 3600, sfxBits: 16 },
  6: { bits: 16, hold: 1, wow: 0.06, cutoff: 7500, sfxBits: 16 },
  7: { bits: 16, hold: 1, wow: 0, cutoff: 14000, sfxBits: 16 },
};

export function createAudio(opts) {
  return new AudioEngine(opts);
}

class AudioEngine {
  constructor({ muted = false } = {}) {
    this.muted = muted;
    this.ctx = null;
    this.ready = false;
    this.mode = 'idle'; // idle | sim | free | stopped
    this.voiceCache = {};
    this.hifi = null;
    this.barCache = new Map();
    this.nextStep = 0;
    this.offset = null;
    this.lastEra = 0;
    this.era = 1;
    this.lastPhase = 0;
    this.passed = new Set();
  }

  attach(ctx) {
    if (this.ctx) return;
    this.ctx = ctx;
    const g = (v = 1) => {
      const n = ctx.createGain();
      n.gain.value = v;
      return n;
    };
    this.master = g(this.muted ? 0 : 0.9);
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -8;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.2;
    this.master.connect(this.limiter).connect(ctx.destination);

    this.music = g(1); // music voices connect here
    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 9000;
    this.musicFilter.Q.value = 0.5;
    this.musicOut = g(0.85); // ducking (pause, voice steal, loudness mixer)
    this.sfx = g(1);
    this.sfxOut = g(1);
    this.send = g(1); // effects send (echo / reverb), fed by hifi
    this.music.connect(this.musicFilter);
    this.musicFilter.connect(this.musicOut).connect(this.master);
    this.sfx.connect(this.sfxOut).connect(this.master);

    this.waves = makeWaves(ctx);
    this.noiseBuffer = makeNoise(ctx);

    ctx.audioWorklet
      ?.addModule(workletUrl)
      .then(() => {
        const mk = () => new AudioWorkletNode(ctx, 'lofi', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
        this.musicLofi = mk();
        this.sfxLofi = mk();
        this.music.disconnect();
        this.music.connect(this.musicLofi).connect(this.musicFilter);
        this.sfx.disconnect();
        this.sfx.connect(this.sfxLofi).connect(this.sfxOut);
        this.applyEraFx(this.era, ctx.currentTime);
      })
      .catch((e) => console.warn('lo-fi worklet unavailable', e));
    this.ready = true;
    // The hi-fi instruments (eras 4–7) render in the background.
    import('./hifi.js')
      .then((m) => m.createHifi(this))
      .then((h) => (this.hifi = h))
      .catch((e) => console.warn('hi-fi audio unavailable', e));
  }

  get running() {
    return this.ctx && this.ctx.state === 'running' && this.ready;
  }

  voices(era) {
    if (era >= 4 && this.hifi?.ready) return this.hifi.voices(era);
    const key = era >= 4 ? 3 : era;
    if (!this.voiceCache[key]) this.voiceCache[key] = [null, beeper, chip, fm][key](this);
    return this.voiceCache[key];
  }

  // Era 1: the beeper has one voice, so sound effects silence the music while they play.
  stealVoice(t0, t1) {
    if (this.era !== 1) return;
    const g = this.musicOut.gain;
    g.setValueAtTime(0, t0);
    g.setValueAtTime(0.85, t1);
  }

  applyEraFx(era, t) {
    const fx = ERA_FX[era];
    if (!fx) return;
    for (const [node, bits] of [[this.musicLofi, fx.bits], [this.sfxLofi, fx.sfxBits]]) {
      if (!node) continue;
      node.parameters.get('bits').setValueAtTime(bits, t);
      node.parameters.get('hold').setValueAtTime(fx.hold, t);
      node.parameters.get('wow').setValueAtTime(fx.wow, t);
    }
    this.hifi?.applyEra(era, t);
  }

  // ---------- music ----------
  startRun(world) {
    if (!this.ctx) return;
    this.mode = 'sim';
    this.barCache.clear();
    this.nextStep = Math.ceil(world.t / STEP);
    this.offset = null;
    this.lastEra = 0;
    this.era = world.era;
    this.passed.clear();
    const now = this.ctx.currentTime;
    this.musicLofi?.port.postMessage('reset');
    this.musicLofi?.parameters.get('speed').setValueAtTime(1, now);
    this.musicOut.gain.cancelScheduledValues(now);
    this.musicOut.gain.setValueAtTime(0.85, now);
    this.musicFilter.frequency.cancelScheduledValues(now);
    this.applyEraFx(world.era, now);
    this.musicFilter.frequency.setValueAtTime(ERA_FX[world.era].cutoff, now);
  }

  #describe(world, bar) {
    if (this.mode === 'free') return { era: this.era, kind: 'chill', index: 4 + (bar % 2), drop: false };
    const clock = world.clock;
    const s = clock.sectionAtBar(bar);
    if (!s) return null;
    if (s.kind === 'build') return { era: s.era, kind: 'build', index: bar - s.start, drop: false };
    const first = clock.sections.find((x) => x.era === s.era && x.kind === 'chill');
    const index = bar - first.start;
    return { era: s.era, kind: 'chill', index, drop: index === 0 && bar > 0 };
  }

  #bar(world, bar) {
    let b = this.barCache.get(bar);
    if (!b) {
      const desc = this.#describe(world, bar);
      if (!desc) return null;
      b = { desc, notes: barNotes(desc) };
      this.barCache.set(bar, b);
      if (this.barCache.size > 8) this.barCache.delete(this.barCache.keys().next().value);
    }
    return b;
  }

  update(world, screen) {
    if (!this.running) return;
    const ctx = this.ctx;
    if ((screen === 'paused' || screen === 'over') && this.mode === 'sim') this.#goFree();
    if (screen === 'title' || screen === 'crunch' || this.mode === 'idle' || this.mode === 'stopped') return;

    // Map music time to the audio clock. In sim mode music time = sim time.
    const musicNow = this.mode === 'sim' ? world.t : ctx.currentTime - this.freeStart;
    const target = ctx.currentTime + 0.03 - musicNow - Math.min(0.1, ctx.outputLatency || 0);
    if (this.offset === null || Math.abs(target - this.offset) > 0.06) this.offset = target;
    else this.offset += (target - this.offset) * 0.05;

    if (this.mode === 'sim') this.#runFoley(world);

    const horizon = musicNow + LOOKAHEAD;
    while (this.nextStep * STEP < horizon) {
      const step = this.nextStep++;
      const bar = Math.floor(step / STEPS_PER_BAR);
      const s = step % STEPS_PER_BAR;
      const b = this.#bar(world, bar);
      if (!b) continue;
      const tStep = step * STEP + this.offset;
      if (tStep < ctx.currentTime - 0.02) continue;
      this.#playStep(b, s, tStep);
    }
  }

  #goFree() {
    this.mode = 'free';
    this.freeStart = this.ctx.currentTime;
    this.nextStep = 0;
    this.offset = null;
    this.barCache.clear();
  }

  #playStep(b, s, t) {
    const { desc, notes } = b;
    const v = this.voices(desc.era);
    const swingT = s % 2 ? notes.swing * STEP : 0;
    const tt = t + swingT;

    if (s === 0) {
      if (desc.era !== this.lastEra) {
        this.era = desc.era;
        if (this.lastEra) this.applyEraFx(desc.era, t);
        this.lastEra = desc.era;
      }
      const cut = ERA_FX[desc.era].cutoff;
      const f = this.musicFilter.frequency;
      if (this.mode === 'free') {
        f.setTargetAtTime(700, t, 0.1);
      } else if (desc.kind === 'build' && desc.index === 0) {
        f.setValueAtTime(cut, t);
        f.exponentialRampToValueAtTime(18000, t + 2 * BAR);
      } else if (desc.drop) {
        f.cancelScheduledValues(t);
        f.setValueAtTime(desc.era === 3 || desc.era === 6 ? 500 : cut, t);
        f.exponentialRampToValueAtTime(cut, t + BAR * 0.75);
        v.impact?.(t);
        this.hifi?.drop(desc.era, t);
      } else if (desc.kind === 'chill') {
        f.setValueAtTime(cut, t);
      }
      if (notes.riser) v.riser?.(t, notes.riser * BAR);
      if (notes.chord && v.harm && desc.kind === 'chill') v.harm(t, notes.chord, BAR * 0.7, 1);
    }

    // Era 2 drop: the four channels switch on one per beat.
    const entry = desc.drop && desc.era === 2 ? Math.floor(s / 4) : 9;
    const humanize = () => 0.85 + Math.random() * 0.25;

    const leadPattern = desc.kind === 'build' && v.buildLead === 'arp' ? notes.arp : notes.lead;
    for (const [st, m, len] of leadPattern) if (st === s && v.lead) v.lead(tt, m, len * STEP, humanize());
    if (v.tracks.arp && entry >= 1) {
      for (const [st, m, len] of notes.arp) if (st === s) v.arp(tt, m, len * STEP, humanize());
    }
    if (v.tracks.harm && desc.kind === 'build') {
      for (const [st, len] of notes.harm) if (st === s) v.harm(tt, notes.chord, len * STEP, 1.1);
    }
    if (v.tracks.bass && entry >= 2) for (const [st, m, len] of notes.bass) if (st === s) v.bass(tt, m, len * STEP, humanize());
    if (v.tracks.drums && entry >= 3) {
      for (const [st, kind, vel] of notes.drums) {
        if (st !== s) continue;
        v.drum(tt, kind, vel * humanize());
        if (kind === 'kick') this.hifi?.pump(desc.era, tt);
      }
    }
  }

  // ---------- sound effects ----------
  event(e, world) {
    if (!this.running || this.mode !== 'sim') return;
    const t = this.ctx.currentTime + 0.005;
    const v = this.voices(world.era);
    if (e.type === 'jump') v.sfx?.jump(t);
    else if (e.type === 'land') v.sfx?.land(t);
    else if (e.type === 'milestone') v.sfx?.milestone(t);
  }

  // Paw steps (eras 6–7) follow the gallop phase; obstacles whoosh past in stereo / 3D.
  #runFoley(world) {
    if (!this.hifi?.ready || world.era < 6) {
      this.lastPhase = world.cat.phase;
      return;
    }
    const p = world.cat.phase;
    const prev = this.lastPhase;
    this.lastPhase = p;
    if (world.cat.onGround) {
      for (const contact of [0.2, 0.28, 0.7, 0.78]) {
        const crossed = prev <= p ? prev < contact && p >= contact : prev < contact || p >= contact;
        if (crossed) this.hifi.footstep(this.ctx.currentTime + 0.01, world.era);
      }
    }
    for (const o of world.obstacles) {
      const r = o.x - world.dist;
      if (r < 6 && r > -1 && !this.passed.has(o.id)) {
        this.passed.add(o.id);
        this.hifi.pass(this.ctx.currentTime + 0.01, o, world.speed, world.era);
      }
    }
    if (this.passed.size > 64) this.passed.clear();
  }

  hit(world) {
    if (!this.running) return;
    const t = this.ctx.currentTime;
    this.voices(world.era).sfx?.meow(t + 0.01);
    // tape stop: the music winds down to silence
    this.mode = 'stopped';
    const speed = this.musicLofi?.parameters.get('speed');
    if (speed) {
      speed.cancelScheduledValues(t);
      speed.setValueAtTime(1, t);
      speed.linearRampToValueAtTime(0, t + 0.8);
    }
    const g = this.musicOut.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0.85, t);
    g.setTargetAtTime(0, t + 0.55, 0.12);
    // then a muffled chill loop for the game-over screen
    clearTimeout(this.overTimer);
    this.overTimer = setTimeout(() => {
      if (this.mode !== 'stopped') return;
      const now = this.ctx.currentTime;
      speed?.cancelScheduledValues(now);
      speed?.setValueAtTime(1, now);
      this.musicLofi?.port.postMessage('reset');
      g.cancelScheduledValues(now);
      g.setValueAtTime(0, now);
      g.linearRampToValueAtTime(0.5, now + 1.5);
      this.#goFree();
    }, 1400);
  }

  pause(paused, world) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const g = this.musicOut.gain;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(paused ? 0.45 : 0.85, t, 0.08);
    if (!paused) {
      this.mode = 'sim';
      this.offset = null;
      this.barCache.clear();
      if (world) this.nextStep = Math.ceil(world.t / STEP);
      this.musicFilter.frequency.cancelScheduledValues(t);
      this.musicFilter.frequency.setTargetAtTime(ERA_FX[this.era].cutoff, t, 0.1);
    }
  }

  suspend(hidden) {
    if (!this.ctx) return;
    if (hidden) this.ctx.suspend().catch(() => {});
    else this.ctx.resume().catch(() => {});
  }

  setMuted(m) {
    this.muted = m;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(m ? 0 : 0.9, t, 0.05);
  }

  // Start (and restart): a lush, wide chord gets bit-crushed down to the 1-bit beeper.
  crunch(duration, quick = false) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.02;
    clearTimeout(this.overTimer);
    this.mode = 'idle';
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(quick ? 0.4 : 0.5, t + 0.08);
    out.gain.setValueAtTime(quick ? 0.4 : 0.5, t + duration * 0.8);
    out.gain.linearRampToValueAtTime(0, t + duration);
    out.connect(this.sfx);
    if (!quick) {
      // hi-fi whoosh + shimmering maj9 chord
      const n = ctx.createBufferSource();
      n.buffer = this.noiseBuffer;
      n.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 1.5;
      bp.frequency.setValueAtTime(300, t);
      bp.frequency.exponentialRampToValueAtTime(6000, t + duration * 0.6);
      const ng = ctx.createGain();
      ng.gain.value = 0.25;
      n.connect(bp).connect(ng).connect(out);
      n.start(t);
      n.stop(t + duration);
    }
    [48, 55, 64, 71, 74, 79].forEach((m, i) =>
      fmVoice(ctx, out, t + i * 0.015, 440 * Math.pow(2, (m - 69) / 12), duration, {
        ratio: 1, index: 1.2, indexEnd: 0.4, vol: 0.06, attack: 0.03, decay: 2, sustain: 0.7, release: 0.1, pan: (i / 5 - 0.5) * 1.4,
      }),
    );
    const lofi = this.sfxLofi;
    if (lofi) {
      const bits = lofi.parameters.get('bits');
      const hold = lofi.parameters.get('hold');
      bits.cancelScheduledValues(t);
      hold.cancelScheduledValues(t);
      bits.setValueAtTime(16, t);
      hold.setValueAtTime(1, t);
      bits.linearRampToValueAtTime(1, t + duration * 0.85);
      hold.linearRampToValueAtTime(24, t + duration * 0.85);
      bits.setValueAtTime(ERA_FX[1].sfxBits, t + duration + 0.01);
      hold.setValueAtTime(ERA_FX[1].hold, t + duration + 0.01);
    }
  }
}
