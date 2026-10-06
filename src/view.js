// Shared camera fit for the 2D and 3D views: the visible world width grows with the aspect
// ratio (portrait 11 units → wide 18), height is at least VIEW.minH, and the ground sits in
// the lower part of the screen with the spare height mostly given to the sky.
import { VIEW } from './config.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function computeView(cssW, cssH) {
  const aspect = cssW / cssH;
  const k = clamp((aspect - 0.6) / (1.8 - 0.6), 0, 1);
  const minW = VIEW.minWPortrait + (VIEW.minWWide - VIEW.minWPortrait) * k;
  const zoom = Math.min(cssW / minW, cssH / VIEW.minH); // css px per world unit
  const viewW = cssW / zoom;
  const viewH = cssH / zoom;
  const band = 4.4; // ground (−0.6) up to a held jump's apex
  const extra = Math.max(0, viewH - band);
  const below = 0.6 + extra * 0.32; // world units visible below the ground line
  return { cssW, cssH, zoom, viewW, viewH, below, catX: VIEW.catScreenX, portrait: aspect < 1 };
}
