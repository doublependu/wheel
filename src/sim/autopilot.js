// Dev helper (?autopilot): jumps perfectly so every era can be watched hands-free.
import { JUMP } from '../config.js';
import { JUMP_VELOCITY } from './world.js';

export function createAutopilot() {
  const done = new Set();
  return (world) => {
    const next = world.obstacles.find((o) => !done.has(o.id) && o.x - world.dist > 0);
    if (!next || !world.cat.onGround) return false;
    if (next.x - world.dist <= world.speed * (JUMP_VELOCITY / JUMP.gravity)) {
      done.add(next.id);
      return true;
    }
    return false;
  };
}
