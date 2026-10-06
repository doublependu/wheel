// Instrument synthesis into Float32 sample arrays (runs in a worker; no Web Audio needed).
import { midiToHz } from './song.js';

const TAU = Math.PI * 2;

// ---------- tiny DSP toolkit ----------
function coeffs(type, f, q, sr) {
  const w0 = (TAU * Math.min(f, sr * 0.45)) / sr;
  const c = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  let b0, b1, b2;
  if (type === 'lp') [b0, b1, b2] = [(1 - c) / 2, 1 - c, (1 - c) / 2];
  else if (type === 'hp') [b0, b1, b2] = [(1 + c) / 2, -(1 + c), (1 + c) / 2];
  else [b0, b1, b2] = [alpha, 0, -alpha];
  const a0 = 1 + alpha;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: (-2 * c) / a0, a2: (1 - alpha) / a0 };
}

function biquad(x, type, f, q, sr) {
  const k = coeffs(type, f, q, sr);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const y = k.b0 * x[i] + k.b1 * x1 + k.b2 * x2 - k.a1 * y1 - k.a2 * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = y;
    x[i] = y;
  }
  return x;
}

function normalize(chs, peak = 0.9) {
  let m = 1e-6;
  for (const c of chs) for (let i = 0; i < c.length; i++) m = Math.max(m, Math.abs(c[i]));
  for (const c of chs) for (let i = 0; i < c.length; i++) c[i] *= peak / m;
  return chs;
}

const rand = () => Math.random() * 2 - 1;

// ---------- instruments (Float32 synthesis) ----------
export function rhodes(sr, root) {
  const f = midiToHz(root);
  const n = Math.floor(sr * 2.6);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const idx = 1.6 * Math.exp(-t / 0.5) + 0.25;
    const tine = 0.5 * Math.exp(-t / 0.025);
    const y = Math.sin(TAU * f * t + idx * Math.sin(TAU * f * t) + tine * Math.sin(TAU * 14 * f * t));
    const a = Math.exp(-t / 1.4) * (1 - Math.exp(-t / 0.002));
    const trem = 0.22 * Math.sin(TAU * 4.2 * t);
    L[i] = y * a * (1 + trem);
    R[i] = y * a * (1 - trem);
  }
  return normalize([L, R], 0.8);
}

function pluck(sr, root) {
  const f = midiToHz(root);
  const n = Math.floor(sr * 1.8);
  const out = new Float32Array(n);
  const N = Math.max(2, Math.round(sr / f));
  const line = new Float32Array(N);
  for (let i = 0; i < N; i++) line[i] = rand() * 0.8;
  biquad(line, 'lp', 3500, 0.7, sr);
  let p = 0;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const cur = line[p];
    const y = 0.4985 * (cur + prev);
    prev = cur;
    line[p] = y;
    out[i] = cur;
    p = (p + 1) % N;
  }
  biquad(out, 'lp', 5000, 0.6, sr);
  return normalize([out], 0.8);
}

function fingerBass(sr, root) {
  const f = midiToHz(root);
  const n = Math.floor(sr * 1.6);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const ph = TAU * f * t;
    const bright = Math.exp(-t / 0.12);
    const y = Math.sin(ph) + (0.25 + 0.3 * bright) * Math.sin(2 * ph) + 0.12 * bright * Math.sin(3 * ph);
    out[i] = y * Math.exp(-t / 1.1) * (1 - Math.exp(-t / 0.004));
  }
  return normalize([out], 0.85);
}

function supersaw(sr, root, dur = 3.2) {
  const f = midiToHz(root);
  const n = Math.floor(sr * dur);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const det = [-14, -9, -4, 0, 4, 9, 14];
  const ph = det.map(() => Math.random());
  for (let v = 0; v < det.length; v++) {
    const fv = f * Math.pow(2, det[v] / 1200);
    const pan = v / (det.length - 1);
    let p = ph[v];
    for (let i = 0; i < n; i++) {
      p += fv / sr;
      p -= Math.floor(p);
      const s = 2 * p - 1;
      L[i] += s * (1 - pan);
      R[i] += s * pan;
    }
  }
  for (const c of [L, R]) {
    biquad(c, 'lp', 2400, 0.6, sr);
    biquad(c, 'lp', 3200, 0.5, sr);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      c[i] *= Math.min(1, t / 0.45) * (t > dur - 0.6 ? Math.max(0, (dur - t) / 0.6) : 1);
    }
  }
  return normalize([L, R], 0.7);
}

function choir(sr, root, dur = 3.2) {
  const f = midiToHz(root);
  const n = Math.floor(sr * dur);
  const src = new Float32Array(n);
  let p1 = 0, p2 = 0.3;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const vib = 1 + 0.006 * Math.sin(TAU * 5.2 * t) * Math.min(1, t / 0.6);
    p1 += (f * vib) / sr;
    p2 += (f * vib * 1.004) / sr;
    p1 -= Math.floor(p1);
    p2 -= Math.floor(p2);
    src[i] = 2 * p1 - 1 + (2 * p2 - 1) + rand() * 0.08;
  }
  const out = new Float32Array(n);
  for (const [fq, q, g] of [[800, 8, 1], [1150, 9, 0.6], [2900, 10, 0.25]]) {
    const b = biquad(Float32Array.from(src), 'bp', fq, q, sr);
    for (let i = 0; i < n; i++) out[i] += b[i] * g;
  }
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    out[i] *= Math.min(1, t / 0.5) * (t > dur - 0.7 ? Math.max(0, (dur - t) / 0.7) : 1);
  }
  const R = Float32Array.from(out);
  return normalize([out, R], 0.7);
}

function drum(sr, kind) {
  const len = { kick: 0.6, snare: 0.45, hat: 0.12, open: 0.5, crash: 2.4, timpani: 2.8 }[kind];
  const n = Math.floor(sr * len);
  const out = new Float32Array(n);
  if (kind === 'kick') {
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      ph += (TAU * (48 + 110 * Math.exp(-t / 0.035))) / sr;
      out[i] = Math.sin(ph) * Math.exp(-t / 0.32) + rand() * 0.25 * Math.exp(-t / 0.003);
    }
  } else if (kind === 'snare') {
    const nz = new Float32Array(n);
    for (let i = 0; i < n; i++) nz[i] = rand();
    biquad(nz, 'bp', 2200, 0.6, sr);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      out[i] = nz[i] * Math.exp(-t / 0.13) * 1.6 + Math.sin(TAU * 185 * t) * Math.exp(-t / 0.05) * 0.6;
    }
  } else if (kind === 'hat' || kind === 'open' || kind === 'crash') {
    const decay = { hat: 0.028, open: 0.2, crash: 0.9 }[kind];
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      let m = 0;
      for (const fr of [3150, 4720, 6080, 7240, 8530]) m += Math.sign(Math.sin(TAU * fr * t));
      out[i] = (m * 0.15 + rand()) * Math.exp(-t / decay);
    }
    biquad(out, 'hp', kind === 'crash' ? 4000 : 6500, 0.7, sr);
  } else if (kind === 'timpani') {
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const f = 82 * (1 + 0.04 * Math.exp(-t / 0.08));
      out[i] = (Math.sin(TAU * f * t) + 0.5 * Math.sin(TAU * f * 1.5 * t) * Math.exp(-t / 0.6) + 0.3 * Math.sin(TAU * f * 1.98 * t) * Math.exp(-t / 0.4)) *
        Math.exp(-t / 1.3) + rand() * 0.4 * Math.exp(-t / 0.01);
    }
  }
  return normalize([out], 0.9);
}

// Formant-synthesized meow: "m-i-a-o-w" with a rising then falling pitch.
function meow(sr) {
  const dur = 0.85;
  const n = Math.floor(sr * dur);
  const out = new Float32Array(n);
  const f0 = (t) => (t < 0.12 ? 520 + (t / 0.12) * 260 : t < 0.32 ? 780 + ((t - 0.12) / 0.2) * 60 : 840 - ((t - 0.32) / 0.53) * 420);
  const fm = (t) => {
    const k = Math.min(1, t / dur);
    const lerp = (a, b, x) => a + (b - a) * x;
    if (k < 0.25) return [lerp(350, 850, k / 0.25), lerp(2300, 1500, k / 0.25)];
    if (k < 0.7) return [lerp(850, 700, (k - 0.25) / 0.45), lerp(1500, 1100, (k - 0.25) / 0.45)];
    return [lerp(700, 400, (k - 0.7) / 0.3), lerp(1100, 750, (k - 0.7) / 0.3)];
  };
  let ph = 0;
  const st = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  let k = null;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    ph += (f0(t) * (1 + 0.01 * Math.sin(TAU * 6 * t))) / sr;
    ph -= Math.floor(ph);
    const src = (2 * ph - 1) * 0.8 + rand() * 0.12;
    if (i % 64 === 0) {
      const [F1, F2] = fm(t);
      k = [coeffs('bp', F1, 6, sr), coeffs('bp', F2, 8, sr), coeffs('bp', 3200, 10, sr)];
    }
    let y = 0;
    for (let j = 0; j < 3; j++) {
      const c = k[j];
      const s = st[j];
      const v = c.b0 * src + c.b1 * s[0] + c.b2 * s[1] - c.a1 * s[2] - c.a2 * s[3];
      s[1] = s[0];
      s[0] = src;
      s[3] = s[2];
      s[2] = v;
      y += v * [1, 0.7, 0.2][j];
    }
    const a = Math.min(1, t / 0.05) * (t > dur - 0.25 ? Math.max(0, (dur - t) / 0.25) : 1);
    out[i] = y * a;
  }
  return normalize([out], 0.9);
}

function crackle(sr) {
  const n = sr * 4;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = rand() * 0.015;
  biquad(out, 'lp', 5000, 0.7, sr);
  for (let k = 0; k < 90; k++) {
    const at = Math.floor(Math.random() * (n - 200));
    const a = Math.random() ** 2 * 0.9;
    for (let j = 0; j < 40; j++) out[at + j] += rand() * a * Math.exp(-j / 6);
  }
  return [out];
}

function wind(sr) {
  const n = sr * 6;
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  let bl = 0, br = 0;
  for (let i = 0; i < n; i++) {
    bl = bl * 0.995 + rand() * 0.05;
    br = br * 0.995 + rand() * 0.05;
    const m = 0.6 + 0.4 * Math.sin((TAU * i) / n + Math.sin((TAU * 3 * i) / n));
    L[i] = bl * m;
    R[i] = br * m;
  }
  // seamless loop
  const fade = sr * 0.5;
  for (let i = 0; i < fade; i++) {
    const a = i / fade;
    L[i] = L[i] * a + L[n - fade + i] * (1 - a);
    R[i] = R[i] * a + R[n - fade + i] * (1 - a);
  }
  return normalize([L.subarray(0, n - fade), R.subarray(0, n - fade)], 0.5);
}

function impulse(sr, seconds, damp) {
  const n = Math.floor(sr * seconds);
  const chs = [new Float32Array(n), new Float32Array(n)];
  for (const c of chs) {
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const k = Math.min(0.98, 0.2 + (t / seconds) * damp);
      lp = lp * k + rand() * (1 - k);
      c[i] = lp * Math.pow(1 - t / seconds, 2.2) * (i < sr * 0.004 ? i / (sr * 0.004) : 1);
    }
  }
  return normalize(chs, 0.6);
}


// Everything the hi-fi eras need, as { name: [Float32Array per channel] }.
export const RECIPES = {
  'rhodes:48': (sr) => rhodes(sr, 48),
  'rhodes:60': (sr) => rhodes(sr, 60),
  'rhodes:72': (sr) => rhodes(sr, 72),
  'pluck:60': (sr) => pluck(sr, 60),
  'pluck:72': (sr) => pluck(sr, 72),
  'bass:33': (sr) => fingerBass(sr, 33),
  'bass:45': (sr) => fingerBass(sr, 45),
  'kit:kick': (sr) => drum(sr, 'kick'),
  'kit:snare': (sr) => drum(sr, 'snare'),
  'kit:hat': (sr) => drum(sr, 'hat'),
  'kit:open': (sr) => drum(sr, 'open'),
  'kit:crash': (sr) => drum(sr, 'crash'),
  meow: (sr) => meow(sr),
  crackle: (sr) => crackle(sr),
  'ir:room': (sr) => impulse(sr, 1.1, 0.6),
  'strings:48': (sr) => supersaw(sr, 48),
  'strings:60': (sr) => supersaw(sr, 60),
  'choir:60': (sr) => choir(sr, 60),
  timpani: (sr) => drum(sr, 'timpani'),
  wind: (sr) => wind(sr),
  'ir:hall': (sr) => impulse(sr, 2.8, 0.75),
};
