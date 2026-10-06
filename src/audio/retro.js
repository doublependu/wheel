// Era 1–3 instruments, all synthesized: 1-bit beeper, 4-channel handheld chip, 2-operator FM.
import { midiToHz } from './song.js';

// ---------- shared helpers ----------
export function env(g, t, peak, attack, decay, sustain, release, dur) {
  const p = g.gain;
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + attack);
  p.setTargetAtTime(peak * sustain, t + attack, decay / 3);
  p.setTargetAtTime(0, t + Math.max(attack, dur), release / 3);
}

function osc(ctx, type, freq, t, stopAt) {
  const o = ctx.createOscillator();
  if (typeof type === 'string') o.type = type;
  else o.setPeriodicWave(type);
  o.frequency.setValueAtTime(freq, t);
  o.start(t);
  o.stop(stopAt);
  return o;
}

function noise(eng, t, dur, rate = 1) {
  const s = eng.ctx.createBufferSource();
  s.buffer = eng.noiseBuffer;
  s.loop = true;
  s.playbackRate.value = rate;
  s.start(t, Math.random() * 0.9);
  s.stop(t + dur + 0.05);
  return s;
}

function gainNode(ctx, dest, value = 0) {
  const g = ctx.createGain();
  g.gain.value = value;
  g.connect(dest);
  return g;
}

// Pulse waves with a given duty cycle and the chip's 4-bit wavetable channel.
export function makeWaves(ctx) {
  const pulse = (duty) => {
    const N = 48;
    const real = new Float32Array(N);
    const imag = new Float32Array(N);
    for (let n = 1; n < N; n++) real[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty);
    return ctx.createPeriodicWave(real, imag);
  };
  const table = Array.from({ length: 32 }, (_, i) => Math.round(7.5 + 7.5 * Math.sin((i / 32) * Math.PI * 2) * 0.7 + 7.5 * 0.3 * (i < 16 ? 1 : -1)));
  const N = 16;
  const real = new Float32Array(N);
  const imag = new Float32Array(N);
  for (let n = 1; n < N; n++) {
    for (let k = 0; k < 32; k++) {
      const v = table[k] / 7.5 - 1;
      real[n] += (v * Math.cos((2 * Math.PI * n * k) / 32)) / 16;
      imag[n] += (v * Math.sin((2 * Math.PI * n * k) / 32)) / 16;
    }
  }
  return { p12: pulse(0.125), p25: pulse(0.25), p50: pulse(0.5), wave: ctx.createPeriodicWave(real, imag) };
}

// LFSR-ish noise: random levels held for a few samples, as the chips did.
export function makeNoise(ctx) {
  const len = ctx.sampleRate;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let lfsr = 0x7fff;
  for (let i = 0; i < len; i++) {
    if (i % 2 === 0) {
      const bit = (lfsr ^ (lfsr >> 1)) & 1;
      lfsr = (lfsr >> 1) | (bit << 14);
    }
    d[i] = lfsr & 1 ? 1 : -1;
  }
  return buf;
}

// ---------- Era 1: 1-bit beeper (one voice; SFX steal it) ----------
export function beeper(eng) {
  const { ctx } = eng;
  const tone = (t, freq, dur, dest = eng.music, vol = 0.12) => {
    const g = gainNode(ctx, dest);
    g.gain.setValueAtTime(vol, t);
    g.gain.setValueAtTime(0, t + dur);
    const o = osc(ctx, 'square', freq, t, t + dur + 0.02);
    o.connect(g);
    return o;
  };
  const sfxTone = (t, notes) => {
    let end = t;
    for (const [f, d] of notes) {
      tone(end, f, d, eng.sfx, 0.12);
      end += d;
    }
    eng.stealVoice(t, end);
  };
  return {
    tracks: { lead: true },
    buildLead: 'arp',
    lead: (t, m, dur) => tone(t, midiToHz(m), dur * 0.92),
    impact: (t) => tone(t, midiToHz(84), 0.09),
    sfx: {
      jump: (t) => {
        const g = gainNode(ctx, eng.sfx, 0.12);
        g.gain.setValueAtTime(0, t + 0.09);
        const o = osc(ctx, 'square', 420, t, t + 0.1);
        o.frequency.exponentialRampToValueAtTime(1100, t + 0.09);
        o.connect(g);
        eng.stealVoice(t, t + 0.09);
      },
      land: (t) => sfxTone(t, [[110, 0.025]]),
      milestone: (t) => sfxTone(t, [[988, 0.08], [1319, 0.16]]),
      meow: (t) => sfxTone(t, [[740, 0.12], [988, 0.1], [587, 0.32]]),
    },
  };
}

// ---------- Era 2: 4-channel chip (2 pulse, 4-bit wave, noise) ----------
export function chip(eng) {
  const { ctx, waves } = eng;
  const pulse = (t, freq, dur, wave, vol, vib = 0, dest = eng.music) => {
    const g = gainNode(ctx, dest);
    // stepped volume envelope like the hardware
    g.gain.setValueAtTime(vol, t);
    g.gain.setValueAtTime(vol * 0.75, t + Math.min(dur, 0.12));
    g.gain.setValueAtTime(vol * 0.5, t + Math.min(dur, 0.3));
    g.gain.setValueAtTime(0, t + dur);
    const o = osc(ctx, wave, freq, t, t + dur + 0.02);
    if (vib) {
      const l = osc(ctx, 'sine', 5.5, t, t + dur + 0.02);
      const lg = ctx.createGain();
      lg.gain.setValueAtTime(0, t);
      lg.gain.linearRampToValueAtTime(vib, t + 0.25);
      l.connect(lg).connect(o.detune);
    }
    o.connect(g);
    return o;
  };
  const drum = (t, kind, vel) => {
    if (kind === 'kick') {
      const g = gainNode(ctx, eng.music);
      g.gain.setValueAtTime(0.32 * vel, t);
      g.gain.setValueAtTime(0, t + 0.09);
      const o = osc(ctx, waves.p50, 180, t, t + 0.1);
      o.frequency.exponentialRampToValueAtTime(45, t + 0.09);
      o.connect(g);
    } else {
      const dur = kind === 'snare' ? 0.14 : kind === 'open' ? 0.12 : 0.035;
      const g = gainNode(ctx, eng.music);
      const v = (kind === 'snare' ? 0.18 : 0.07) * vel;
      g.gain.setValueAtTime(v, t);
      g.gain.setValueAtTime(v * 0.5, t + dur * 0.5);
      g.gain.setValueAtTime(0, t + dur);
      noise(eng, t, dur, kind === 'snare' ? 0.5 : 1).connect(g);
    }
  };
  return {
    tracks: { lead: true, arp: true, bass: true, drums: true },
    lead: (t, m, dur, vel) => pulse(t, midiToHz(m), dur * 0.9, waves.p25, 0.085 * vel, 14),
    arp: (t, m, dur, vel) => pulse(t, midiToHz(m), dur * 0.8, waves.p12, 0.04 * vel),
    bass: (t, m, dur, vel) => pulse(t, midiToHz(m + 12), dur * 0.9, waves.wave, 0.22 * vel),
    drum,
    impact: (t) => drum(t, 'snare', 1.4),
    riser: (t, dur) => {
      const g = gainNode(ctx, eng.music);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.06, t + dur);
      g.gain.setValueAtTime(0, t + dur);
      const s = noise(eng, t, dur, 0.15);
      s.playbackRate.exponentialRampToValueAtTime(1.5, t + dur);
      s.connect(g);
    },
    sfx: {
      jump: (t) => {
        const o = pulse(t, 300, 0.12, waves.p25, 0.1, 0, eng.sfx);
        o.frequency.exponentialRampToValueAtTime(950, t + 0.11);
      },
      land: (t) => {
        const g = gainNode(ctx, eng.sfx, 0.08);
        g.gain.setValueAtTime(0, t + 0.03);
        noise(eng, t, 0.04, 0.3).connect(g);
      },
      milestone: (t) => {
        pulse(t, 1047, 0.07, waves.p50, 0.07, 0, eng.sfx);
        pulse(t + 0.07, 1568, 0.18, waves.p50, 0.07, 0, eng.sfx);
      },
      meow: (t) => {
        const o = pulse(t, 500, 0.5, waves.p25, 0.12, 30, eng.sfx);
        o.frequency.setValueAtTime(500, t);
        o.frequency.linearRampToValueAtTime(900, t + 0.15);
        o.frequency.linearRampToValueAtTime(420, t + 0.48);
      },
    },
  };
}

// ---------- Era 3: 2-operator FM ----------
export function fmVoice(ctx, dest, t, freq, dur, { ratio = 1, index = 2, indexEnd = 0.3, idecay = 0.8, vol = 0.1, attack = 0.005, decay = 1.2, sustain = 0.3, release = 0.25, ratio2 = 0, index2 = 0, pan = 0 }) {
  const end = t + dur + release * 2;
  const car = osc(ctx, 'sine', freq, t, end);
  const mod = osc(ctx, 'sine', freq * ratio, t, end);
  const mg = ctx.createGain();
  mg.gain.setValueAtTime(index * freq * ratio, t);
  mg.gain.setTargetAtTime(indexEnd * freq * ratio, t, idecay / 3);
  mod.connect(mg).connect(car.frequency);
  if (ratio2) {
    const m2 = osc(ctx, 'sine', freq * ratio2, t, end);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(index2 * freq, t);
    g2.gain.setTargetAtTime(0, t, 0.03);
    m2.connect(g2).connect(car.frequency);
  }
  const g = ctx.createGain();
  env(g, t, vol, attack, decay, sustain, release, dur);
  if (pan && ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    car.connect(g).connect(p).connect(dest);
  } else car.connect(g).connect(dest);
  return car;
}

export function fm(eng) {
  const { ctx } = eng;
  const epiano = (t, m, dur, vol, dest = eng.music, pan = 0) =>
    fmVoice(ctx, dest, t, midiToHz(m), dur, { ratio: 1, index: 1.8, indexEnd: 0.25, idecay: 0.9, vol, ratio2: 14, index2: 0.35, decay: 1.6, sustain: 0.35, release: 0.3, pan });
  const drum = (t, kind, vel) => {
    if (kind === 'kick') {
      const g = gainNode(ctx, eng.music);
      env(g, t, 0.45 * vel, 0.002, 0.18, 0, 0.05, 0.12);
      const o = osc(ctx, 'sine', 140, t, t + 0.35);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      o.connect(g);
    } else if (kind === 'snare') {
      const g = gainNode(ctx, eng.music);
      env(g, t, 0.16 * vel, 0.001, 0.12, 0, 0.06, 0.08);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 1800;
      noise(eng, t, 0.25, 1).connect(f).connect(g);
      fmVoice(ctx, eng.music, t, 190, 0.05, { ratio: 1.4, index: 3, vol: 0.1 * vel, decay: 0.08, sustain: 0, release: 0.05 });
    } else {
      const g = gainNode(ctx, eng.music);
      const dur = kind === 'open' ? 0.18 : 0.04;
      env(g, t, 0.05 * vel, 0.001, dur, 0, 0.03, dur);
      const f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 7000;
      noise(eng, t, dur + 0.1, 1).connect(f).connect(g);
    }
  };
  return {
    tracks: { lead: true, harm: true, bass: true, drums: true },
    lead: (t, m, dur, vel) => fmVoice(ctx, eng.music, t, midiToHz(m), dur, { ratio: 3.5, index: 1.6, indexEnd: 0.2, idecay: 0.4, vol: 0.075 * vel, decay: 0.9, sustain: 0.4, release: 0.2 }),
    harm: (t, chord, dur, vel) => chord.voicing.forEach((m, i) => epiano(t + i * 0.012, m, dur, 0.035 * vel, eng.music, (i - 1.5) * 0.25)),
    bass: (t, m, dur, vel) => fmVoice(ctx, eng.music, t, midiToHz(m), dur, { ratio: 0.5, index: 2.2, indexEnd: 0.4, idecay: 0.25, vol: 0.2 * vel, decay: 0.6, sustain: 0.5, release: 0.08 }),
    drum,
    impact: (t) => {
      fmVoice(ctx, eng.music, t, midiToHz(84), 1.5, { ratio: 3.5, index: 3, indexEnd: 0.2, idecay: 1.2, vol: 0.09, decay: 2, sustain: 0, release: 0.5 });
      drum(t, 'open', 2);
    },
    riser: (t, dur) => {
      const g = gainNode(ctx, eng.music);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.05, t + dur);
      g.gain.setValueAtTime(0, t + dur);
      const o = osc(ctx, 'sawtooth', 200, t, t + dur);
      o.frequency.exponentialRampToValueAtTime(1600, t + dur);
      o.connect(g);
    },
    sfx: {
      jump: (t) => {
        const c = fmVoice(ctx, eng.sfx, t, 330, 0.12, { ratio: 2, index: 2.5, indexEnd: 0.5, idecay: 0.1, vol: 0.1, decay: 0.12, sustain: 0, release: 0.05 });
        c.frequency.exponentialRampToValueAtTime(880, t + 0.1);
      },
      land: (t) => fmVoice(ctx, eng.sfx, t, 90, 0.05, { ratio: 1.5, index: 2, vol: 0.12, decay: 0.08, sustain: 0, release: 0.04 }),
      milestone: (t) => {
        fmVoice(ctx, eng.sfx, t, 1047, 0.4, { ratio: 3.5, index: 2, vol: 0.06, decay: 0.6, sustain: 0, release: 0.3 });
        fmVoice(ctx, eng.sfx, t + 0.09, 1568, 0.4, { ratio: 3.5, index: 2, vol: 0.06, decay: 0.6, sustain: 0, release: 0.3 });
      },
      meow: (t) => {
        // formant-ish FM: modulation index sweeps with the vowel ("mi-a-ow")
        const c = fmVoice(ctx, eng.sfx, t, 520, 0.55, { ratio: 1.5, index: 0.6, indexEnd: 2.8, idecay: 0.5, vol: 0.13, attack: 0.03, decay: 0.6, sustain: 0.8, release: 0.12 });
        c.frequency.setValueAtTime(520, t);
        c.frequency.linearRampToValueAtTime(820, t + 0.18);
        c.frequency.linearRampToValueAtTime(460, t + 0.55);
      },
    },
  };
}
