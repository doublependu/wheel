# Next 3 — implementation summary and what to do next

Implements `ai/plan_3.md` (revision 2). Not committed.

## What was built

| Area | Where | Notes |
|---|---|---|
| The wheel's clock | `src/loader/netSpeed.js` (new) | A seeded table of speed segments (steady, slow, near-stall, burst) with a closed-form running total, scaled to average exactly 1×. It differs on each visit; `?seed=` repeats it. `WheelClock` adds the miss hitch on top and never runs backwards. It lives in the core, and the 3D wheel and the CSS one both read it. |
| Motion | `src/loader/orbitPhysics.js` (rewritten) | One hop: seams open (0–0.10), burst, pieces fly and grind down (to 0.48), the bulk of the dust lands (0.34–0.74), rest. Piece motion, the dust schedule in three groups (80 % bulk, 10 % stragglers, 10 % leaders), the shades' strengths and the layout are pure functions. The twins, tides and CSS `ease` are gone. |
| Planets | `src/render3d/bodies.js` | The sphere is cut into 12 / 18 / 26 / 36 solid wedges (Low to Ultra) that tile it exactly, so the whole planet and its pieces are one mesh. The vertex shader flies, tumbles and shrinks each wedge; inner faces are flat-shaded magma that cools. A faint shade is the same mesh and material drawn as a sparse, shimmering stipple. Still one material for all eight looks. The star, ice and mercury materials are gone. |
| Scene | `src/render3d/orbit.js` | The star, twins, corona and shadows are gone. Light: studio environment at 1.6, a warm key light, the cool rim light and a blast light at the bursting planet. Dust is still GPU compute with the same counts; each mote runs its group's routine. Two shades are drawn at most. In the first hop the dust starts where the pre-loader's flat dots stood. A hit spirals everything into the empty hub. |
| CSS fallback | `src/loader/lite.js` (new), `index.html` | One coloured dot at a time, 5 crumbs that carry it on, a faint disc before and after it with a crumb trickling along each gap, and a mirrored copy. All of it is compositor animations whose playback rate is steered after the wheel clock. `index.html`'s inline script now builds only the pre-loader. |
| Wiring | `src/main.js`, `src/render3d/graphics3d.js`, `src/config.js` | `main.js` owns the clock and passes it to the 3D module. `ORBIT` holds the hop and its windows; `NET` holds the connection states. |
| Tests | `tests/loader.test.js` | 30 loader tests (46 in all): the hop's order, eight stations per lap, where every mote is, the neighbours, clearance from the floor and the forming planet, the clock, reduced motion, and the gate as before. |
| Docs | `README.md`, `CREDITS.md`, the Credits dialog | The new wheel. The Twin Orbit credit is removed. |
| Pictures | `recordings/wheel-hop-high.png`, `wheel-hop-low.png`, `wheel-eight-planets.png` (git-ignored) | Twelve frames of one hop at High and at Low, and all eight planets at rest with their neighbours. |

## Measured

- **Load** (production build, cold cache, `npm run loadtime`, median of 3; before → now):

  | GPU | Profile | Fancy wheel plays | Menu loaded behind it |
  |---|---|---|---|
  | Intel UHD, WebGL2 (Medium) | 50 Mbps / 40 ms | 0.81 → **0.71 s** | 2.15 → 2.48 s |
  | | 10 Mbps / 100 ms / 4× CPU | 2.70 → **2.19 s** | 4.25 → 4.18 s |
  | RTX 3050, WebGPU (High) | 50 Mbps / 40 ms | 1.15 → **0.80 s** | 2.55 → 2.61 s |
  | | 10 Mbps / 100 ms / 4× CPU | 3.25 → **2.35 s** | 4.98 → 4.40 s |

  Worst single run: 2.52 s (the first run after Chrome starts). The plan's target is met: the wheel plays earlier on every profile, the slow profile is under 2.5 s, and nothing is past 4 s. The menu is ready 0.3 s later on the Intel fast profile; I didn't find out why, and it is still well inside the 5 quiet seconds.
- **Frame rate**: the wheel holds this laptop's display cadence on the Intel iGPU at Low, Medium and High (p50 18–19 ms, p95 22–23 ms at 1280×800, and the same at 390×844 on Low), as before.
- **Benchmark verdicts**: Medium on the Intel iGPU and High on the RTX, the same as before.
- `npm test`: 46/46. `npm run build`: the budget passes (HTML 4.7 KB, core 20.8 KB, the 3D chunk 287 KB gzip).

## Deviations from the plan

- **Every planet breaks in the same pattern**, relative to where its matter is headed. The plan gave each mesh its own rotation. Each mesh is instead turned into its station's frame, which lets every mote's release point be worked out once on the CPU. On screen each break is turned 45° from the last.
- **Shades and motes are stronger on small screens.** The plan had a fixed 10–15 % stipple. On a phone at Low a planet is about 30 rendered pixels wide and neither the stipple nor the motes read, so both scale with the wheel's size in pixels: up to 2.3× bigger motes and up to 30 % stipple.
- **Dust brightness is scaled per tier**, or Ultra's 24k motes burn out to white. Motes hanging in a shade are drawn dimmer.
- **Connection shares** came out at about 58 % steady, 18 % slow, 7 % near-stall and 17 % burst (plan: 55 / 20 / 8 / 17). A table is redrawn until it averages within 5 % of 1×, so the final scaling keeps each state near its speed range.
- **The CSS wheel's first hop** starts with a dot bursting at the station before the first planet's. Its crumbs are a neutral dust colour.
- **The dust's floor clearance isn't a JS test.** The pieces are tested; the motes are clamped above the mirror in the compute shader.
- **The core grew by 2.3 KB**, not 1.3 KB.
- **Chrome is the darkest planet.** It used to reflect the star. It now has a little less metal and more roughness, and the environment is brighter, but it still reads as a dark ball with highlights.

## Found and fixed on the way

- **The mirror was cut off on tall, narrow screens** (phones in portrait): the floor disc was too small for the far camera, so the reflection ended in a hard edge. The disc is wider now.
- **The 3.5 s cap could be missed.** The cap was only checked between frames, and the 3D wheel's first frame blocks the page while it compiles. Under very heavy throttling (1.6 Mbps, 6× CPU) the fancy wheel started at 4.17 s. Now, if that first frame would begin within 0.8 s of the cap (`LOADER.warm`), the CSS wheel starts first and keeps moving through the block. Same test: 3.45 s, with the 3D wheel taking over in phase at about 4.3 s.
- **three r186 on WebGL2**: compute is transform feedback with at most four outputs, and a second read-only storage buffer read back as zeros. The dust schedule is one read-only buffer for that reason.

## Not verified here

- **Phones**: real Safari/iOS and Android. Only emulation at 390×844 on this laptop, at Low.
- **The full recording** (`npm run record`) wasn't run. The recorder waits on the same body classes as before, and the click-through to the menu was checked with a separate script.
- **The CSS wheel in Safari and Firefox**: it animates the individual `rotate` and `scale` properties, checked in Chrome only.
- **Windows and macOS GPUs**, and HDR displays.

## Next

1. **Look at it and tune.** The knobs are `ORBIT.hop` (2 s per planet), the `NET` table (how rough the connection is) and `ORBIT.shade` (how faint the neighbours are). The filmstrips in `recordings/` show one hop without running anything.
2. **Chrome planet**: give it something brighter to reflect, or swap the look for one that suits a dark stage.
3. **The mirror on Low** is blocky up close (a 0.35× reflection). The scene is light enough now to try 0.5×.
4. **Playtest the gate** with a few people (carried over from next_2): are 5 s plus 35 % first-try odds funny or annoying?
5. **Record a full video** (`npm run record`) after committing, so the corner tag matches.
6. **Commit, then deploy** (`npx wrangler login && npm run deploy`).
