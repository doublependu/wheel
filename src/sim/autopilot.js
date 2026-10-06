// Dev/recording helper (?autopilot): jumps over every obstacle so the stages can be watched
// hands-free. ?autopilot=human varies each jump's timing inside the safe window, like a player;
// ?crash=<s> stops jumping after that much run time, or ?crash=<stage>:<s> that long after the
// stage arrives, so a recording ends on the game-over screen.
import { JUMP } from '../config.js';
import { JUMP_VELOCITY } from './world.js';
import { createRng } from './rng.js';

export function createAutopilot({ human = false, crash = null, seed = 1 } = {}) {
  const done = new Set();
  const rng = createRng(seed);
  const lead = new Map(); // obstacle id → timing offset (s), positive = earlier
  let crashAt = crash && !crash.era ? crash.after : Infinity;
  return (world) => {
    if (crash?.era && crashAt === Infinity && world.era >= crash.era) crashAt = world.t + crash.after;
    if (world.t >= crashAt) return false;
    const next = world.obstacles.find((o) => !done.has(o.id) && o.x - world.dist > 0);
    if (!next || !world.cat.onGround) return false;
    if (!lead.has(next.id)) lead.set(next.id, human ? (rng() - 0.5) * 0.12 : 0);
    const t = JUMP_VELOCITY / JUMP.gravity + lead.get(next.id);
    if (next.x - world.dist <= world.speed * t) {
      done.add(next.id);
      return true;
    }
    return false;
  };
}

// "40" → 40 s of run time; "7:40" → 40 s after stage 7 arrives.
export function parseCrash(v) {
  if (!v) return null;
  const [a, b] = v.split(':').map(Number);
  return b === undefined ? (Number.isFinite(a) ? { after: a } : null) : { era: a, after: b };
}
