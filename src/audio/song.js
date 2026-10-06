// One original theme in C major at 90 BPM, written on a 16-step grid.
// Each era is 6 chill bars (lo-fi, swung) and a 2-bar upbeat build-up that drops into the next era.

// Chords: bass root + upper voicing (MIDI).
const CHORDS = {
  Cmaj9: { root: 36, voicing: [64, 67, 71, 74] },
  Am9: { root: 45, voicing: [60, 64, 67, 71] },
  Fmaj9: { root: 41, voicing: [57, 60, 64, 67] },
  G13: { root: 43, voicing: [65, 69, 71, 76] },
  G7: { root: 43, voicing: [65, 67, 71, 74] },
};
const CHILL_CHORDS = ['Cmaj9', 'Am9', 'Fmaj9', 'G13'];
const BUILD_CHORDS = ['Fmaj9', 'G7'];

// Melody bars: [step, midi, lengthInSteps]
const THEME = [
  [[0, 76, 4], [4, 74, 2], [6, 76, 2], [8, 79, 6]],
  [[0, 72, 4], [4, 71, 2], [6, 72, 2], [8, 76, 4], [12, 74, 4]],
  [[0, 69, 4], [4, 72, 2], [6, 76, 2], [8, 79, 4], [12, 77, 2], [14, 76, 2]],
  [[0, 74, 6], [6, 71, 2], [8, 74, 4]],
  [[0, 76, 4], [4, 79, 2], [6, 81, 2], [8, 79, 4], [12, 76, 4]],
  [[0, 72, 6], [6, 74, 2], [8, 76, 8]],
];
const BUILD_LEAD = [
  [69, 72, 76, 72, 69, 72, 76, 79].map((m, i) => [i * 2, m + 12, 2]),
  [67, 71, 74, 77, 71, 74, 77, 79, 74, 77, 79, 83, 77, 79, 83, 86].map((m, i) => [i, m, 1]),
];

// Drum patterns: [step, kind, velocity]
const CHILL_DRUMS = [
  [0, 'kick', 1], [10, 'kick', 0.8], [4, 'snare', 0.9], [12, 'snare', 0.9],
  ...[0, 2, 4, 6, 8, 10, 12, 14].map((s) => [s, 'hat', s % 4 === 0 ? 0.55 : 0.35]),
  [7, 'hat', 0.2], [15, 'hat', 0.25],
];
const CHILL_DRUMS_B = [...CHILL_DRUMS, [7, 'kick', 0.5], [14, 'snare', 0.25]];
const BUILD_DRUMS = [
  [
    [0, 'kick', 1], [4, 'kick', 1], [8, 'kick', 1], [12, 'kick', 1],
    [4, 'snare', 1], [12, 'snare', 1],
    ...Array.from({ length: 16 }, (_, s) => [s, 'hat', s % 2 ? 0.35 : 0.6]),
    [2, 'open', 0.5], [6, 'open', 0.5], [10, 'open', 0.5], [14, 'open', 0.5],
  ],
  [
    [0, 'kick', 1], [4, 'kick', 1], [8, 'kick', 1], [12, 'kick', 1],
    [4, 'snare', 0.8], [8, 'snare', 0.6], [10, 'snare', 0.7], [12, 'snare', 0.8], [13, 'snare', 0.85], [14, 'snare', 0.9], [15, 'snare', 1],
    ...Array.from({ length: 16 }, (_, s) => [s, 'hat', s % 2 ? 0.4 : 0.65]),
  ],
];

// What plays in one bar. desc = { kind: 'chill'|'build', index: bar index within the era
// (chill) or within the build (build), drop: first bar of a new era }.
export function barNotes(desc) {
  if (desc.kind === 'build') {
    const chord = CHORDS[BUILD_CHORDS[desc.index]];
    const r = chord.root;
    return {
      chord,
      swing: 0,
      lead: BUILD_LEAD[desc.index],
      bass: [0, 2, 4, 6, 8, 10, 12, 14].map((s, i) => [s, i % 3 === 2 ? r + 12 : r, 2]),
      harm: (desc.index === 0 ? [2, 6, 10, 14] : [0, 2, 4, 6, 8, 10, 12, 14]).map((s) => [s, 2]),
      arp: Array.from({ length: 16 }, (_, s) => [s, chord.voicing[s % 4] + (s >= 8 ? 12 : 0), 1]),
      drums: BUILD_DRUMS[desc.index],
      riser: desc.index === 0 ? 2 : 0, // riser length in bars, started on the first build bar
    };
  }
  const i = desc.index;
  const chord = CHORDS[CHILL_CHORDS[i % 4]];
  const r = chord.root;
  const lead = THEME[i % 6];
  return {
    chord,
    swing: 0.16,
    lead,
    bass: [[0, r, 7], [10, r + 7, 3], [14, r + 12, 2]],
    harm: [[0, 12], [10, 6]],
    arp: [0, 3, 6, 10].map((s, k) => [s, chord.voicing[k], 3]),
    drums: i % 2 ? CHILL_DRUMS_B : CHILL_DRUMS,
    riser: 0,
    impact: desc.drop,
  };
}

export const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
