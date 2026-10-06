# Plan 0 — SUPER wheel → cat runner that "evolves" its graphics

Answers `ai/prompt_0.md`. Nothing implemented yet.

## 0. Core idea (one sentence)

The game opens on a photorealistic three.js "SUPER wheel of death". When you start, it gets crushed down to a 1-bit pixel world. From there the cat runs through the history of computer graphics: 1-bit → CGA → 8-color → 256-color → PS1 polygons → smooth PBR 3D → HDR. You *earn the wheel's graphics back* by running.

That arc also solves the main engineering tension. The spec needs **interaction in 1–3 s on entry-level phones**. The prompt wants **maximum three.js graphics**. Those fit together because:

- the first eras are tiny and render with Canvas 2D, so the game is playable in about 1 s;
- three.js and the heavy 3D assets stream in **while the player is in the pixel eras**, which are the cheap ones;
- an era only advances once its assets are loaded and its shaders are compiled. Slow devices or slow networks just stay longer in the current era and never stall.

## 1. Facts checked while planning

| Item | Finding |
|---|---|
| three.js | latest `0.186.1` (r186) |
| three WebGPU build size | `three.webgpu.js` + `three.core.js`, minified + gzip ≈ **199 KB + 104 KB ≈ 300 KB** (before tree-shaking). WebGL-only build ≈ 194 KB. **→ three.js must not be on the critical path.** |
| r186 post FX (TSL, `examples/jsm/tsl/display/`) | `RenderPipeline` (renamed from `PostProcessing` in r183), Bloom, GTAO, SSR, SSGI, TRAA, TAAU, FSR1, MotionBlur, DepthOfField, Godrays, Lut3D, Film, CRT, **RetroPassNode** (PS1 vertex snap + affine UVs), PixelationPassNode, TransitionNode, SMAA/FXAA |
| HDR output | `new WebGPURenderer({ outputType: HalfFloatType })` configures the canvas with `toneMapping: { mode: 'extended' }` (`WebGPUBackend.js`). There is no built-in "HDR-aware" tone mapper, so that needs a spike (see Risks). |
| Loaders | `UltraHDRLoader` (small gain-map JPEG HDRIs), `KTX2Loader`, `GLTFLoader` + meshopt |
| Environments | `RoomEnvironment` is procedural and needs **no download**, so it gives instant PBR lighting for the wheel |
| wrangler | `4.147.0`; config supports top-level `"preview_urls": false` and `assets.directory` / `not_found_handling` (assets-only Worker, no script) |
| Blender MCP | Blender 5.2.1, addon up to date. **Sketchfab on**; Poly Haven/Poly Pizza/generators off |
| Local tools | node 24, npm 11. No `toktx` (so no KTX2 encoding unless installed). `@gltf-transform/cli` 4.5.1 available via npm |
| Git remote | `github.com/doublependu/wheel`, used for the "fork me" link |

### Sketchfab cat candidates (all CC-BY, downloadable)

| Model | UID | Faces | Notes |
|---|---|---|---|
| **"An Animated Cat"** by Evil_Katz | `aec25699660043a29595f9572149d1e8` | 7.4k | Realistic **black cat**. Best fit: a black silhouette is the natural 1-bit "Chrome dino" look, and it suits a photoreal ending. Same face count appears in several re-uploads (Huh1_, 27390pena, ap-school), so **verify this is the original upload**. |
| "Somali Cat Animated ver 1.2" by DreamNoms | `e185c3fd92b64c32b4515a32b29252fc` | 7.6k | Stylized-real, painted look. DreamNoms packs usually include run/jump clips. **Backup.** |
| "Tuxedo Cat Animated 2.0" by DreamNoms | `783fcb78b55b4394a212c2b6392e1113` | 6.4k | Cute/cartoon. Second backup. |
| "Stripe the Cat" by DreamNoms | `2e3030b71a6d4b219fdc7304f8e58013` | 2.0k | Low-poly. Optional reference for the PS1 era look. |

The clip list (needs run loop + jump) is only visible after import, which is the first step of M2.

## 2. Load / time-to-interaction architecture

Two test profiles:

- **Average**: ~50 Mbps, 40 ms RTT. Target: interactive ≤ 1 s, 3D wheel visible ≤ 2.5 s.
- **Conservative**: ~10 Mbps, 100 ms RTT, 4× CPU throttle (stand-in for an entry-level phone). Target: interactive ≤ 2–3 s, hard cap 4 s.

| Stage | What | Budget (compressed) | Ready by (average) |
|---|---|---|---|
| T0 | `index.html`: inline critical CSS, **CSS/SVG wheel** spinning at first paint, HUD DOM, fork-me link, version tag, tiny boot script | ≤ 14 KB (fits the first TCP window) | ~0.2 s |
| T1 | Game core: sim, input, Canvas 2D pixel renderer, era-1 sprite sheet | ≤ 40 KB | **~0.5–1 s → "Tap / Space to start"** |
| T2 | three.js chunk + wheel scene, `RoomEnvironment` lighting; cross-fade CSS wheel → 3D wheel (matching rotation angle) | ~300 KB + ~30 KB | ~1.5–2.5 s |
| T3 | Wheel upgrades in place: post FX → UltraHDR studio env → HDR output (if supported) | ≤ 400 KB | idle |
| T4 | Era 2–4 sprite sheets (tiny), then 3D world, obstacles, cat `.glb`, env; `renderer.compileAsync()` precompiles each 3D era's pipelines | cat ≤ 1.5 MB; total by era 5 ≤ 3 MB | during gameplay, before needed |

Rules:

- The wheel screen **is the title screen**. "Start" unlocks at T1 and does not wait for the 3D wheel. The wheel keeps upgrading itself while you watch (CSS → 3D → lit → post FX → HDR), which previews the game's theme.
- A loader queue with priorities. The next era's assets come first. Under `saveData` or slow connections, heavy assets are deferred.
- **Era gating**: an era transition fires only when distance ≥ threshold **and** `assetsReady(era)` **and** `pipelineCompiled(era)`. Otherwise the current era continues seamlessly.
- `npm run build` runs a budget check (`tools/check-budget.mjs`) that fails if T0/T1 exceed their budgets.

## 3. The SUPER wheel (three.js showcase)

A giant rainbow pinwheel spinner rendered like a product shot:

- **Renderer**: `WebGPURenderer` from `three/webgpu` (automatic WebGL2 fallback), TSL node materials throughout.
- **Geometry**: a beveled disc of colored segments (extruded + bevel), a domed glass cap, and a brushed-metal hub and rim.
- **Materials** (`MeshPhysicalNodeMaterial`): candy segments with **clearcoat**; glass cap with **transmission + thickness + ior + dispersion**; **iridescent** inner ring; **anisotropic** brushed hub.
- **Lighting**: `RoomEnvironment` → PMREM (zero bytes) at first, upgraded to a CC0 studio HDRI as **UltraHDR JPEG**. Dark glossy floor, with SSR on High tier.
- **Post** (`RenderPipeline` + MRT output/normal/velocity): TRAA, GTAO, Bloom, **MotionBlur** (velocity from the spin), subtle DoF, Film grain, Lut3D grade. Low tier gets FXAA + cheap bloom only.
- **GPU compute** (WebGPU only): a sparkle/particle ring orbiting the wheel, updated by a TSL compute shader.
- **Progress**: segments light up (emissive) as loader stages complete. The spin eases. Pointer/touch tilts the wheel slightly.
- **Benchmark**: the wheel's first ~60 frames after warm-up (plus GPU timestamp queries where available) pick the **quality tier** for the rest of the game.
- **Start transition "Crunch"**: the wheel spins up, PixelationPassNode pixel size ramps up, and the palette quantizes down to 1-bit. It then cross-fades into the Canvas 2D era-1 world. If the 3D wheel is not loaded yet, a plain CSS scale/fade is used instead.

## 4. Game design

- **Controls (single button)**: Space / ArrowUp / pointerdown anywhere. Hold for a higher jump (release early to cut the jump short, like Chrome Dino). 100 ms input buffer, 80 ms coyote time.
- **Speed**: `v = v0 · (1 + 0.6·(1 − e^(−t/240)))`, giving ≈1.13× at 1 min, 1.24× at 2 min, 1.38× at 4 min, capped at 1.6×. Gentle, as asked.
- **Obstacles** (cat-themed, 3 ground + 1 air): cucumber, robot vacuum, flower pot, and a low-flying crow. Gaps are drawn in *time* (seconds of travel), not distance, so they stay jumpable as speed rises. A seeded RNG plus a bot-verified "always clearable" rule.
- **Fairness during transitions**: ~2 s obstacle-free breather around each era change. The 3D camera stays near side-on so jump timing remains readable.
- **Simulation** is renderer-agnostic: fixed 120 Hz step, 2D logic (x = distance, y = height), shared by the 2D and 3D views. Rendering interpolates between steps. Hitboxes are identical in every era.
- **Screens**: Title (wheel) → Run → Pause (blur / `visibilitychange` / Esc / P / small pause button on touch) → Game over (score, high score in localStorage). Same single button resumes/restarts.
- **Restart**: resume at the **start of the highest era reached this session**, with score reset. See open question 1.
- **Dev/test**: `?era=N` URL param to jump straight to an era; `?seed=` for deterministic runs; `?tier=` to force a quality tier.

## 5. Era timeline (graphics progression)

The two axes from the prompt (pixel → 3D, B&W → HDR) are merged into one timeline. Times are approximate for an unbroken run.

| # | Era | ~Starts at | Renderer | Look |
|---|---|---|---|---|
| 1 | **1-bit** | 0:00 | Canvas 2D | Black cat silhouette with a white eye pixel, ground line, clouds. Pure Chrome Dino homage. ~150 virtual rows. |
| 2 | **4-color (CGA)** | 0:25 | Canvas 2D | Black/cyan/magenta/white (alternative: Game Boy greens). Hills appear. |
| 3 | **8-color (3-bit RGB)** | 0:50 | Canvas 2D | ZX/teletext primaries, pixel size halves, first parallax layer (rooftops). |
| 4 | **256-color (VGA/16-bit)** | 1:15 | Canvas 2D | Rich palette, Bayer-dithered sunset gradient, 3 parallax layers, more animation frames, resolution doubles again. |
| 5 | **True color, PS1 polygons** | 1:50 | three.js | Low-poly cat LOD, RetroPassNode (vertex snapping, affine textures), ~320-line internal res, nearest filtering, near side-on camera. |
| 6 | **Smooth 3D** | 2:30 | three.js | Full res, PBR, real shadows, fog, AA. Camera eases to a slight 3/4 angle (gameplay stays readable). |
| 7 | **HDR / next-gen** | 3:20 | three.js | Full cat LOD, sheen "fur", GTAO, bloom, TRAA, DoF, godrays, motion blur. **HDR output** if `(dynamic-range: high)` + WebGPU; otherwise the best SDR equivalent (no fake "HDR" label). The SUPER wheel reappears as the sun. |

### Transitions

1. **Raster wipe** (1→2): a CRT beam sweeps top to bottom, with the new palette behind the beam and a small degauss wobble.
2. **Paint bloom** (2→3): new colors spread radially out from the cat while a mosaic dissolve halves the pixel size.
3. **Mode-7 swoop** (3→4): SNES-style rotate/zoom of the playfield, then it settles back at higher resolution with parallax.
4. **Pop-out** (4→5, the hero transition): the current pixel-cat frame's pixels extrude into voxels (`InstancedMesh`) exactly over the 2D sprite. The camera dollies from a near-orthographic view into perspective. The voxels collapse into the low-poly 3D cat at the **same run-cycle phase**, and the flat background peels away to reveal the 3D world.
5. **Focus pull** (5→6): vertex-snap strength and pixelation ramp to 0, internal res ramps to native, and shadows fade in, like a lens finding focus.
6. **Sunrise exposure** (6→7): the sun (the wheel) rises with an exposure ramp. Bloom and highlights grow; on HDR displays highlights go past SDR white. No harsh full-screen flash (photosensitivity), and it is softened further under `prefers-reduced-motion`.

## 6. Quality tiers ("best graphics the device can provide")

- **Inputs**: WebGPU availability and adapter limits, `deviceMemory`, `hardwareConcurrency`, `(pointer: coarse)`, `(dynamic-range: high)`, `(color-gamut: p3)`, `saveData`, `prefers-reduced-motion`, plus the wheel benchmark.

| Tier | Typical device | Render scale / DPR cap | Post | Shadows |
|---|---|---|---|---|
| Low | entry phone, old iGPU, WebGL2 fallback | 0.5–0.75, DPR ≤ 1.5, FSR1 upscale | FXAA, light bloom | blob shadow |
| Medium | mid phone, modern iGPU | 0.75–1, DPR ≤ 1.5 | bloom, half-res GTAO, SMAA | 1024 map |
| High | flagship phone, good iGPU | 1, DPR ≤ 2 | + TRAA, DoF, godrays | 2048 PCF soft |
| Ultra | discrete GPU | 1, DPR ≤ 2 | + SSR, SSGI, motion blur | 2048+ |

- **Dynamic resolution**: a frame-time EMA adjusts render scale in steps. A sustained miss drops one tier; long headroom probes one tier up (once). Target 60 fps; Low may hold a steady 30.
- The 2D eras are cheap everywhere: render to a low-res offscreen canvas, then nearest-neighbor upscale.

## 7. Responsive full-screen layout

- `100dvh` full-bleed canvas, `viewport-fit=cover`, safe-area insets for the HUD, `touch-action: none`, no scroll/zoom/selection.
- **Camera fit**: world height is fixed in units. The visible width grows with aspect ratio, but there is a **minimum look-ahead** (≈2.5 s of travel). In portrait, the view fits that look-ahead in width and fills the extra height with sky/ground, so phones in portrait aren't unfairly short-sighted.
- 2D eras: integer pixel scale where possible, `virtualCols = ceil(screenW / pixelSize)`.
- **HUD corners**:

  | Corner | Contents |
  |---|---|
  | top-right | score / HI |
  | top-left | pause button during play; **"Fork me on GitHub" ribbon** on title + pause (+ game over) |
  | bottom-right | **`v.xxxx`** version, small, low contrast, non-interactive |
  | bottom-left | free; "Credits" link on title/pause screens (CC-BY attribution) |

## 8. Asset pipeline (Blender via MCP)

Scripts are kept in `tools/blender/*.py` so they are reproducible and run through `execute_blender_code`. Output is checked with `look`.

1. **Import** the black cat (`aec2569…`). Check the licence/original author and list its actions. Need: `run` (in-place loop), `jump` (takeoff/air/land, or a single clip), `idle`/`sit` (title and pause), optionally `hit`.
2. **If clips are missing**: try the Somali cat. Failing that, author `jump` in Blender from run-cycle poses (arc + tucked legs) with bpy keyframes.
3. **Clean up**: apply transforms, forward = +X, strip root motion, trim and loop clips, rename clips to the names above, scale so cat height ≈ 1 unit.
4. **LODs**: LOD0 ≈ 7k tris (eras 6–7); LOD1 ≈ 800 tris, flat-shaded (PS1 era 5); same skeleton.
5. **Export** glTF binary, then `gltf-transform optimize` with meshopt, quantization, resampled animations, and WebP textures ≤ 1024 px. KTX2 only if `toktx` gets installed. Target ≤ 1.5 MB.
6. **Pixel sprites from the same rig**: orthographic side camera, flat/emission shading, render every run/jump/idle frame at low res (e.g. 48×32 for eras 1–2, 96×64 for eras 3–4). `tools/build-sprites.mjs` then quantizes the frames into **indexed sheets** per palette, with optional Bayer dither. This keeps the 2D and 3D cats the same character with the same run phase, which the Pop-out transition needs. A hand-authored ASCII 1-bit cat ships first as a placeholder and fallback.
7. **Obstacles**: modeled procedurally in bpy (cucumber, robot vacuum, flower pot, crow) to keep licences clean and files tiny. Rendered to sprites the same way.
8. **Credits**: `CREDITS.md` plus an on-screen credits line (CC-BY requires attribution).

## 9. Project layout

`npm create vite` refuses or prompts on a non-empty directory and could overwrite `README.md`, so the vanilla template files are created by hand instead.

```
index.html              critical inline CSS, CSS/SVG wheel, HUD, fork link, version slot
vite.config.js          define __APP_VERSION__, three in its own chunk, es2022 target
wrangler.jsonc          assets-only Worker, preview_urls:false
public/_headers         immutable caching for /assets/*, no-cache for HTML
src/
  main.js               boot, screen state machine, loader orchestration
  config.js             tunables: speeds, era thresholds, palettes, budgets
  input.js  loop.js  loader.js  eras.js  quality.js
  sim/                  world.js cat.js obstacles.js rng.js (renderer-agnostic)
  ui/                   hud.js screens.js
  render2d/             pixelRenderer.js palettes.js dither.js sprites.js transitions2d.js
  render3d/  (lazy)     renderer.js wheel.js world3d.js catModel.js post.js transitions3d.js
  assets/               sprites/*.png models/cat.glb env/studio.jpg
tools/
  blender/*.py          import/cleanup/export/sprite-render scripts
  build-sprites.mjs     palette quantization → indexed sheets
  check-budget.mjs      critical-path size gate
tests/                  vitest: sim + spawn fairness bot
CREDITS.md
```

**Dependencies**: `three`. Dev: `vite`, `wrangler`, `vitest`, `@gltf-transform/cli`, `sharp` (sprites). Plain JS (matches the README's `--template vanilla`).

## 10. Version tag and Cloudflare deploy prep

- Vite `define: { __APP_VERSION__ }` = `'v.' + sha.slice(0, 4)`. The SHA comes from `WORKERS_CI_COMMIT_SHA` (Cloudflare Workers Builds) or `git rev-parse HEAD`, falling back to `v.dev`.
- `npm run deploy` = `vite build && wrangler deploy`. It prints a **warning** if the working tree is dirty, because the version would point at HEAD while uncommitted code ships.
- `wrangler.jsonc`:

  ```jsonc
  {
    "$schema": "node_modules/wrangler/config-schema.json",
    "name": "wheel",
    "compatibility_date": "<build date>",
    "assets": { "directory": "./dist", "not_found_handling": "404-page" },
    "preview_urls": false
  }
  ```

- I verify only with `wrangler deploy --dry-run` and `vite preview`. **You do the real login and deploy**, per CLAUDE.md. No commits or pushes from me.

## 11. Milestones (implementation order)

| M | Deliverable | Done when |
|---|---|---|
| M0 | Scaffold: Vite, `index.html` shell with CSS wheel, fork link, version tag, `_headers`, wrangler config, budget script | `vite build` passes the budget; `wrangler deploy --dry-run` OK; `v.8b72`-style tag shows |
| M1 | Playable era 1 in Canvas 2D with the placeholder ASCII cat; sim, input, HUD, pause/game over, responsive fit | Playwright: interactive ≤ 1 s average, ≤ 3 s conservative; vitest sim + fairness bot green |
| M2 | Blender pipeline: cat import/clean/LOD/export, sprite renders, obstacles, `build-sprites` | `cat.glb` ≤ 1.5 MB with run/jump/idle; sprite sheets for 4 palettes reviewed |
| M3 | Eras 2–4 + transitions 1–3 + era gating | `?era=2..4` render correctly; transitions don't drop frames at 4× CPU throttle |
| M4 | 3D SUPER wheel, tiers + benchmark, progressive upgrade, Crunch transition | 3D wheel ≤ 2.5 s average; stable 60 fps on iGPU Medium |
| M5 | 3D eras 5–7, cat animation synced to sim, Pop-out / Focus pull / Sunrise, `compileAsync` precompile, HDR spike | No shader-compile hitch at era change; HDR on a capable display, clean SDR fallback |
| M6 | Performance pass: dynamic resolution, tier tuning, real phone over LAN (`vite preview --host`), memory check on iOS | Every era holds its tier target on a 5-year-old iGPU laptop and an entry phone |
| M7 | Polish: credits, reduced motion, README, `ai/next_0.md` | Ready for you to deploy |

## 12. Risks and mitigations

- **Shader/pipeline compile hitches** (WebGPU and TSL on WebGL2). Mitigation: `compileAsync` during earlier eras, an off-screen warm-up render, and era gating.
- **TSL on the WebGL2 fallback is heavy on low-end phones.** Mitigation: Low tier keeps node graphs minimal and uses FSR1 upscaling.
- **HDR tone mapping**: three.js only switches the canvas to extended mode; output > 1.0 needs a custom exposure/soft-clip curve. A spike is in M5. If it looks bad, ship wide-gamut P3 SDR and keep "HDR" only where verified.
- **Sketchfab model**: it may be a re-upload, lack a jump clip, or have heavy textures. Mitigation: check the original upload, use the Somali backup, author the jump clip, compress textures.
- **Auto-rendered pixel art can look mushy.** Mitigation: the silhouette for 1-bit is easy; palette eras get hand touch-ups or overrides in `build-sprites`.
- **Bundle creep**: the budget script fails the build.
- **iOS memory and thermal throttling**: 1K textures on mobile, dynamic resolution, and tier step-down.

## 13. Open questions (defaults in bold; I'll proceed with these unless told otherwise)

1. **Restart after death**: **resume at the start of the highest era reached this session (score resets)** vs. a pure Chrome Dino full restart. Full restart means most players never see eras 5–7.
2. **Cat**: **realistic black cat (Evil_Katz)**, subject to its clips checking out, vs. the stylized Somali or the tuxedo cat.
3. **Pacing**: **3D at ~1:50 and HDR at ~3:20** of continuous running. Shorter is possible if you want it to be a quicker demo.
4. **4-color palette**: **CGA cyan/magenta** vs. Game Boy greens.
5. **Audio**: **out of scope for now**. Synthesized WebAudio blips are cheap to add later.
6. **Fork link target**: **https://github.com/doublependu/wheel** (assumes the repo will be public).
