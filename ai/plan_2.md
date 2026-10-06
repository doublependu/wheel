# Plan 2: a simple pre-loader, then a fancy planet-orbit loading wheel, then a chance to get in

Answers `ai/prompt_2.md`.

**Revision 2** (follow-up in chat):
- the defaults are approved;
- the reference components were fetched and read;
- **the fancy wheel playing counts as "page loading done"**;
- a simpler pre-load wheel comes first and covers loading the fancy one.

## 0. Summary

| Prompt item | Plan |
|---|---|
| Loading wheel based on Spiral and Twin Orbit | The fancy wheel is both references built in 3D. **Spiral** becomes a ring of 8 planetoids that form, mature and crumble in a wave going clockwise. **Twin Orbit** becomes a star at the hub with two twin planets circling it half a lap apart. A mirror floor reflects it all. (§4) |
| "Physics a bit different" | The twins keep a constant radius but use CSS `ease` timing: they sling out from 3 o'clock and brake back into it, bunching and parting every lap. Ring planets don't orbit; their *matter* does, flowing as dust from each crumbling planet to the next one forming. The dust falls toward the ring, not the star. Tides are exaggerated, including on the star. (§4.3) |
| Latest three.js on the planets, with morphing | Each body shows off a different r186 feature: transmission and dispersion, subsurface scattering, iridescence with animated thin film, sheen, clearcoat, a dithered dissolve, MaterialX noise displacement and GPU-compute dust. Surfaces morph all the time (§5). |
| Nothing but the wheel (and its reflection) for 5 s | Once the fancy wheel plays, the screen is black with only the wheel and its reflection for 5 s, and all input is ignored. (§6) |
| Then a click *may* bring out the menu | After those 5 s, each click, tap or Space has a rising chance (35 % → +30 % per miss → certain by the 3rd try). A miss makes the wheel hitch as if busy. A hit pulls everything into the star, and the current donut menu springs out of the hub. (§6) |
| Keep the menu and its transition | The menu is today's title screen: the donut with Play, the title, the ribbon and so on, then the crunch into stage 1. It stays unchanged. (§7) |
| Fancy wheel playing = loading done; add a simpler pre-loader | **Stage A, pre-load**: a flat CSS port of Spiral (8 white dots) at first paint, while three.js and the fancy wheel download, build, compile and warm up out of sight. **Stage B**: the fancy wheel takes over in the same place and phase. That moment is the spec's "time to interaction": target ≤ 1 s on a fast connection, ≤ 2.5 s on a slow one, never > 4 s (a 3.5 s cap). (§2, §3) |

## 1. Facts checked while planning

### 1.1 The references (source from `loading-ui.com/r/<name>.json`)

**Spiral** (`spiral.tsx`):
- **Layout**: `dots = 8` dots placed at fixed angles i/8·2π, starting at 3 o'clock and going clockwise on screen. They sit at `radius = 31.25` % of the box from the centre; each dot is `150/dots` % (18.75 %) wide.
- **Motion**: the dots **don't move**. Each one animates `scale: [0, 1, 0]` and `opacity: [0, 1, 0]` over **1.5 s**, repeating forever, `easeInOut` on each half. Dot i is delayed by i/8 · 1.5 s, so a grow-and-shrink wave travels clockwise round the ring.
- **Accessibility**: `role="status"` plus a visually hidden "Loading".

**Twin Orbit** (`twin-orbit.tsx`):
- **Bodies**: a centre dot and two markers **the same size** as it.
- **Motion**: each marker runs `rotate(0→360deg) translate(155%)`, so it circles at 1.55 diameters from the centre, starting at 3 o'clock and going clockwise. The animation uses the CSS `ease` curve (`cubic-bezier(.25,.1,.25,1)`) over `--duration` (default **1 s**). The second marker is delayed by half a duration.
- **What that looks like**: because of `ease`, the markers speed off from 3 o'clock and slow down back into it. So they aren't always opposite each other: they bunch near 3 o'clock and spread elsewhere.
- **Accessibility**: also `role="status"`.

### 1.2 Code and libraries

| Item | Finding |
|---|---|
| three r186.1 | Has `MeshSSSNodeMaterial`, `VolumeNodeMaterial`, `dispersion` / `iridescence` / `sheen` / `anisotropy` on `MeshPhysicalNodeMaterial`, MaterialX `mx_fractal_noise_*` and `mx_worley_noise_*`, `instancedArray` + `compute()`, and `TRAANode`, `SSRNode`, `SSSNode`, `SSGINode`, `FSR1Node`, `TAAUNode`. |
| Current loading | The CSS donut paints at 0.14–0.20 s and the 3D donut shows at 0.68 / 1.45 s (fast / slow profile, next_1). `load3D()` starts in a `setTimeout` *after* `loadAudio()`, so the two compete for bandwidth. There's no `modulepreload` for the three.js chunk (≈ 275 KB gzip). |
| Play gating | `main.js` `checkPlay()` with `WHEEL.{minRun 2.5, cap 3.0, min3D 1.0}`. This is replaced. |
| Input | `Input` turns any pointerdown, Space, ArrowUp, W or Enter into `onPress`. Links, buttons and `#credits` are excluded. |
| Audio | The title screen is silent, so unlocking the AudioContext on a loader click makes no sound. |
| Benchmark | It measures ~130 frames of the title wheel and moves the tier by at most one step. On screen, a tier change only changes resolution. |
| Tools | `tools/record/record.mjs` waits for `body.ready` and clicks `#play`; it must click through the loaders instead. `?contrast` doesn't touch the title screen. |

## 2. Loading stages and what loads when

| Stage | On screen | Loading underneath | Ends when |
|---|---|---|---|
| **A. Pre-load** | Black screen and the flat CSS Spiral (§3). `cursor: wait`. Nothing else. | **Only what the fancy wheel needs, in order**: core, then three.js and `orbit.js`, then renderer init (WebGPU adapter or WebGL2), then build, then `compileAsync`, then 3 warm-up frames on the still-invisible canvas. The audio core, obstacle atlas decode and everything else wait so they don't compete. | The fancy wheel's first warm frame is ready, or the 3.5 s cap is hit (§2.1). |
| **B. Fancy wheel**: "page loading done" | Hand-off (0.4 s), then the 3D wheel and its reflection, nothing else. `cursor: wait` for 5 s, then `progress`. | The benchmark settles the tier. Then the audio core and obstacle atlas, then the **menu donut**, built at the final tier and compiled off-screen. The 3D world and models load in the background, as today. | A lucky click (§6), at least 5 s after stage B began. |
| **C. Menu** | Today's title screen | — | Play, then the crunch into stage 1 |

- **Spec metric**: `performance.mark('loader:fancy')` at the start of the hand-off is "time to interaction".
  - Targets: **≤ 1.0 s** on 50 Mbps / 40 ms, **≤ 2.5 s** on 10 Mbps / 100 ms / 4× CPU, **never > 4 s**.
  - The pre-load's first paint stays ≤ 0.2 s.
- **Getting there faster**:
  - a Vite `transformIndexHtml` hook adds `<link rel="modulepreload">` for the three.js and `orbit` chunks, so they start downloading with the HTML;
  - `load3D()` starts at boot, before anything else;
  - the fancy wheel uses only ~5 shaders, so compiling is quick (§5.3);
  - the donut and world compile only after stage B starts.

### 2.1 Fallbacks and the cap

- **3D not ready by 3.5 s** (slow GPU or compile): the CSS loader upgrades **in place** to a "fancy-lite" version. That adds the CSS Twin Orbit at the hub, the same colours as the 3D bodies and a CSS reflection (a mirrored copy with a gradient mask). It counts as stage B, and the 5 s clock starts. When the 3D wheel arrives later, it cross-fades in without restarting the clock.
- **No WebGPU or WebGL2**: fancy-lite is the loader for good, and the menu uses the CSS donut (as today).
- **Device lost during stage B**: as today, rebuild on WebGL2. Fancy-lite covers the gap, and the clock keeps running.

## 3. Stage A: the pre-load wheel (flat Spiral)

- A faithful CSS port of Spiral: 8 white dots, 1.5 s, the `[0,1,0]` scale and opacity wave, `easeInOut` halves, delays of i/8 · 1.5 s, clockwise from 3 o'clock.
  - It's a standard, quiet spinner, and it's the seed of the fancy wheel: its 8 dots sit **exactly where the 8 ring planetoids will be**, same size and phase.
  - Cost: about +0.5 KB gzip in `index.html`, built by the inline script that builds the donut bars today.
- **Shared clock**: the inline script sets each dot's `animation-delay` from `performance.now()`, and the 3D wheel uses the same clock. At hand-off, every dot is in the same phase as its planetoid.
- **Hand-off (0.4 s)**: each flat dot cross-fades into its planetoid at the same screen position.
  - The ring starts facing the camera, so the projection matches the 2D layout, then eases to its 10° hero tilt over 1 s.
  - The star and twins condense out of the hub, and the reflection fades up.
- No reflection, no colour and no twins in stage A: those mark the upgrade to stage B.
- `role="status"` and "Loading" for screen readers in stages A and B. The tab title is "Loading…" until the menu.

## 4. Stage B: the fancy wheel

### 4.1 Composition (proportions from the references)

- **Spiral ring**: 8 stations on a circle that matches the menu donut's ring, so the donut later appears exactly where they were. A planetoid's full size is 0.5 of the station radius. The reference uses 0.6; this leaves room for surface bulges.
- **Twin Orbit at the hub**:
  - a star and two twins of **equal size**, as in the reference;
  - the twins circle the star at 1.55 diameters;
  - the star's diameter is ≈ 0.3 of the ring radius, so the twin system (4.1 diameters across) clears the ring with a margin.
  - The twins' orbit plane is tilted 25°. Seen from the front it still reads as the reference, but the twins pass in front of the star (transits) and behind it.
- **Screen**: pure black with a black mirror floor that is itself invisible, showing only the reflection fading with depth. Same centre and box size as today's donut (42 % height, `min(58vmin, 540px)`).
- **Light**: the star *is* the light: a point light at the hub plus a dim studio PMREM for fill and reflections. **No bloom** (carried over from prompt 1): the star is bright HDR emissive under Neutral tone mapping.
- **Clocks**: ring wave 1.5 s and twin lap 1.0 s, as in the references. They are `ORBIT.ringPeriod` and `ORBIT.twinPeriod` in `config.js`. Reduced motion doubles both and halves the morph amplitude.

### 4.2 Why it reads as a loading wheel

- It keeps both references' silhouettes and timing: a clockwise wave round a ring of dots, and two markers whipping round a centre.
- Dust between the stations draws a faint continuous circle, so the wheel's outline is always visible.
- `cursor: wait` / `progress`, `aria-busy`, and the tab title "Loading…".

### 4.3 The "different physics" (`src/loader/orbitPhysics.js`, pure JS, no three.js, unit-tested)

1. **Eased twin orbits**: constant radius, but the angle is `2π · ease(phase)`, using CSS `ease` exactly. The orbit has a "speed bump" at 3 o'clock: the twins sling away and brake back in, half a lap apart, so they bunch and part every lap.
2. **Ring planets don't orbit; their matter does**: each station runs the Spiral cycle as a life cycle (§5.2). When a planetoid crumbles, its dust **flows clockwise along the ring** and accretes into the next station, which is just forming. The wave goes round because the matter does.
3. **Ring gravity**: dust is pulled toward the *nearest point on the ring*, not the star, with drag. The planetoids are weak attractors. Streams curl in spiral tails between stations.
4. **Exaggerated tides** (real tidal shape, Legendre P₂, amplitude ∝ m / d³ × a big factor):
   - the star carries two bulges that chase the twins around its surface;
   - the twins stretch toward each other when they bunch at 3 o'clock;
   - a ring planetoid bulges toward a twin as it swings past.
5. **Transits and eclipses**: the twins cross in front of the star. On High and Ultra, they also cast moving shadows from the star onto the ring planetoids.

The module returns positions, scales, life phases and tide vectors for any *t*. The 3D scene, the CSS fallback's timing and the tests all use it.

## 5. Bodies: three.js features and morphing

### 5.1 Roster

| Body | Material (r186) | Morph | Low / Medium |
|---|---|---|---|
| **Star** (hub) | Emissive plasma, limb darkening | Worley granulation cells boil; two tidal bulges follow the twins | Fewer octaves |
| **Twin A: ice** | **Transmission + dispersion** (IOR 1.31): the star refracts through it in rainbow fringes | Worley crystal facets grow and shrink | **`MeshSSSNodeMaterial`**: glows when lit from behind |
| **Twin B: mercury** | Metal, roughness ≈ 0.04: mirrors the star, the ring and the floor | Lava-lamp blobs (large domain-warped fbm) plus tidal stretch | Same |
| **Ring: 8 planetoids** (one instanced draw, clockwise from 3 o'clock) | `MeshPhysicalNodeMaterial` with per-instance looks: lava (HDR emissive cracks), ocean (clearcoat water and land), gas (latitude bands, **sheen**), crystal (Worley facets, clearcoat), pearl (**iridescence**, animated thin-film thickness), chrome, velvet (sheen), cratered rock | Life cycle (§5.2) plus each look's own motion: lava plates heave, seas rise and fall, bands flow, facets grow | Sheen and iridescence strength reduced on Low |
| **Dust** | GPU compute (`instancedArray`) under ring gravity; small emissive points, no bloom | Flows from each crumbling planetoid to the next one forming | 512 motes on Low, 2k on Medium |

- **Ultra only (stretch)**: a raymarched `VolumeNodeMaterial` corona round the star. It's dropped if it costs > 1 ms on the RTX.

### 5.2 Spiral's `[0,1,0]` becomes a life cycle

- **0 → 1 (accretion)**: incoming dust condenses into a hot, lumpy blob. Displacement amplitude and frequency fall, and the emissive glow cools, until it's a clean planet at full size.
- **1 → 0 (break-up)**: Worley cracks open, plates drift apart, and a dithered (alpha-hash) dissolve eats it from the cracks while it shrinks. Its dust is released toward the next station.
- The reference's opacity fade becomes the dissolve: no alpha blending, so nothing to sort.

### 5.3 Technique and cost

- A shared TSL `displace(p, t)` per look is added to `positionNode` along the normal, plus the tide term. **Normals are rebuilt from the displacement** (two tangent-offset samples), so light, clearcoat and transmission follow the moving surface.
- Icospheres at ~2.5k / 10k / 40k / 40k vertices for Low / Medium / High / Ultra; the planetoids use one level less. No textures and no downloads.
- About 5 shaders: star, ice, mercury, ring (instanced) and dust, plus the floor. That keeps compile time short for stage A.

| Feature | Low | Medium | High | Ultra |
|---|---|---|---|---|
| Dust motes | 512 | 2k | 8k | 24k |
| Reflection | mirrored copy of the bodies (no extra pass) | `reflector()` with mip blur | `reflector()` | `reflector()` |
| Eclipse shadows (star light, 512² cube) | — | — | ✓ | ✓ |
| Ice twin | SSS | SSS | transmission + dispersion | transmission + dispersion |
| AA | FXAA | FXAA | TRAA | TRAA |

- Compute on WebGL2 uses three's transform-feedback path. If a device misbehaves, the dust follows a closed-form path in the vertex shader instead.
- The **benchmark** runs on stage B's frames, and a tier change there only changes resolution. The **menu donut is built after the verdict**, at the final tier, so the menu appears with no pop and no hitch.

## 6. The chance (`src/loader/gate.js`, pure, unit-tested)

- An **attempt** is a pointerdown anywhere, or Space or Enter, at least `LOADER.quiet` = **5 s after stage B begins**. Attempts within 250 ms of the previous one are merged.
- **Chance** = min(1, 0.35 + 0.30·misses + 0.08·(seconds past the 5 s)). **The 3rd attempt always works.**
- **A real gate comes first**: a hit counts only once the menu is ready (atlas decoded, donut compiled, or 3D unavailable). After 12 s in stage B, 3D is no longer required, so the menu can come up with the CSS donut.
- **A miss** has no UI. The wheel **hitches**: everything freezes for ~150 ms, then catches up with a small overshoot, as if the page were busy. The cursor flashes `wait`. It's a time warp on the wheel's own clock, not a real stall.
- **During stage A and the first 5 s of stage B**, input is ignored completely (the AudioContext still unlocks silently).
- **A hit** triggers orbital decay:
  - the ring planetoids and the twins spiral into the star (0.7 s), and the dust follows;
  - the star shrinks to a point;
  - the **donut springs out of the hub**, its bars filling straight into the idle wave;
  - the menu UI fades in (0.4 s).
- Production uses `Math.random`; `?seed=` makes it repeatable.
- Params:
  - `?loader=skip` goes straight to the menu (also implied by `?era=` and `?contrast`);
  - `?loader=quiet:2` shortens the wait (dev only);
  - `?loader=lite` forces fancy-lite;
  - `?autopilot` keeps the loaders, so recordings show them.

## 7. Menu and transition (kept)

- Today's title screen, unchanged: the 3D donut with Play in its hole, WHEEL title, subtitle, prompt, fork ribbon, Credits, Mute, version. Play, Space or a tap → the existing **crunch** → stage 1.
- The fork ribbon, version, Credits and Mute are **hidden in stages A and B** and shown with the menu.
- The CSS donut stays only as the menu's fallback without 3D; it no longer paints first.
- Code: new screens `preload` and `loading` before `title` in `main.js`. `checkPlay()` and `WHEEL` give way to `LOADER` and the gate. Graphics3D gets `orbit` alongside `wheel` (the donut), and only one renders at a time.

## 8. Files, tests and budget

| File | Change |
|---|---|
| `src/render3d/orbit.js` (new) | Scene, star light, floor and reflection, dust compute, hand-off, hitch, decay |
| `src/render3d/bodies.js` (new) | Star, twin, ring and dust materials; the shared displace, normal and tide TSL |
| `src/loader/orbitPhysics.js`, `src/loader/gate.js` (new) | Motion, life cycle and attempts; no three.js |
| `src/render3d/graphics3d.js`, `wheel.js` | Orbit first; donut after the benchmark, with a spring-in entrance |
| `src/main.js`, `src/ui/hud.js`, `src/config.js` | Stages A/B/C, load order, the 3.5 s cap, gate, cursor, tab title, hidden HUD; `LOADER` and `ORBIT` |
| `index.html`, `vite.config.js` | CSS Spiral, fancy-lite (Twin Orbit and reflection), black loader styles; `modulepreload` for the 3D chunks |
| `tests/loader.test.js` (new) | See below |
| `tools/loadtime.mjs` (new, `npm run loadtime`) | Measures first paint, `loader:fancy` and the menu-ready mark on both CDP profiles; fails if `loader:fancy` is over 4 s |
| `tools/record/record.mjs` | Waits through stages A and B, clicks at human intervals until the menu, logs the attempts, idles 3 s, then clicks Play |
| `README.md` | Loader stages and params |

**Tests** (`tests/loader.test.js`):

- **Matches the references**:
  - the ring's scale curve equals Spiral's (8 stations, 1.5 s, `easeInOut` halves, i/8 delays);
  - the twins' angle equals `rotate()` with CSS `ease` (a cubic-bezier solve), half a period apart.
- **Physics**:
  - no two bodies ever interpenetrate over 20 s, sampled finely, with tide and morph margins;
  - dust leaving station *i* arrives at *i + 1* while it's forming;
  - deterministic for a given *t*.
- **Gate**:
  - nothing counts before stage B + 5 s;
  - debounce;
  - always a hit by the 3rd attempt;
  - the hit rate per attempt matches the formula over 100k seeded runs;
  - "not ready" always misses;
  - the 12 s fallback.

**Budget**: `index.html` +~1.2 KB gzip (CSS Spiral, fancy-lite, reflection; now 3.6 of 14 KB). Core +~1.5 KB (stages and gate). The lazy 3D chunk grows ~12–15 KB gzip. No new assets.

## 9. Milestones

| M | Deliverable | Done when |
|---|---|---|
| M0 | Spike: star, both twins, the ring material, dust compute and reflector, on the Intel UHD (WebGL2), the RTX (WebGPU) and software WebGL2; compute on WebGL2 checked; **time from boot to first warm frame** | Per-feature GPU cost and compile time known; §5.3 tier table and §2 targets confirmed or adjusted |
| M1 | `orbitPhysics.js`, `gate.js` and their tests | `npm test` green |
| M2 | Stage A (CSS Spiral) and the new load order with `modulepreload`; `tools/loadtime.mjs` | `loader:fancy` ≤ 1.0 / 2.5 s on the two profiles (measured on the spike scene) |
| M3 | The fancy wheel: bodies, morph, life cycle, tides, dust, mirror, eclipses, tiers, hand-off | No visible jump at hand-off on both profiles; 60 fps at the auto tier on the Intel UHD; no console errors |
| M4 | Fancy-lite and the 3.5 s cap; the gate, hitch, decay into the donut menu, hidden HUD, cursor, tab title, aria, params | Manual pass on desktop and touch emulation; menu and crunch unchanged; `?loader=lite` works |
| M5 | Measurements: `npm run loadtime`, iGPU and WebGL2 fps, phone emulation at Low, reduced motion | Targets in §2 met; budget check passes |
| M6 | Recorder update, a contact sheet of stages A → B → C, README, `ai/next_2.md` | Ready for you to commit |

## 10. Decisions (answered in chat)

1. **The fancy wheel playing is "page loading done".** The 5 s and the chance come after it, so the spec holds. A simpler pre-loader comes first. I chose the flat Spiral port because the fancy wheel grows directly out of its dots.
2. The menu keeps the donut (today's title screen and crunch, unchanged).
3. A missed click hitches the wheel (150 ms stall + `wait` cursor).
4. Odds: 35 %, +30 % per miss, +8 % per second, certain on the 3rd try.
5. The fork ribbon and version are hidden during the loaders and shown on the menu.
6. No hint for someone who never clicks.
7. The loaders run on every visit.

## 11. Risks

- **Compile time on phones (WebGL2)** decides the spec metric. Mitigation: ~5 shaders; `compileAsync` and warm-up behind stage A; nothing else loads until stage B; the 3.5 s cap with fancy-lite. M0 measures it first.
- **GPU cost** of transmission plus the reflector plus cube shadows on an iGPU. Mitigation: tier gates in §5.3, dynamic resolution as a backstop, measured in M0 and M5.
- **Compute on WebGL2** may be slow or buggy on some mobile GPUs. Mitigation: the closed-form vertex-shader dust.
- **People may think the game is broken** when clicks fail. Mitigation: the 3rd try always works, and the hitch shows the click was felt.
- **Equal-sized star and twins** may make the star read as just a third planet. Mitigation: the star's emissive surface and light set it apart. If needed, scale it to 1.2×, a small departure from the reference.
- **A 5 s wait on every visit** may wear on repeat players. Decided (§10.7); easy to revisit.
