// Renderer-agnostic game simulation. Fixed timestep; 2D logic (x = distance, y = height).
import {
  SIM_DT, SPEED, JUMP, CAT, OBSTACLES, GAPS, FIRST_OBSTACLE_AT, SPAWN_AHEAD, BREATHER,
  SCORE_PER_UNIT, MILESTONE,
} from '../config.js';
import { createRng } from './rng.js';
import { EraClock } from '../eras.js';

export const STRIDE = 1.3; // units travelled per gallop cycle

export function speedAt(t) {
  const f = 1 + SPEED.ramp * (1 - Math.exp(-t / SPEED.tau));
  return SPEED.v0 * Math.min(SPEED.cap, f);
}

export const JUMP_VELOCITY = Math.sqrt(2 * JUMP.gravity * JUMP.peak);

const OBSTACLE_TYPES = Object.keys(OBSTACLES);

export class World {
  constructor(opts = {}) {
    this.reset(opts);
  }

  reset({ seed = 1, gate = () => true, startEra = 1, fixedSpeed = null, spawn = true } = {}) {
    this.seed = seed;
    this.rng = createRng(seed);
    this.fixedSpeed = fixedSpeed;
    this.spawnEnabled = spawn;
    this.t = 0;
    this.dist = 0;
    this.speed = fixedSpeed ?? speedAt(0);
    this.cat = { y: 0, vy: 0, onGround: true, holding: false, holdT: 0, buffer: 0, airT: 0, phase: 0 };
    this.obstacles = [];
    this.nextObstacleX = FIRST_OBSTACLE_AT * this.speed;
    this.nextId = 1;
    this.alive = true;
    this.score = 0;
    this.nextMilestone = MILESTONE;
    this.clock = new EraClock(gate, startEra);
    this.section = this.clock.sections[0];
    this.era = this.section.era;
    this.hitObstacle = null;
    this.events = [];
  }

  emit(type, data = {}) {
    this.events.push({ type, t: this.t, ...data });
  }

  // input: { press: true on the step the button went down, held: button is down }
  step(input = {}) {
    if (!this.alive) return;
    const dt = SIM_DT;
    this.t += dt;
    this.speed = this.fixedSpeed ?? speedAt(this.t);
    this.dist += this.speed * dt;

    for (const s of this.clock.plan(this.t)) this.emit('planned', { section: s });
    const sec = this.clock.sectionAt(this.t);
    if (sec !== this.section) {
      if (sec.era !== this.section.era) this.emit('era', { era: sec.era, from: this.section.era });
      if (sec.kind === 'build') this.emit('build', { era: sec.era });
      this.section = sec;
      this.era = sec.era;
    }

    this.#updateCat(dt, input);
    if (this.spawnEnabled) this.#spawn();

    while (this.obstacles.length && this.obstacles[0].x < this.dist - 8) this.obstacles.shift();

    const hit = this.#collide();
    if (hit) {
      this.alive = false;
      this.hitObstacle = hit;
      this.emit('hit', { obstacle: hit });
    }

    this.score = Math.floor(this.dist * SCORE_PER_UNIT);
    if (this.score >= this.nextMilestone) {
      this.emit('milestone', { score: this.nextMilestone });
      this.nextMilestone += MILESTONE;
    }
  }

  #updateCat(dt, input) {
    const c = this.cat;
    if (input.press) c.buffer = JUMP.buffer;
    if (!input.held) c.holding = false;

    if (c.onGround && c.buffer > 0) {
      c.vy = JUMP_VELOCITY;
      c.onGround = false;
      c.holding = !!input.held;
      c.holdT = 0;
      c.airT = 0;
      c.buffer = 0;
      this.emit('jump');
    }
    c.buffer = Math.max(0, c.buffer - dt);

    if (!c.onGround) {
      let g = JUMP.gravity;
      if (c.holding && c.vy > 0 && c.holdT < JUMP.holdMax) {
        g *= JUMP.holdGravityScale;
        c.holdT += dt;
      }
      c.vy -= g * dt;
      c.y += c.vy * dt;
      c.airT += dt;
      if (c.y <= 0) {
        c.y = 0;
        c.vy = 0;
        c.onGround = true;
        this.emit('land');
      }
    }
    c.phase = (c.phase + (this.speed * dt) / STRIDE) % 1;
  }

  #reachTime(x) {
    return this.t + (x - this.dist) / this.speed;
  }

  #spawn() {
    while (this.nextObstacleX - this.dist < SPAWN_AHEAD) {
      let x = this.nextObstacleX;
      for (const drop of this.clock.dropTimes()) {
        const tr = this.#reachTime(x);
        if (tr > drop - BREATHER.before && tr < drop + BREATHER.after) {
          x = this.dist + (drop + BREATHER.after + 0.15 - this.t) * this.speed;
        }
      }
      const reach = this.#reachTime(x);
      const era = this.clock.sectionAt(reach)?.era ?? this.era;
      const choices = OBSTACLE_TYPES.filter((k) => OBSTACLES[k].minEra <= era).map((k) => [k, OBSTACLES[k].weight]);
      const type = this.rng.pick(choices);
      this.addObstacle(type, x);
      const [gMin, gMax] = GAPS[era];
      this.nextObstacleX = x + this.rng.range(gMin, gMax) * this.speed;
    }
  }

  addObstacle(type, x) {
    const def = OBSTACLES[type];
    const o = { id: this.nextId++, type, x, def, seed: this.rng() };
    this.obstacles.push(o);
    return o;
  }

  #collide() {
    const c = this.cat;
    const cx0 = this.dist - CAT.w / 2;
    const cx1 = this.dist + CAT.w / 2;
    const cy0 = c.y;
    const cy1 = c.y + CAT.h;
    for (const o of this.obstacles) {
      const h = o.def.hit;
      const ox0 = o.x - h.w / 2;
      if (ox0 > cx1) break;
      const ox1 = o.x + h.w / 2;
      if (ox1 < cx0) continue;
      if (cy0 < h.y + h.h && cy1 > h.y) return o;
    }
    return null;
  }

  consumeEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }
}
