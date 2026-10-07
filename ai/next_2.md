# Next 2 — implementation summary and what to do next

Implements `ai/plan_2.md` (revision 2). Not committed.

## What was built

| Area | Where | Notes |
|---|---|---|
| Stage A: pre-loader | `index.html` (inline script + CSS) | A flat CSS port of loading-ui's **Spiral**: 8 white dots, scale and opacity 0 → 1 → 0 over 1.5 s with easeInOut halves, dot i starting i/8 later. Driven by the Web Animations API with `startTime` on the `performance.now()` clock, so it stays in phase with the 3D wheel. It runs on the compositor, so it keeps moving while scripts load. Nothing else is on screen: the ribbon, version, Credits, Mute and title are hidden. `cursor: wait`, tab title "Loading…", `role="status"`. |
| Stage B: the fancy wheel | `src/render3d/orbit.js`, `bodies.js`, `noise.js` | A star at the hub with two twins (**Twin Orbit**: CSS `ease` timing, half a lap apart, 1.55 diameters out), with their orbit plane leaning back and precessing. 8 ring planets (**Spiral**) that form from hot dust, mature and crumble in a clockwise wave. Each body is a different material: an emissive plasma star, ice with transmission + dispersion (SSS below High), liquid mercury, and one shared ring material with 8 looks (lava, ocean, gas giant with sheen, crystal, pearl with iridescence, chrome, velvet, rock). Every surface morphs, and the planets break up with a dithered dissolve. Dust is a **GPU compute** simulation (512 to 24k motes by tier) that flies from crumbling planets to forming ones. A black mirror floor shows the reflection, and a corona sprite surrounds the star. No bloom. |
| Physics | `src/loader/orbitPhysics.js` | Pure functions of time: the reference curves (a CSS cubic-bézier solver), the twins' positions, life cycles, exaggerated P₂ tides (the star bulges toward the twins, the twins toward each other), the dust schedule and the hitch clock. |
| Stage B → menu | `src/loader/gate.js`, `src/main.js` | Stage B ("page loading done", mark `loader:fancy`) starts when the 3D wheel is warm, or at 3.5 s with the CSS **fancy-lite** version (Twin Orbit, colours, CSS reflection), which upgrades to 3D later. Attempts are ignored for 5 s. After that the chance is 35 % + 30 % per miss + 8 % per second, and the 3rd attempt always works, but only once the menu is loaded. A miss makes the wheel hitch: it freezes and then catches up, and the cursor flashes `wait`. A hit spirals everything into the star (0.7 s), then the donut springs out of the hub and the menu fades in. |
| Menu | `src/render3d/wheel.js`, `graphics3d.js` | Today's title screen and the crunch into stage 1 are unchanged. The donut is built after the benchmark, while the wheel plays, and compiled in the background. Its last blocking warm-up runs at the click (inside a miss's hitch, or just before the collapse), not unprovoked. |
| Load order | `src/main.js`, `vite.config.js` | `modulepreload` for the three.js chunk. Stage A loads only the fancy wheel; audio and the 2D stages wait for stage B, and the 3D world for the menu. |
| Tools | `tools/loadtime.mjs` (`npm run loadtime`), `tools/record/record.mjs`, `tests/loader.test.js` | Load times on two CDP profiles, cold cache, failing past 4 s; `--steps` prints the 3D start-up marks. The recorder waits through the loaders and clicks like a person until the menu; its contact sheet now starts with the wheel and the menu. 14 new tests: the reference curves, no collisions (with morph and tide headroom), dust timing, the hitch clock and the gate's odds. |

## Measured

- **Load** (production build, cold cache, `npm run loadtime`, median of 3):

  | GPU | Profile | First frame | Fancy wheel plays | Menu loaded behind it |
  |---|---|---|---|---|
  | Intel UHD, WebGL2 (auto: Medium) | 50 Mbps / 40 ms | 0.06 s | 0.81 s | 2.15 s |
  | | 10 Mbps / 100 ms / 4× CPU | 0.17 s | 2.70 s | 4.25 s |
  | RTX 3050, WebGPU (auto: High) | 50 Mbps / 40 ms | 0.06 s | 1.15 s | 2.55 s |
  | | 10 Mbps / 100 ms / 4× CPU | 0.13 s | 3.25 s | 4.98 s |

  Worst single run: 3.32 s, so every run is under the 4 s maximum. The first fast run of each batch (cold shader cache) is ≈ 1.6 s.
- **Frame rate**: the wheel holds this laptop's display cadence (p50 ≈ 19 ms at ~53 Hz, p95 ≈ 22 ms) on the Intel iGPU at Low, Medium and High.
- **Shader compile** (cold cache, Intel/Mesa): star 473 → 173 ms, ice 539 → 147, mercury 331 → 139, ring 935 → 201. This came from one noise evaluation per shader stage (normals from the per-pixel height's slope instead of three extra evaluations per vertex) and compact noise in place of MaterialX's.
- `npm test`: 30/30. `npm run build`: the budget passes (HTML 5.0 KB, core 18.5 KB).

## Deviations from the plan

- **No TRAA in the loader**: FXAA on every tier. Fast-moving dust ghosts under TRAA, and dropping it costs nothing visible.
- **Camera framing**: aimed rather than view-offset, because TRAA overwrites the camera's view offset with its jitter. Before this fix the High/Ultra wheel and donut rendered at 50 % height instead of 42 %. The donut uses the same framing now.
- **The donut's last warm-up happens at the click**, not in the background. Its first render compiles a few pipeline variants synchronously (reflection, shadows, multiple render targets); unprovoked, that froze the wheel for up to 0.85 s on a cold cache. Compiling those variants ahead with `compileAsync` under the pass's render target doesn't work in r186: on WebGPU it creates invalid pipelines.
- **The twins don't wait for their delay**: unlike the reference, the second twin doesn't sit on top of the first for its first half lap.
- **Transits**: with a 25° lean, the twins pass in front of and behind the star, but not across its disc. Eclipse shadows onto the ring planets come from the star's point light on High and Ultra.
- **The Ultra-only volumetric corona** (the plan's stretch) wasn't built; a soft corona sprite stands in.

## Not verified here

- **Phones**: real Safari/iOS and Android. Only portrait emulation at 390×844 on this laptop.
- **Pre-loader smoothness on a first visit**: during the cold shader compile (≈ 0.3–1.1 s on the Intel iGPU), Chrome's GPU process composites only every 150–250 ms, so the CSS dots stutter briefly. It's smooth on a warm cache.
- **Windows and macOS GPUs**, and HDR displays.

## Next

1. **Playtest the gate** with a few people: are 5 s plus 35 % first-try odds funny or annoying? The knobs are `LOADER.quiet` and `LOADER.odds`.
2. **First-visit stutter of the pre-loader**: try compiling the ring's material first and the rest after the hand-off, or splitting the ring's look-specific branches into fewer features on Low/Medium.
3. **WebGPU on the slow profile is 3.25 s**: High's transmission, shadows and reflection are built before the wheel can play. Starting the wheel at Medium features and letting the donut take the benchmark's tier would bring it down to about the WebGL2 number.
4. **Record a full video** (`npm run record`) after committing, so the corner tag matches.
5. **Commit, then deploy** (`npx wrangler login && npm run deploy`).
