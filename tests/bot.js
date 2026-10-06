// "Player" bots for fairness and reachability tests.
import { World, JUMP_VELOCITY } from '../src/sim/world.js';
import { JUMP, VIEW } from '../src/config.js';
import { createRng } from '../src/sim/rng.js';

// Distance (cat centre → obstacle centre) at which a tap jump is perfectly centred on an obstacle.
export const idealJumpDistance = (speed) => speed * (JUMP_VELOCITY / JUMP.gravity);

// sigma: jump-timing error (s). sloppy: chance a press uses 3× the error. reaction: seconds an
// obstacle must be visible before the bot can react. lookahead: visible units ahead (portrait worst case).
export function runBot({ seed = 1, sigma = 0.07, sloppy = 0.01, reaction = 0.25, maxTime = 140, gate } = {}) {
  const world = new World({ seed, gate });
  const rng = createRng((seed * 2654435761) >>> 0);
  const lookahead = VIEW.minWPortrait - VIEW.catScreenX;
  const seenAt = new Map();
  const error = new Map();
  const done = new Set();
  while (world.alive && world.t < maxTime) {
    let press = false;
    const next = world.obstacles.find((o) => !done.has(o.id) && o.x - world.dist > 0);
    if (next) {
      const r = next.x - world.dist;
      if (r <= lookahead && !seenAt.has(next.id)) seenAt.set(next.id, world.t);
      if (!error.has(next.id)) error.set(next.id, rng.normal() * sigma * (rng() < sloppy ? 3 : 1));
      const canReact = seenAt.has(next.id) && world.t - seenAt.get(next.id) >= reaction;
      const trigger = idealJumpDistance(world.speed) + error.get(next.id) * world.speed;
      if (canReact && r <= trigger && world.cat.onGround) {
        press = true;
        done.add(next.id);
      }
    }
    world.step({ press, held: press });
  }
  return { time: world.t, era: world.era, alive: world.alive, score: world.score };
}
