// Renders instrument samples off the main thread so gameplay never stutters.
import { RECIPES } from './instruments.js';

self.onmessage = (e) => {
  const { sr, names } = e.data;
  for (const name of names) {
    const chs = RECIPES[name](sr);
    const copy = chs.map((c) => (c.byteOffset || c.length !== c.buffer.byteLength / 4 ? c.slice() : c));
    self.postMessage({ name, chs: copy }, copy.map((c) => c.buffer));
  }
};
