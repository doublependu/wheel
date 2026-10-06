// Pixel-art obstacles rendered from the Sketchfab models (tools/build-obstacle-sprites.mjs).
// One small atlas holds every stage's frames; it's split into per-frame canvases so the renderer
// draws them exactly like the procedural fallback sprites ({ canvas, ox, oy }).
import atlasUrl from '../assets/obstacles.png?url';
import atlasMeta from '../assets/obstacles.json';
import { makeCanvas } from './palettes.js';
import { OBSTACLES } from '../config.js';

export async function loadObstacleAtlas() {
  const res = await fetch(atlasUrl);
  if (!res.ok) throw new Error(`obstacle atlas ${res.status}`);
  const image = await createImageBitmap(await res.blob());
  return new ObstacleAtlas(image, atlasMeta);
}

class ObstacleAtlas {
  constructor(image, meta) {
    this.image = image;
    this.meta = meta;
  }

  // { cucumber: [frame…], pot: […], vacuum: […], crow: […] } for a 2D stage, or null.
  frames(era) {
    const eraMeta = this.meta.eras[era];
    if (!eraMeta) return null;
    const ppu = this.meta.ppu[era];
    const out = {};
    for (const [type, frames] of Object.entries(eraMeta)) {
      // flying obstacles are modelled on the ground; lift them to their gameplay height
      const lift = Math.round((OBSTACLES[type]?.y ?? 0) * ppu);
      out[type] = frames.map(([x, y, w, h, ox, oy]) => {
        const canvas = makeCanvas(w, h);
        canvas.getContext('2d').drawImage(this.image, x, y, w, h, 0, 0, w, h);
        return { canvas, ox, oy: oy + lift };
      });
    }
    return out;
  }
}
