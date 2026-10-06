# Plan 2: an orbiting-planets loading wheel, 5 s of nothing, then a chance to get in

Answers `ai/prompt_2.md`.

**Revision 1**: defaults are marked; the open questions are in §9.

## 0. Summary

| Prompt item | Plan |
|---|---|
| Loading wheel based on Spiral and Twin Orbit | A new **orbit loader** replaces the donut as the first thing on screen. It has three **twin pairs** of planets: each pair corkscrews around the other while all three pairs travel round one circular track, clockwise, like a spinner's dots. Behind them, streams of dust curl along the track as spiral tails. |
| "Physics a bit different" | Circular orbits with **Kepler timing**: fast at the bottom, slow at the top, so the train bunches and spreads like a classic spinner. There is no sun: they orbit an empty hub that lights them anyway. Tides are exaggerated. The dust falls toward the *ring* instead of the centre. (§3) |
| Latest three.js on the planets | Each planet shows off a different r186 feature: transmission and dispersion, subsurface scattering, iridescence with animated thin film, anisotropy, sheen, clearcoat, MaterialX noise displacement, and GPU-compute dust. Features scale by quality tier. (§4) |
| Morphing surfaces | TSL vertex displacement per planet (lava plates heave, seas rise and drown continents, crystals grow, mercury blobs). Normals are rebuilt from the displacement, plus real tidal bulges toward the twin. (§4.2) |
| Nothing but the wheel (and its reflection) for 5 s | Pure black void with an invisible black-mirror floor. No title, text, buttons, ribbon, version or cursor hint for 5 s. All input is ignored. (§5) |
| Then a click *may* bring out the menu | After 5 s, each click, tap or Space has a rising chance (35 % → +30 % per miss → certain by the 3rd try). A miss makes the spinner "hitch" as if the page were busy. A hit makes the planets spiral into the hub, the wheel disappears and the menu appears. (§5.2) |
| Keep the menu and its transition into the game | The current title screen is kept as is: donut, Play in its hole, title, fork ribbon, credits, mute, version. Play → crunch → stage 1 is unchanged. The donut now grows out of the hub where the planets vanished. (§6) |

**One conflict with the spec. Please confirm (§9.1).** CLAUDE.md says time to interaction is 2–3 s, with 4 s as the absolute maximum. The prompt asks for at least 5 s with nothing interactive, plus clicks that randomly fail. I plan to treat this as a deliberate exception. The *technical* load (everything the menu needs, downloaded and compiled) stays ≤ 2.5 s, and I measure that. Only the staged wait is longer.

## 1. Facts checked while planning

| Item | Finding |
|---|---|
| References | **Spiral** (loading-ui.com): "dots moving around a circular path"; `dots` sets density and `radius` the spiral's width; `currentColor`. No source on the page. **Twin Orbit**: not read (the fetch was declined). I'm reading it as "two bodies circling each other while circling a centre". Paste its source if it differs and I'll adjust. |
| three r186.1 in `node_modules` | `MeshSSSNodeMaterial`, `VolumeNodeMaterial`, `dispersion` / `iridescence` / `sheen` / `anisotropy` on `MeshPhysicalNodeMaterial`, MaterialX `mx_fractal_noise_*` and `mx_worley_noise_*`, `instancedArray` + `compute()`, and `SSRNode`, `SSSNode` (screen-space shadows), `SSGINode`, `TRAANode`, `FSR1Node`, `TAAUNode` in `examples/jsm/tsl/display/`. |
| Current loader | `src/render3d/wheel.js` (3D donut) and the CSS donut in `index.html`. `main.js` `checkPlay()` shows Play at `WHEEL.minRun` 2.5 s (cap 3.0 s, 3D donut on screen ≥ 1 s). Measured Play ≈ 2.5 s on both load profiles (next_1). |
| Input | `Input` turns any pointerdown, Space, ArrowUp, W or Enter into `onPress`. Links, buttons and `#credits` are excluded. |
| Audio | The title screen is silent (`engine.update` returns early on `title`/`crunch`). Unlocking the AudioContext on a loader click makes no sound. |
| Benchmark | `Benchmark` measures the first ~130 wheel frames and moves the tier by at most one step. A tier change on screen only changes resolution (no rebuild). |
| Tools | `tools/record/record.mjs` waits for `body.ready`, then clicks `#play`. It must learn to click through the loader. `?contrast` drives `r2d`/`g3d` directly and doesn't depend on the title screen. |

## 2. Look and screen layout

- **Screen**: pure black (`#000`, and `theme-color` too). The floor is a black mirror that is itself invisible: no horizon line, no sheen. Only the wheel's reflection shows, fading out with depth. Nothing else is on screen.
- **Placement**: same centre and size as today's donut (42 % height, `min(58vmin, 540px)` box). The track's diameter equals the donut ring's, so the menu donut appears exactly where the wheel was.
- **Reads as a spinner**:
  - one circular track with a steady ~1.8 s lap;
  - a head-to-tail train with sizes shrinking toward the tail;
  - fading dust tails behind every pair;
  - clockwise.
  - The dust also draws a faint continuous ring, so the "wheel" outline is always visible even when the planets bunch up.
- **Lighting**: an invisible point light sits at the hub. Every planet shows a lit crescent facing the centre, and the terminator turns as it travels, so it reads as orbiting a star that isn't there.
  - The procedural studio PMREM from `wheel.js` is reused at low intensity for fill and for reflections on the chrome and glass planets.
  - A cool rim light from behind outlines the silhouettes.
- **No bloom** (carried over from prompt 1). The lava glow comes from HDR emissive and Neutral tone mapping, and the dust motes are small emissive points.
- **Small cues**:
  - `cursor: wait` for the first 5 s, then `progress`;
  - the tab title is "Loading…" until the menu shows;
  - `aria-busy` and a visually hidden "Loading" status for screen readers.

## 3. Motion: the "different physics"

A pure, deterministic module `src/loader/orbitPhysics.js` (no three.js) gives every body's position, velocity and tidal stretch at time *t*. The 3D scene and the tests share it.

1. **Kepler timing on a circle**: the track is a perfect circle, but each pair's angle follows Kepler's equation for eccentricity *e* ≈ 0.3, with periapsis at the bottom.
   - Pairs are spaced by a constant mean anomaly (≈ 0.09 lap).
   - So the train **bunches near the top and stretches at the bottom**, the familiar spinner rhythm, every lap at the same period.
2. **Twin orbit around the track**: each pair's barycentre rides the track. The two twins circle it in the plane across the track (tube angle φ = *q*·θ + φ₀, *q* = 2 twists per lap), so each pair traces a double helix round the wheel (a torus-knot path).
   - The heavier twin wobbles less (barycentre offset by mass ratio).
   - Pairs go from unequal to equal: planet and moon at the head (3:1), then 2:1, then true twins (1:1) at the tail.
3. **No sun**: they orbit an empty hub. The hub is also the light, and it has no mass.
4. **Exaggerated tides**: each planet bulges toward its twin with the real tidal shape (Legendre P₂(n·d)). The amplitude is ∝ m_twin / d³ times a large factor, so twins visibly stretch toward each other at their closest pass and relax apart.
5. **Ring gravity for the dust**: motes are pulled toward the *nearest point on the circle*, not the centre, with a little drag and the planets as weak attractors. Shed from each pair's trailing side, they stream along the track and curl inward in **spiral tails** (the Spiral reference), then fade. On every pass, the inner twin **eclipses** the outer one in the hub light (High and Ultra, §4.3).

Tunables live in `config.js` `ORBIT`: `lap`, `ecc`, `twist`, `spacing`, `tide`, `pairs`. Reduced motion means a 3.5 s lap, no twist and half the morph amplitude.

## 4. Planets: three.js features and morphing

### 4.1 Roster

| Pair | Planet | Material (r186) | Morph | Low / Medium fallback |
|---|---|---|---|---|
| Head (3:1) | **Gas giant** with a thin ring | Banded sheen; ring with **anisotropy** (brushed, like a mini wheel) | Bands advect (domain-warped noise in latitude); a storm vortex drifts; it flattens when it speeds through the bottom | No sheen on Low; ring kept |
| | **Ice moon** | **Transmission + dispersion** (IOR 1.31, rainbow fringes), frosted roughness noise | Worley crystal facets grow and shrink | **`MeshSSSNodeMaterial`**: glows when back-lit by the hub |
| Middle (2:1) | **Ocean world** | Clearcoat water, land from fbm, a cloud shell, a Rayleigh-blue fresnel rim | Sea level rises and falls: continents emerge and drown; clouds drift | No cloud shell on Low |
| | **Lava moon** | Dark crust, HDR emissive cracks from Worley edges | Crust plates drift and heave; cracks brighten where the crust spreads | Same, fewer octaves |
| Tail (1:1) | **Mercury** | Metal, roughness ≈ 0.04, reflects the studio env | Lava-lamp blobs (large domain-warped fbm) | Same |
| | **Pearl / soap bubble** | **Iridescence** with an animated `iridescenceThicknessNode`, light SSS | Jelly standing waves (a few spherical-harmonic-like modes) | Iridescence kept, no SSS |

- **Ultra only (stretch)**: the gas giant's storm as a raymarched **`VolumeNodeMaterial`** cap. It's dropped if it costs > 1 ms on the RTX.
- Each surface cycles its "state" over ~6 s, so the change is visible within the 5 s wait.

### 4.2 Morph technique

- One shared TSL helper: `displace(p, t)` for each planet. It is added to `positionNode` along the normal, plus the tidal P₂ term from §3.4.
- **Normals rebuilt from the displacement**: two tangent-offset samples, so lighting, clearcoat and transmission follow the moving surface instead of the original sphere.
- Geometry: icospheres at about 2.5k / 10k / 40k / 40k vertices for Low / Medium / High / Ultra. Noise octaves scale by tier too.
- Colour and roughness come from the same noise fields in the fragment stage, so peaks, cracks and seas line up with the shape.
- No textures and nothing to download: everything is procedural.

### 4.3 Scene features by tier

| Feature | Low | Medium | High | Ultra |
|---|---|---|---|---|
| Dust motes (GPU compute, `instancedArray`) | 512 | 2k | 8k | 24k |
| Reflection | mirrored copy of the planets (no extra pass) | `reflector()` with mip blur | `reflector()` | `reflector()` |
| Eclipses (hub point light, 512² cube shadow) | — | — | ✓ | ✓ |
| Ice | SSS | SSS | transmission + dispersion | transmission + dispersion |
| AA | FXAA | FXAA | TRAA | TRAA |
| Film grain and output dither (as the donut) | ✓ | ✓ | ✓ | ✓ |

- Compute on WebGL2 runs through three's transform-feedback path. If it misbehaves on a device, motes fall back to a closed-form spiral in the vertex shader (§8).
- **Benchmark**: it now runs on the orbit's frames. Tier changes on screen still only change resolution. The **donut for the menu is built after the benchmark's verdict**, at the final tier, and compiled off-screen with `compileAsync` during the wait. So the menu appears with no hitch and no pop.

## 5. Flow and timing

### 5.1 Timeline

| Time | What happens |
|---|---|
| 0 s (first paint) | Black screen, the **CSS orbit** (6 dots in 3 twin pairs, plus a few trailing spiral dots) and a CSS reflection (a mirrored copy with a gradient mask). It's about +1.2 KB gzip in `index.html`. |
| ≈ 0.7–1.5 s | The 3D orbit is compiled behind the CSS one (`compileAsync`), then cross-fades in over 0.6 s; the dots turn into planets. The CSS uses keyframe easing that approximates the Kepler timing on the same `performance.now()` clock, close enough for a cross-fade. |
| ≤ 2.5 s | **App ready** (`performance.mark('app:ready')`): core, obstacle atlas and audio core loaded; the 3D donut built and compiled (or 3D unavailable). The 3D world keeps loading in the background, as today. |
| 5.0 s | Clicks start to count (`LOADER.quiet`). The cursor switches from `wait` to `progress`. |
| Successful click | Planets **spiral into the hub** (orbital decay, 0.7 s), shrinking to nothing; the dust swirls in after them. Then the **donut springs out of the hub** with its bars filling into the idle wave, and the menu UI fades in (0.4 s). Play works right away. |

### 5.2 The chance (`src/loader/gate.js`, pure, unit-tested)

- An **attempt** is a pointerdown anywhere, or Space or Enter, ≥ 5 s after navigation. Attempts within 250 ms of the previous one are merged (a double-tap is one try).
- **Chance** = min(1, 0.35 + 0.30·misses + 0.08·(t − 5 s)):
  - one try at 5.5 s ≈ 39 %;
  - if that misses, the next ≈ 75 %;
  - **the 3rd try always works**.
- **A real gate comes first**: a hit only counts once the app is ready (§5.1); otherwise it's a miss. So the fiction is honest on slow networks too. After 12 s, 3D readiness is no longer required, so the menu can come up with the CSS donut.
- **A miss** has no UI. The spinner **hitches**: the planets freeze for ~150 ms, then catch up with a small overshoot, as if the main thread had been busy. The cursor flashes `wait`. It's a time warp on the loader's own clock, not a real stall.
- **Before 5 s** everything is ignored: no hitch, no counting. The AudioContext still unlocks silently.
- Production uses `Math.random`; `?seed=` makes it repeatable.
- Dev and tool params:
  - `?loader=skip` goes straight to the menu (also implied by `?era=` and `?contrast`);
  - `?loader=quiet:2` shortens the wait (dev only);
  - `?autopilot` keeps the loader, so recordings show it.

### 5.3 What's hidden during the loader

The title and subtitle, the "Loading…" prompt, Play, the fork ribbon, the version tag, Credits and Mute. They all appear with the menu. Prompt 0 asked for the fork ribbon on the "loading page" and the version in a corner. Both stay on the menu (which is where they've been since plan 1) and are hidden only for the loader (§9.5).

## 6. Menu and transition into the game (kept)

- The menu is today's title screen, unchanged in design: the 3D donut with Play in its hole, WHEEL title, subtitle, prompt, fork ribbon, Credits, Mute, version. The donut skips its loading phase (everything is loaded by now) and arrives straight into the idle wave.
- Play, Space or a tap → the existing **crunch** → stage 1. No change.
- The CSS donut stays in `index.html` as the menu's fallback when 3D isn't available. It no longer shows at first paint.
- Code: a new `loading` screen before `title` in `main.js`. `checkPlay()` and `WHEEL.{minRun,cap,min3D}` give way to `LOADER` and the gate.
- Graphics3D gets `orbit` (new) alongside `wheel` (the donut), with `renderLoader()` / `showMenu()`. Only one scene renders at a time.

## 7. Files and budget

| File | Change |
|---|---|
| `src/render3d/orbit.js` (new) | Scene, track, floor and reflection, hub light, dust compute, collapse animation |
| `src/render3d/planets.js` (new) | The six materials and the shared `displace` / normal / tide TSL |
| `src/loader/orbitPhysics.js`, `src/loader/gate.js` (new) | Motion and attempt logic, no three.js |
| `src/render3d/graphics3d.js`, `wheel.js` | Orbit first; the donut is built after the benchmark and enters with a spring; the benchmark moves to the orbit |
| `src/main.js`, `src/ui/hud.js`, `src/config.js` | `loading` screen, gate, hitch, hidden HUD, cursor and tab title; `LOADER` and `ORBIT` config |
| `index.html` | CSS orbit and reflection, black loader background, `loading` screen styles |
| `tests/loader.test.js` (new) | See below |
| `tools/record/record.mjs` | Waits for 5 s, clicks at human intervals until the menu, logs the attempts, then idles 3 s and clicks Play |
| `README.md` | New params and the loader |

**Tests** (`tests/loader.test.js`):

- physics:
  - the lap period is constant;
  - bunching at the top / spread at the bottom is within target ratios;
  - **no two planets ever interpenetrate** over 10 laps (sampled finely), on every tier's pair count;
  - deterministic for a given *t*;
- gate:
  - nothing counts before 5 s;
  - debounce;
  - a hit by the 3rd attempt always;
  - the observed hit rate per attempt matches the formula over 100k seeded runs;
  - "not ready" always misses;
  - the 12 s fallback.

**Budget**: `index.html` +~1.2 KB gzip (now 3.6 of 14 KB). Core +~1 KB (gate). The lazy 3D chunk grows ~12–15 KB gzip. No new assets.

## 8. Milestones

| M | Deliverable | Done when |
|---|---|---|
| M0 | Spike: one morphing planet per material, compute dust, reflector. Measured on the Intel UHD (WebGL2), the RTX (WebGPU) and the software WebGL2 path; compute on WebGL2 checked | Per-feature GPU cost and shader compile time known; tier table in §4.3 confirmed or adjusted |
| M1 | `orbitPhysics.js`, `gate.js` and their tests | `npm test` green, including no-interpenetration |
| M2 | 3D orbit loader: planets, morph and tides, dust, mirror, hub light, eclipses, tiers | `?loader=quiet:999` shows it on every tier; 60 fps at the auto tier on the Intel UHD; no console errors |
| M3 | CSS orbit at first paint and the cross-fade | No visible jump at hand-off on both load profiles |
| M4 | Flow: quiet period, chance, hitch, collapse → donut menu, hidden HUD, cursor, tab title, aria, `?loader=` params | Manual pass on desktop and touch emulation; the menu and the crunch into the game unchanged |
| M5 | Measurements: load profiles (first paint, 3D orbit, `app:ready`), iGPU and WebGL2 fps, phone emulation at Low, reduced motion | `app:ready` ≤ 2.5 s on 10 Mbps / 100 ms / 4× CPU; first paint ≤ 0.2 s; budget check passes |
| M6 | Recorder update, a fresh contact sheet of the loader, README, `ai/next_2.md` | Ready for you to commit |

## 9. Decisions to confirm (defaults in bold)

1. **Spec exception: accepted.** Technical readiness stays ≤ 2.5 s and is measured; the 5 s and the chance are design. I won't edit CLAUDE.md; you may want to add a note there. *Alternative*: shorten the quiet period to 3 s and guarantee the first click after 4 s.
2. **The menu keeps the donut** (the current title screen as is). *Alternative*: drop the donut so the menu is just the title and Play, with the crunch applied to the whole screen.
3. **A missed click hitches the spinner** (150 ms stall + `wait` cursor). *Alternative*: absolutely no reaction.
4. **Odds**: 35 %, +30 % per miss, +8 % per second, certain on the 3rd try.
5. **Fork ribbon and version are hidden during the loader** and shown on the menu.
6. **No hint** for someone who just waits and never clicks. *Alternative*: a faint "tap" whisper after 15 s.
7. **The loader runs on every visit.** *Alternative*: skip it on reloads within a session.

## 10. Risks

- **Shader compile time** for six morphing materials plus the donut and the world, especially WebGL2 on phones. Mitigation:
  - `compileAsync` behind the CSS orbit, and the 5 s wait gives room;
  - the shared noise helpers keep the shaders small;
  - M0 measures it.
- **GPU cost** of transmission plus the reflector plus cube shadows on an iGPU. Mitigation: tier gates in §4.3, measured in M0 and M5, with the existing dynamic resolution as a backstop.
- **Compute on WebGL2** (transform feedback) may be slow or buggy on some mobile GPUs. Mitigation: the closed-form vertex-shader spiral fallback.
- **People may think the game is broken** when clicks fail. Mitigation: the 3rd try always works, and the hitch shows the click was felt.
- **Kepler bunching can make planets collide** at the top. Mitigation: the no-interpenetration test, and tuning `ecc` / `spacing` / `twist`.
- **The CSS → 3D hand-off can't match Kepler timing exactly** in pure CSS. Mitigation: per-quarter keyframe easing and a 0.6 s cross-fade.
- **A 5 s wait on every visit** may annoy repeat players (§9.7).
