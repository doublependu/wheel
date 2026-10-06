// Per-stage pixel-art settings for the obstacle sprites (tools/build-obstacle-sprites.mjs).
// `families` maps a rendered pixel's colour family to a ramp (dark → light) of the stage palette.
// Outline colours are chosen for contrast against each stage's background band (see ?contrast).
export const OBSTACLE_LOOK = {
  1: { outline: null },
  // CGA: a white outline like the cat's; it reads on both the black sky and the magenta hills
  2: {
    families: {
      white: ['#ffffff'], dark: ['#000000'], grey: ['#000000', '#ffffff'],
      red: ['#000000', '#ff55ff'], orange: ['#000000', '#ff55ff'], yellow: ['#ff55ff', '#ffffff'],
      green: ['#000000', '#55ffff'], cyan: ['#55ffff', '#ffffff'], blue: ['#000000', '#55ffff'], magenta: ['#ff55ff', '#ffffff'],
    },
    outline: { default: '#ffffff' },
  },
  3: {
    // no sky blue anywhere, so no obstacle melts into the sky
    families: {
      white: ['#d7d7d7'], dark: ['#000000'], grey: ['#000000', '#d7d7d7'],
      red: ['#000000', '#d70000', '#d7d700'], orange: ['#000000', '#d70000', '#d7d700'], yellow: ['#d7d700'],
      green: ['#000000', '#00d700'], cyan: ['#00d7d7', '#d7d7d7'], blue: ['#000000', '#00d7d7'], magenta: ['#d700d7', '#d7d7d7'],
    },
    outline: { default: '#000000' },
  },
  // a warm rim, as if back-lit by the sunset, lifts dark shapes off the dusk town
  4: { dither: 0.5, outline: { default: '#f0c890' } },
};
