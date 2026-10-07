// "Fancy-lite": the fancy loading wheel's CSS stand-in, for when the 3D wheel isn't ready by
// LOADER.cap (or never will be). The same story in flat dots: one coloured dot at a time, which
// bursts into crumbs that travel to the next station, where the next dot grows; the dot before it
// and the one to come show as faint, soft discs, with a crumb trickling along each gap; a mirrored
// copy below. Styles: index.html (.ld-lite).
//
// Everything is a Web Animation of scale, rotate or opacity, so it runs on the compositor and keeps
// moving while the main thread is busy compiling the 3D wheel. The animations' timelines are in
// wheel time: their playback rate is steered after the wheel's clock (netSpeed.js), which speeds up,
// slows down and hitches. So the 3D wheel can take over in the middle of a hop, in phase.
import { ORBIT } from '../config.js';

const COLORS = ['#ff6a2a', '#3f7fd8', '#e9b980', '#9fe6ff', '#f6e6f0', '#dfe5ee', '#d0559a', '#b0a493']; // LOOKS in render3d/bodies.js
const FAINT = 0.3;
const smooth = (x) => x * x * (3 - 2 * x);

export class Lite {
  constructor(clock) {
    this.clock = clock;
    this.anims = [];
    this.timer = 0;
  }

  start() {
    if (this.timer) return;
    const c = ORBIT;
    const N = c.stations;
    const hop = c.hop * 1000;
    const lap = hop * N;
    const now = performance.now() / 1000;
    const w = this.clock.at(now) * 1000; // wheel time so far, ms
    const play = (el, frames, duration, at) => {
      const a = el.animate(frames, { duration, iterations: Infinity });
      a.currentTime = w + at;
      this.anims.push(a);
      return a;
    };
    // A station's lap, y hops into the hop that forms its dot (and starting a hop before that):
    // a faint disc as leaders gather, the dot growing with its dust, whole, bursting at 1 + seams,
    // and a faint disc again until its stragglers have left.
    const at = (y) => (y + 1) / N;
    const grow = [0, 0.25, 0.5, 0.75, 1].map((k) => {
      const y = c.accrete[0] + (c.accrete[1] - c.accrete[0]) * k;
      return { offset: at(y), scale: Math.cbrt(smooth(k)) };
    });
    const burst = 1 + c.seams;
    const dot = [{ offset: 0, scale: 0 }, ...grow, { offset: at(1), scale: 1 }, { offset: at(burst), scale: 1.08 }, { offset: at(burst + 0.1), scale: 0 }, { offset: 1, scale: 0 }];
    const lead = c.leaders.leave.map((v) => v + c.leaders.flight - 1); // when leaders arrive
    const shade = [
      { offset: 0, opacity: 0 }, { offset: at(lead[0]), opacity: 0 }, { offset: at(lead[1]), opacity: FAINT },
      { offset: at(c.accrete[0]), opacity: FAINT }, { offset: at(c.accrete[0] + 0.26), opacity: 0 },
      { offset: at(burst), opacity: 0 }, { offset: at(burst + 0.2), opacity: FAINT },
      { offset: at(1 + c.stragglers.leave[0]), opacity: FAINT }, { offset: at(1 + c.stragglers.leave[1]), opacity: 0 }, { offset: 1, opacity: 0 },
    ];
    // A crumb's hop: along the ring from one station to the next (the head turns to the station the
    // matter leaves), dipping toward the hub on the way.
    const crumb = (leave, land, from = 0) => [
      { offset: 0, rotate: `${from}deg`, scale: 1, opacity: 0 },
      { offset: leave, rotate: `${from}deg`, scale: 1, opacity: 0 },
      { offset: leave + 0.03, rotate: `${from + 1}deg`, scale: 1, opacity: 1 },
      { offset: (leave + land) / 2, rotate: `${from + 22.5}deg`, scale: 0.9, opacity: 1 },
      { offset: land - 0.03, rotate: `${from + 44}deg`, scale: 1, opacity: 1 },
      { offset: land, rotate: `${from + 45}deg`, scale: 1, opacity: 0 },
      { offset: 1, rotate: `${from + 45}deg`, scale: 1, opacity: 0 },
    ];
    const crumbs = [];
    for (let j = 0; j < 5; j++) crumbs.push({ r: 0.27 + 0.02 * j, frames: crumb(c.seams + 0.03 + 0.05 * j, c.accrete[0] + 0.08 + 0.08 * j) }); // the bulk
    crumbs.push({ r: 0.3125, frames: crumb(c.stragglers.leave[0] + 0.02, 0.98) }); // a straggler, into the whole dot
    crumbs.push({ r: 0.3125, frames: crumb(c.leaders.leave[0] + 0.1, c.leaders.leave[0] + 0.5, 45) }); // a leader, on from it

    for (const root of document.querySelectorAll('#loader .ld')) {
      const box = document.createElement('div');
      box.className = 'ld-lite';
      let html = '';
      for (let i = 0; i < N; i++) {
        const a = (i * 2 * Math.PI) / N;
        const where = `left:${50 + 31.25 * Math.cos(a)}%;top:${50 + 31.25 * Math.sin(a)}%;--c:${COLORS[i]}`;
        html += `<u style="${where}"></u><i style="${where}"></i>`;
      }
      box.innerHTML = `${html}<s>${crumbs.map((k) => `<b style="--r:${k.r}"></b>`).join('')}</s>`;
      root.append(box);
      for (let i = 0; i < N; i++) {
        const n = (i - this.clock.first + N) % N; // the hop that forms this station's dot
        const from = ((((1 - n) % N) + N) % N) * hop;
        play(box.children[i * 2], shade, lap, from);
        play(box.children[i * 2 + 1], dot, lap, from);
      }
      const head = box.lastElementChild;
      const a0 = (this.clock.first - 1) * 45;
      const turn = head.animate([{ rotate: `${a0}deg` }, { rotate: `${a0 + 360}deg` }], { duration: lap, iterations: Infinity, easing: `steps(${N}, end)` });
      turn.currentTime = w;
      this.anims.push(turn);
      this.ref ??= turn; // its time is the wheel time the animations show
      [...head.children].forEach((b, k) => play(b, crumbs[k].frames, hop, 0));
    }
    this.seen = [now, w / 1000];
    this.timer = setInterval(this.#steer, 90);
    this.#steer();
  }

  // Run the animations at the wheel clock's speed, plus whatever closes the gap to it.
  #steer = () => {
    const now = performance.now() / 1000;
    const w = this.clock.at(now);
    const [then, was] = this.seen;
    const speed = now > then ? (w - was) / (now - then) : 1;
    this.seen = [now, w];
    const rate = Math.min(4, Math.max(0, speed + (w - this.ref.currentTime / 1000) / 0.3));
    for (const a of this.anims) a.updatePlaybackRate(rate);
  };

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = 0;
    for (const a of this.anims) a.cancel();
    this.anims = [];
    this.ref = null;
    for (const el of document.querySelectorAll('.ld-lite')) el.remove();
  }
}
