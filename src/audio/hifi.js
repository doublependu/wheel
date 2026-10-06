// Era 4–7 audio: instruments are synthesized into sample buffers in the background (no
// downloads), then played back as a sampler. Plus echo, reverb, vinyl crackle, ambience,
// paw-step foley, obstacle whooshes (stereo in era 6, HRTF in era 7) and an "HDR" mix.
import { midiToHz } from './song.js';
import { RECIPES } from './instruments.js';

// ---------- engine ----------
export async function createHifi(eng) {
  const h = new Hifi(eng);
  await h.load();
  return h;
}

const ERA_MIX = {
  4: { echo: 0.32, reverb: 0, crackle: 0, ambience: 0, limiter: -8, musicVol: 1 },
  5: { echo: 0, reverb: 0.22, crackle: 0.5, ambience: 0, limiter: -8, musicVol: 1 },
  6: { echo: 0.08, reverb: 0.18, crackle: 0, ambience: 0.35, limiter: -8, musicVol: 1 },
  7: { echo: 0, reverb: 0.34, crackle: 0, ambience: 0.25, limiter: -3, musicVol: 0.75 },
};

class Hifi {
  constructor(eng) {
    this.eng = eng;
    this.ctx = eng.ctx;
    this.ready = false;
    this.b = {};
    this.sets = {};
  }

  // Samples are synthesized in a worker (main-thread fallback), essentials first.
  async load() {
    const { ctx } = this;
    const sr = ctx.sampleRate;
    const names = Object.keys(RECIPES);
    const raw = {};
    await new Promise((resolve) => {
      let worker = null;
      try {
        worker = new Worker(new URL('./synth.worker.js', import.meta.url), { type: 'module' });
      } catch {
        worker = null;
      }
      if (!worker) {
        (async () => {
          for (const n of names) {
            raw[n] = RECIPES[n](sr);
            await new Promise((r) => setTimeout(r, 0));
          }
          resolve();
        })();
        return;
      }
      worker.onmessage = (e) => {
        raw[e.data.name] = e.data.chs;
        if (Object.keys(raw).length === names.length) {
          worker.terminate();
          resolve();
        }
      };
      worker.onerror = () => {
        worker.terminate();
        for (const n of names) if (!raw[n]) raw[n] = RECIPES[n](sr);
        resolve();
      };
      worker.postMessage({ sr, names });
    });
    const B = (n) => {
      const chs = raw[n];
      const b = ctx.createBuffer(chs.length, chs[0].length, sr);
      chs.forEach((c, i) => b.copyToChannel(c, i));
      return b;
    };
    const zones = (inst, roots) => roots.map((r) => ({ root: r, buf: B(`${inst}:${r}`) }));
    this.b.rhodes = zones('rhodes', [48, 60, 72]);
    this.b.pluck = zones('pluck', [60, 72]);
    this.b.bass = zones('bass', [33, 45]);
    this.b.kit = Object.fromEntries(['kick', 'snare', 'hat', 'open', 'crash'].map((k) => [k, B(`kit:${k}`)]));
    this.b.meow = B('meow');
    this.b.crackle = B('crackle');
    this.b.strings = zones('strings', [48, 60]);
    this.b.choir = zones('choir', [60]);
    this.b.timpani = B('timpani');
    this.b.wind = B('wind');
    this.#buildBus(B('ir:room'), B('ir:hall'));
    this.ready = true;
    this.applyEra(this.eng.era, ctx.currentTime);
  }

  #buildBus(roomIR, hallIR) {
    const { ctx, eng } = this;
    const g = (v) => {
      const n = ctx.createGain();
      n.gain.value = v;
      return n;
    };
    // echo: tempo-synced 8th-note delay with darkening feedback (16-bit console style)
    this.echoSend = g(0);
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 60 / 90 / 2;
    const fb = g(0.38);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    eng.musicFilter.connect(this.echoSend).connect(delay).connect(lp).connect(fb).connect(delay);
    lp.connect(eng.master);
    // reverb: a short room (eras 5–6) and a long hall (era 7, IR rendered last)
    this.reverbSend = g(0);
    this.hallSend = g(0);
    this.room = ctx.createConvolver();
    this.room.buffer = roomIR;
    this.hall = ctx.createConvolver();
    this.hall.buffer = hallIR;
    for (const send of [this.reverbSend, this.hallSend]) {
      eng.musicFilter.connect(send);
      eng.sfx.connect(send);
    }
    this.reverbSend.connect(this.room).connect(eng.master);
    this.hallSend.connect(this.hall).connect(eng.master);
    // sidechain pump (era 6): sits between the music filter and the ducking gain
    this.pumpGain = g(1);
    eng.musicFilter.disconnect(eng.musicOut);
    eng.musicFilter.connect(this.pumpGain).connect(eng.musicOut);
    // vinyl crackle + ambience beds
    this.crackleGain = g(0);
    const cr = ctx.createBufferSource();
    cr.buffer = this.b.crackle;
    cr.loop = true;
    cr.connect(this.crackleGain).connect(eng.master);
    cr.start();
    this.ambienceGain = g(0);
    this.ambienceGain.connect(eng.master);
  }

  #ambience() {
    if (this.windSrc || !this.b.wind) return;
    const s = this.ctx.createBufferSource();
    s.buffer = this.b.wind;
    s.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    s.connect(f).connect(this.ambienceGain);
    s.start();
    this.windSrc = s;
  }

  applyEra(era, t) {
    if (!this.echoSend) return;
    const mix = ERA_MIX[era] ?? { echo: 0, reverb: 0, crackle: 0, ambience: 0, limiter: -8, musicVol: 1 };
    const set = (p, v) => {
      p.cancelScheduledValues(t);
      p.setTargetAtTime(v, t, 0.15);
    };
    set(this.echoSend.gain, mix.echo);
    set(this.reverbSend.gain, era === 7 ? 0 : mix.reverb);
    set(this.hallSend.gain, era === 7 ? mix.reverb : 0);
    set(this.crackleGain.gain, mix.crackle * 0.6);
    set(this.ambienceGain.gain, mix.ambience);
    set(this.pumpGain.gain, mix.musicVol);
    this.eng.limiter.threshold.setValueAtTime(mix.limiter, t);
    if (mix.ambience) this.#ambience();
  }

  // ---------- sampler ----------
  play(zones, t, midi, dur, vol, { pan = 0, dest = this.eng.music, release = 0.25, attack = 0.002 } = {}) {
    const { ctx } = this;
    let z = zones[0];
    for (const c of zones) if (Math.abs(c.root - midi) < Math.abs(z.root - midi)) z = c;
    const src = ctx.createBufferSource();
    src.buffer = z.buf;
    src.playbackRate.value = Math.pow(2, (midi - z.root) / 12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.setTargetAtTime(0, t + dur, release / 3);
    let node = src.connect(g);
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      node = node.connect(p);
    }
    node.connect(dest);
    src.start(t);
    src.stop(t + Math.min(dur + release * 3, z.buf.duration / src.playbackRate.value));
    return src;
  }

  hit(buf, t, vol, { rate = 1, pan = 0, dest = this.eng.music } = {}) {
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    let node = src.connect(g);
    if (pan && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = pan;
      node = node.connect(p);
    }
    node.connect(dest);
    src.start(t);
    return src;
  }

  synthLead(t, m, dur, vol) {
    const { ctx } = this;
    const f = midiToHz(m);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.03);
    g.gain.setTargetAtTime(vol * 0.6, t + 0.03, 0.2);
    g.gain.setTargetAtTime(0, t + dur, 0.08);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2600, t);
    lp.frequency.setTargetAtTime(1200, t, 0.3);
    lp.connect(g).connect(this.eng.music);
    for (const d of [-6, 6]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = d;
      const l = ctx.createOscillator();
      l.frequency.value = 5;
      const lg = ctx.createGain();
      lg.gain.setValueAtTime(0, t);
      lg.gain.linearRampToValueAtTime(12, t + 0.4);
      l.connect(lg).connect(o.detune);
      o.connect(lp);
      o.start(t);
      l.start(t);
      o.stop(t + dur + 0.4);
      l.stop(t + dur + 0.4);
    }
  }

  voices(era) {
    if (this.sets[era]) return this.sets[era];
    const b = this.b;
    const kit = (vols, rateJitter = 0) => (t, kind, vel) => {
      const buf = b.kit[kind];
      if (!buf) return;
      const pan = kind === 'hat' || kind === 'open' ? (era >= 6 ? 0.35 : 0) : 0;
      this.hit(buf, t, (vols[kind] ?? 0.3) * vel, { rate: 1 + (Math.random() - 0.5) * rateJitter, pan });
    };
    const strings = (t, chord, dur, vol) => chord.voicing.forEach((m, i) => this.play(b.strings, t, m - 12, dur, vol, { attack: 0.3, release: 0.8, pan: (i - 1.5) * 0.3 }));
    const rhodesChord = (vol, spread) => (t, chord, dur, vel) =>
      chord.voicing.forEach((m, i) => this.play(b.rhodes, t + i * 0.014, m, dur, vol * vel, { release: 0.4, pan: (i - 1.5) * spread }));
    const sfx = this.#sfx(era);
    let set;
    if (era === 4) {
      set = {
        tracks: { lead: true, harm: true, bass: true, drums: true },
        lead: (t, m, dur, vel) => this.play(b.pluck, t, m, dur, 0.22 * vel),
        harm: rhodesChord(0.08, 0),
        bass: (t, m, dur, vel) => this.play(b.bass, t, m, dur, 0.42 * vel, { release: 0.08 }),
        drum: kit({ kick: 0.55, snare: 0.32, hat: 0.12, open: 0.12 }),
        impact: (t) => {
          this.hit(b.kit.crash, t, 0.25);
          strings(t, { voicing: [60, 64, 67, 72] }, 0.4, 0.12);
        },
        riser: (t, dur) => this.#riser(t, dur, 0.05),
        sfx,
      };
    } else if (era === 5) {
      set = {
        tracks: { lead: true, harm: true, bass: true, drums: true },
        lead: (t, m, dur, vel) => this.play(b.rhodes, t, m, dur, 0.17 * vel, { release: 0.3 }),
        harm: rhodesChord(0.075, 0.3),
        bass: (t, m, dur, vel) => this.play(b.bass, t, m, dur, 0.45 * vel, { release: 0.1 }),
        drum: kit({ kick: 0.6, snare: 0.34, hat: 0.1, open: 0.12 }, 0.06),
        impact: (t) => {
          this.#shimmer(t);
          this.hit(b.kit.crash, t + 0.6, 0.2);
        },
        riser: (t, dur) => this.#riser(t, dur, 0.05),
        sfx,
      };
    } else if (era === 6) {
      set = {
        tracks: { lead: true, harm: true, bass: true, drums: true },
        lead: (t, m, dur, vel) => this.synthLead(t, m, dur, 0.05 * vel),
        harm: rhodesChord(0.08, 0.6),
        bass: (t, m, dur, vel) => {
          this.play(b.bass, t, m, dur, 0.4 * vel, { release: 0.1 });
          this.#sub(t, m, dur, 0.12 * vel);
        },
        drum: kit({ kick: 0.65, snare: 0.36, hat: 0.13, open: 0.13 }, 0.03),
        impact: (t) => this.hit(b.kit.crash, t, 0.25),
        riser: (t, dur) => this.#riser(t, dur, 0.06),
        sfx,
      };
    } else {
      set = {
        tracks: { lead: true, harm: true, bass: true, drums: true },
        lead: (t, m, dur, vel) => this.play(b.rhodes, t, m, dur, 0.15 * vel, { release: 0.6, pan: 0.1 }),
        harm: (t, chord, dur, vel) => {
          strings(t, chord, Math.max(dur, 2.2), 0.06 * vel);
          if (b.choir) this.play(b.choir, t, chord.voicing[1], Math.max(dur, 2.2), 0.05 * vel, { attack: 0.4, release: 0.8 });
        },
        bass: (t, m, dur, vel) => {
          this.play(b.bass, t, m, dur, 0.35 * vel, { release: 0.2 });
          this.#sub(t, m, dur, 0.1 * vel);
        },
        drum: kit({ kick: 0.5, snare: 0.18, hat: 0.07, open: 0.07 }, 0.02),
        impact: (t) => {
          if (b.timpani) for (let i = 0; i < 6; i++) this.hit(b.timpani, t - 0.6 + i * 0.1, 0.12 + i * 0.05);
          this.hit(b.kit.crash, t, 0.35);
          strings(t, { voicing: [48, 55, 64, 72] }, 2.5, 0.12);
          if (b.choir) this.play(b.choir, t, 72, 2.5, 0.1, { attack: 0.2, release: 1 });
          this.#hdrDuck(t, 1.2);
        },
        riser: (t, dur) => this.#riser(t, dur, 0.07),
        sfx,
      };
    }
    this.sets[era] = set;
    return set;
  }

  #sub(t, m, dur, vol) {
    const o = this.ctx.createOscillator();
    o.frequency.value = midiToHz(m - 12);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.setTargetAtTime(0, t + dur, 0.05);
    o.connect(g).connect(this.eng.music);
    o.start(t);
    o.stop(t + dur + 0.3);
  }

  #riser(t, dur, vol) {
    const { ctx } = this;
    const s = ctx.createBufferSource();
    s.buffer = this.eng.noiseBuffer;
    s.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 2;
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(9000, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + dur);
    g.gain.setValueAtTime(0, t + dur);
    s.connect(f).connect(g).connect(this.eng.music);
    s.start(t);
    s.stop(t + dur + 0.05);
  }

  // Original "disc spin-up" shimmer for the CD era drop.
  #shimmer(t) {
    const { ctx } = this;
    for (const [m, d] of [[72, 0], [79, 0.05], [84, 0.1], [88, 0.15]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(midiToHz(m) / 4, t + d);
      o.frequency.exponentialRampToValueAtTime(midiToHz(m), t + d + 0.5);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + d);
      g.gain.linearRampToValueAtTime(0.04, t + d + 0.4);
      g.gain.setTargetAtTime(0, t + d + 0.6, 0.3);
      o.connect(g).connect(this.eng.music);
      o.start(t + d);
      o.stop(t + d + 2);
    }
  }

  drop(era, t) {
    if (era === 6) this.#hdrDuck(t, 0.4);
  }

  // "HDR audio": loud events briefly duck the music so peaks feel bigger.
  #hdrDuck(t, dur) {
    const p = this.pumpGain.gain;
    const base = ERA_MIX[this.eng.era]?.musicVol ?? 1;
    p.setValueAtTime(base * 0.55, t);
    p.setTargetAtTime(base, t + dur, 0.25);
  }

  pump(era, t) {
    if (era !== 6) return;
    const p = this.pumpGain.gain;
    p.setValueAtTime(0.62, t);
    p.setTargetAtTime(1, t + 0.02, 0.09);
  }

  // ---------- era 4–7 sound effects ----------
  #sfx(era) {
    const b = this.b;
    const dest = this.eng.sfx;
    return {
      jump: (t) => {
        if (era === 4) {
          this.play(b.pluck, t, 79, 0.15, 0.25, { dest });
          this.play(b.pluck, t + 0.05, 86, 0.15, 0.2, { dest });
        } else this.#whoosh(t, 0.22, era >= 6 ? 0.1 : 0.08, 600, 2600, 0);
      },
      land: (t) => {
        this.#thump(t, era >= 6 ? 0.22 : 0.16);
      },
      milestone: (t) => {
        this.play(b.rhodes, t, 84, 0.3, 0.12, { dest });
        this.play(b.rhodes, t + 0.08, 91, 0.4, 0.1, { dest });
      },
      meow: (t) => {
        const pan = era >= 6 ? -0.3 : 0;
        if (era === 7) this.#hdrDuck(t, 0.8);
        this.hit(b.meow, t, 0.5, { pan, dest });
      },
    };
  }

  #whoosh(t, dur, vol, f0, f1, pan) {
    const { ctx } = this;
    const s = ctx.createBufferSource();
    s.buffer = this.eng.noiseBuffer;
    s.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + dur * 0.4);
    g.gain.linearRampToValueAtTime(0, t + dur);
    let node = s.connect(f).connect(g);
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      node = node.connect(p);
    }
    node.connect(this.eng.sfx);
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
  }

  #thump(t, vol) {
    const { ctx } = this;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.setTargetAtTime(0, t, 0.03);
    o.connect(g).connect(this.eng.sfx);
    o.start(t);
    o.stop(t + 0.2);
    this.#whoosh(t, 0.06, vol * 0.4, 1800, 600, 0);
  }

  footstep(t, era) {
    const { ctx } = this;
    const s = ctx.createBufferSource();
    s.buffer = this.eng.noiseBuffer;
    s.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900 + Math.random() * 500;
    const g = ctx.createGain();
    const v = (era === 7 ? 0.05 : 0.04) * (0.7 + Math.random() * 0.6);
    g.gain.setValueAtTime(v, t);
    g.gain.setTargetAtTime(0, t, 0.015);
    let node = s.connect(f).connect(g);
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = -0.25;
      node = node.connect(p);
    }
    node.connect(this.eng.sfx);
    s.start(t, Math.random());
    s.stop(t + 0.08);
  }

  // An obstacle passing the cat: stereo sweep in era 6, HRTF in era 7.
  pass(t, o, speed, era) {
    const { ctx } = this;
    const dist = 6;
    const dur = dist / speed + 0.3;
    const s = ctx.createBufferSource();
    s.buffer = this.eng.noiseBuffer;
    s.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 0.9;
    f.frequency.value = o.type === 'crow' ? 2600 : o.type === 'vacuum' ? 500 : 1200;
    const g = ctx.createGain();
    const vol = o.type === 'vacuum' ? 0.07 : 0.05;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + dur * 0.85);
    g.gain.linearRampToValueAtTime(0, t + dur);
    s.connect(f).connect(g);
    if (era === 7 && ctx.createPanner) {
      const p = ctx.createPanner();
      p.panningModel = this.eng.hrtf === false ? 'equalpower' : 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = 1;
      p.positionY.value = o.type === 'crow' ? 0.6 : -0.4;
      p.positionZ.setValueAtTime(-1.2, t);
      p.positionX.setValueAtTime(dist, t);
      p.positionX.linearRampToValueAtTime(-1.5, t + dur);
      g.connect(p).connect(this.eng.sfx);
    } else if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.setValueAtTime(0.9, t);
      p.pan.linearRampToValueAtTime(-0.6, t + dur);
      g.connect(p).connect(this.eng.sfx);
    } else g.connect(this.eng.sfx);
    if (o.type === 'crow') for (let i = 0; i < 3; i++) this.#whoosh(t + dur * 0.5 + i * 0.12, 0.08, 0.03, 900, 300, 0);
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
  }
}
