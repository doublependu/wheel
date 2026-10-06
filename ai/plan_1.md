# Plan 1: readable obstacles, a photoreal donut loader, Sketchfab obstacles and a full-game video

Answers `ai/prompt_1.md`.

**Revision 2** (follow-up in chat): defaults accepted, except the obstacles are **cute, stylized low-poly** models instead of photoscans.

## 0. Summary

| Prompt item | Plan |
|---|---|
| Issue 1: obstacles blend into the background | Measure contrast per stage and per obstacle with a dev tool, then fix it with a value-separation rule: background layers stay in a value range the obstacles never use, and obstacles get an outline in 2D and a rim term in 3D. Re-measure until every stage passes. |
| Feature 1: donut loading wheel | The SUPER wheel becomes a SUPER **donut**: a lacquered rainbow torus with ~64 anodized-aluminium bars that rise around its rim. Photoreal studio lighting, contact shadows, AO and DoF, with **no bloom**. The bars fill as a progress ring, then keep dancing. **Play** appears in the donut's hole after a minimum run time (default 2.5 s) and the donut keeps running until it's clicked. |
| Feature 2: Sketchfab obstacles, pixel art early | Import 4 cute, stylized low-poly CC-BY models through Blender MCP and check each licence. Then normalise and export one `obstacles.glb` for stages 5–7. Blender also renders sprite sources, which a Node script turns into a palette-quantized pixel-art atlas for stages 1–4. |
| Recording | Build a `npm run record` harness: system Chrome on this laptop's GPU, Chrome tab capture (video and audio in sync), humanized autopilot, 1080p60. The output is an MP4 covering wheel → Play → stages 1–7 → game over. |

## 1. Facts checked while planning

| Item | Finding |
|---|---|
| Blender MCP | Blender 5.2.1, add-on 1.8 is up to date. **Sketchfab is on**; Poly Haven, Poly Pizza and the generators are off. |
| Machine | Intel Raptor Lake-P UHD iGPU **+ RTX 3050 Laptop** (driver 595.91), 16 threads, 14 GB RAM, Wayland session. Google Chrome 154. ffmpeg has libx264, h264_nvenc, VP9 and Opus. PipeWire is present (`pw-record`). |
| Chrome automation flags | The Chrome binary contains `--auto-accept-this-tab-capture`, `--auto-select-tab-capture-source-by-title`, `--auto-select-desktop-capture-source` and `--enable-unsafe-webgpu`, so tab capture can run unattended. |
| three r186 | `RoundedBoxGeometry`, `reflector({ generateMipmaps })` (rough reflections), `RectAreaLightTexturesLib`, `GTAONode`, `DepthOfFieldNode`, `TRAANode`. `EXRLoader` reads PIZ and DWA. |
| Current wheel | `src/render3d/wheel.js`: pinwheel disc, **bloom in the pipeline** (`out.add(bloom(…))`), additive GPU sparkles, `RoomEnvironment`. `#setTier` rebuilds the wheel after the benchmark, which pops while someone is watching. |
| Current Play timing | The prompt shows at 0.15 s (`hud.setReady` at boot). It's a text prompt, not a button. |

### Why obstacles are hard to see (code review of the current palettes)

| Stage | Low-contrast cases |
|---|---|
| 2 (CGA) | The crow is black on a black sky; only its 1 px outline shows. |
| 3 (3-bit) | The red pot sits in front of red roofs. The green cucumber's lower half sits on the green grass strip. |
| 4 (256) | The dark crow (`#1a1826`) is against dark purple mountains and town. The cucumber is green on green grass. The terracotta pot is against the brown fence. The dark outline (`#1a1020`) disappears on the dark town. |
| 5 (PS1 night) | The crow (`#121018`), vacuum body (`#2c3038`) and dark cucumber are all against a night sky and fog in the `#07–#1b` range. |
| 6–7 | The dark-green cucumber is on grass and dirt of similar value, with the brown fence directly behind the lane. |

### Sketchfab picks: cute, stylized low-poly (preview-checked; licence and origin re-checked at import)

| Obstacle | Primary | Backups | Rejected |
|---|---|---|---|
| Cucumber | Cucumber from "Collection of Vegetables" by JohanHoof `8f9206e5dff740afbab92e073dfe0a93` (hand-painted low poly, 890 faces for the whole set) | Cucumber from "Low poly vegetables and fruits" by ranaaunhaider12 `42671c82…` (flat colour); "Lowpoly cucumber psx" by DinixGlasses `ab76397c…` (182) | Character cucumbers (Pickle Rick, Larry: someone else's IP); photoscans |
| Pot | "Kaktiss" by LanaGre `a5330259df174753a35abfde4c966dc1` (1.4k, round cactus with a pink flower in a terracotta pot) | "Cactus Plant in Pot Low Poly" by zeekhan733 `c7d5e3ec…` (18.8k) | "Kaktusz cserépben" (CC **NC**); "Low Poly Cactus Set" (Free Standard) |
| Vacuum | "Roomba" by Macwithav `94800ce82fe440d3868d53dd908a8836` (540 faces, glowing happy `^ ^` eyes). Its dark navy shell gets lightened for contrast (§2). | "Low-poly Roomba" by Seats `be32b697…` (888, white/black) | "Augustus Roomba" (NC); branded models with logos |
| Crow | "Low Poly Crow" by DracTheZach `00a776f578304cce8c096fc0034582ef` (120 faces, blocky, big eye, yellow beak) | "Crow" by TheNorthernHarpy `05fd8f3f…` (96, blocky); "evil crow" by adrianld `9f46531d…` (272, flying pose) | WildPoly3D crows (cutest, but **NC**); game rips (Little Nightmares, Hello Neighbor); "Cartoon Crow" (Free Standard) |

Rules carried over from the cat: CC-BY or CC0 only, no NC/ND, no "Free Standard". Check the description for rips. Credit every model in `CREDITS.md` and in the game.

## 2. Issue 1: obstacle contrast (measured, not eyeballed)

### 2.1 Measurement: `?contrast` dev page plus `tools/contrast.mjs`

- For each stage 1–7, each obstacle type and 6 scroll offsets:
  - render the frame with the obstacle and an obstacle-only mask (2D: the sprite alpha; 3D: a second render with `overrideMaterial`, obstacles white and everything else black);
  - sample OKLab lightness L along the silhouette edge (inside vs. the 2 px ring outside).
- **Pass**: at least 90 % of edge samples have ΔL ≥ 0.20, and the mean ΔL between the obstacle and its band background is ≥ 0.25. In OKLab terms that is roughly WCAG 3:1 for large objects.
- Output: a table (stage × obstacle → min/median ΔL, pass/fail) and a contact sheet PNG. I run it via Playwright and keep it as a regression check before each change to palettes or looks.
- The cat is measured too and reported separately (next_0 flagged "the stage-5 cat is very dark at night").

### 2.2 Fixes

- **Value separation (all stages)**: each stage's look defines an "obstacle band", from the ground up to the crow's height. Background layers inside the band are limited to a value range. Obstacles take the opposite range, or carry an edge in it.
  - **2D stages**:
    - parallax layers behind the band are dithered toward the sky colour (classic pixel-art depth: far = low contrast);
    - obstacle palettes are picked per stage from the contrast table;
    - a 1 px outline uses whichever palette colour contrasts most with the band (a light outline on dark bands).
    - Concrete changes: the stage-2 crow becomes white/cyan; the stage-3 roofs lose red where pots pass; the stage-4 grass becomes yellower and darker, and the cucumber lighter.
  - **3D stages**: one shared readability term on obstacle materials: `emissive += rimColor · fresnel³ · rim(stage)`.
    - Stage 5 adds a cool moonlight rim plus a blob contact shadow.
    - Stages 6–7 get light aerial haze on the fence/trees layer (`fogNear` closer for scenery than for the lane), and the fence moves 0.5 u further back.
    - Albedo of the new models is tuned (the white vacuum already helps).
- The fixes are applied **after** the new obstacles land (§4), since those change every sprite and model. The measurement tool is built first and gives the "before" numbers.

## 3. Feature 1: the SUPER donut loader

### 3.1 Look (3D, `src/render3d/wheel.js` → `donut.js`)

- **Shape**: a torus (R 1, r ≈ 0.3) split into 10 rainbow segments with bevelled gaps. It faces the camera, tilted back about 15° like a product hero shot.
- **Bars**: about 64 bars (48 on Low, 96 on Ultra) in one `InstancedMesh` of `RoundedBoxGeometry`. They stand on the outer rim and point outward, like an equalizer ring, and the rainbow hue follows the angle. Each bar's height is a damped spring driven on the CPU (64 floats per frame), so it overshoots like a real mechanism.
- **Materials** (`MeshPhysicalNodeMaterial`):
  - segments: candy lacquer (clearcoat with orange-peel normal noise, faint smudge roughness noise);
  - bars: anodized brushed aluminium (metalness 1, anisotropy, tinted);
  - hub: none any more, since the hole is where Play goes.
- **Lighting**: a procedural photo studio (0 bytes), rendered to PMREM:
  - large softbox key, strip-light rim, warm bounce card, grey cyclorama;
  - a shadow-casting key light, so the bars shadow the donut and the donut shadows the floor.
  - Optional upgrade if it's visibly better and ≤ 300 KB: a Poly Haven CC0 studio HDRI. Polyhaven is off in Blender MCP, so it would come from a direct download, converted to EXR (DWA) in Blender.
- **Floor**: a dark satin studio floor. On Medium and above it shows a rough reflection (`reflector({ generateMipmaps: true })` sampled at a roughness LOD). Low gets a baked radial contact shadow.
- **Post**:
  - High and Ultra: TRAA, GTAO and subtle DoF;
  - all tiers: Neutral tone mapping and a light film grain.
  - **No bloom**, and the additive sparkles are removed because they read as bloom.
  - The crunch-to-1-bit node is kept for Start.
- **Tier changes after the benchmark** no longer rebuild the donut on screen. Only resolution and post toggles change. If a rebuild is unavoidable, it is built off-screen and swapped in.

### 3.2 Motion and timing

- **Loading phase**: bars rise one by one clockwise as a progress ring.
  - Shown progress = min(real progress, time ÷ min run time). Real progress counts the core, audio core, obstacle atlas, 3D donut, 3D world and models.
  - The donut spins slowly the whole time.
- **Play appears** when all of these hold:
  - t ≥ `WHEEL.minRun` (**2.5 s**, in `config.js`);
  - the core and obstacle atlas are ready;
  - the 3D donut has been on screen for ≥ 1 s.
  - **Hard cap 3.0 s**: at 3.0 s Play shows anyway, over the CSS donut if needed. That keeps the spec's 2–3 s and stays under 4 s.
- **Idle phase**: the bars switch to a travelling wave with a little per-bar noise. The donut keeps running until Play.
- **Play** is a real `<button>` (▶) centred in the donut's hole. Space, Enter or a tap anywhere also start the game; taps before Play shows are ignored. On click, the bars spike and the existing crunch runs.
- **CSS donut at first paint** (in `index.html`, about +1.5 KB gzip):
  - a conic-gradient ring with a radial mask hole and shading gradients;
  - 48 `<i>` bars with staggered keyframes (fill, then wave).
  - The CSS and 3D waves share one clock (`performance.now()`), so the cross-fade lines up.
- `prefers-reduced-motion`: slower spin and lower bars.
- **Consistency touch-ups**: the favicon and the stage-7 sun-wheel become donuts too (the sun keeps its HDR bloom, which is in-game, not the loader).

**Trade-off**: interaction moves from 0.15 s to about 2.5 s on purpose, because the prompt asks for the wheel to run for a while first. It stays within the spec's 2–3 s. `WHEEL.minRun` is the single knob.

## 4. Feature 2: Sketchfab obstacles → GLB and pixel art

### 4.1 Blender (scripts in `tools/blender/`, run via `execute_blender_code`, checked with `look`)

1. **`import_obstacles.py`**:
   - import each primary into its own scene (`import_asset`);
   - record the licence, author and URL;
   - read the description for rip warnings; fall back to a backup on any doubt.
2. **Normalise**:
   - apply transforms; ground at y = 0; centred on x; the crow faces −X (toward the cat);
   - uniform-scale each model into its `OBSTACLES` visual box.
   - If a model's proportions don't fit, change the box and hitbox in `config.js` instead of stretching, then re-run `npm test` (jump window ≥ 400 ms, reachability).
3. **Optimise**: the models are already low poly (≤ 1.4k faces each), so there's no decimation. Merge each model's meshes, keep flat or painted materials, textures ≤ 512 px WebP, strip logos.
4. **Crow flap**: use the model's own clip if it has one. Otherwise author a 2-pose flap loop (wing bones or vertex groups), the same way `author_cat_anims.py` authored the cat's run and jump.
5. **`export_obstacles.py`**: one `public/models/obstacles.glb` (4 nodes + `Flap` clip), then `gltf-transform optimize` (meshopt). Target **≤ 400 KB**. Plus `obstacles.json` with node names, offsets and credits.
6. **`render_obstacle_sprites.py`**:
   - orthographic side camera at about 10° elevation, so the vacuum's top reads;
   - transparent background;
   - renders at 8× each stage's sprite size: a colour pass (flat studio light), an alpha pass and a line pass (Freestyle or normal-edge);
   - crow flap at 2 frames (stages 1–3) and 4 frames (stage 4).

### 4.2 Pixel art (`tools/build-obstacle-sprites.mjs`, sharp, reusing `quantize()` and `outline()` from `palettes.js`)

| Stage | Conversion |
|---|---|
| 1 (1-bit, PPU 24) | Alpha-majority downsample → black silhouette. The line pass adds 1 px white detail, Chrome-dino style. |
| 2 (CGA) | Luminance posterized to 3 levels and mapped to per-obstacle CGA colours from `obstacle-palettes.json`, chosen from the contrast table. |
| 3 (3-bit, PPU 32) | Nearest palette colour (perceptual), no dither, contrast outline. |
| 4 (256, PPU 48) | Area downsample → 6×7×6 cube with Bayer dither, top-light rim, contrast outline. |

- Output: `src/assets/obstacles.png` (atlas, target ≤ 12 KB) plus `obstacles.json` (rects and `ox`/`oy` in the current `spriteCanvas` convention). Any frame that auto-converts badly can be replaced with a hand-touched PNG.
- **Runtime**:
  - `renderer2d` draws from the atlas with source rects, fetched at boot in parallel with the core. Play waits for it, which costs nothing because Play already waits ≥ 2.5 s.
  - If it hasn't loaded by the 3 s cap, the current procedural sprites are used.
  - Stages 5–7 load `obstacles.glb` with the 3D world, and stage 5 is gated on it. `makeObstacle()` stays as the fallback. The rim term from §2 is applied to the loaded materials.

## 5. Recording the whole game

- **`npm run record`** (`tools/record/record.mjs` plus `harness.html`; new devDependency `playwright-core`, which uses the system Chrome with no browser download):
  1. `npm run build`, then `vite preview`.
  2. Launch Chrome headed at 1920×1080 CSS px, DPR 1:
     - flags `--auto-accept-this-tab-capture` and `--enable-unsafe-webgpu`;
     - PRIME env vars to run on the RTX 3050.
  3. The harness page starts `getDisplayMedia({ preferCurrentTab, audio, suppressLocalAudioPlayback: true })` from a Playwright click (real user activation). It then loads the game full-size in an iframe, so the capture survives the game loading. **Video and audio are captured together, in sync.**
  4. `MediaRecorder` (VP9/Opus, about 20 Mbps, 1 s chunks streamed to Node) records:
     - cold load → donut loading → Play shows;
     - 3 s of idle donut → Playwright clicks **Play** (a real gesture, which unlocks audio);
     - stages 1–7 (about 2:08);
     - about 40 s of stage 7 → a deliberate crash → 5 s of the game-over screen.
     - Total about 3:20.
  5. ffmpeg → `recordings/wheel-<sha4>-<date>.mp4` (x264 CRF 16, CFR 60, AAC 256k, faststart). `recordings/` is git-ignored.
- **Game-side params** (they work in production builds):
  - `?autopilot=human`: jump timing randomized inside the safe window, occasional held high jumps, seeded;
  - `&crash=<seconds>`: stops jumping at that run time;
  - in autopilot mode, window blur no longer pauses the game (`visibilitychange` still does).
- **QA**:
  - the page logs a rAF frame-time histogram per stage and the GPU backend, adapter and tier;
  - the run fails if > 1 % of frames are over 20 ms in any stage (then retry one tier lower);
  - ffmpeg checks loudness, peaks and duration;
  - I review one extracted still per stage before calling it done.
- **By-product**: the same harness on the **Intel iGPU** gives per-stage fps at the auto tier. That is the "average PC without a dedicated GPU" check from the spec, which next_0 couldn't do.
- **Fallback** if tab capture misbehaves: Playwright `recordVideo` for picture plus `pw-record` of Chrome's PipeWire sink for audio, muxed by timestamp. The quality is lower, so it's a fallback only.

## 6. Milestones

| M | Deliverable | Done when |
|---|---|---|
| M0 | Spikes: (a) the tab-capture harness records 20 s of 1080p60 with audio on WebGPU; (b) the 4 primary models imported, licences vetted, contact sheet rendered | Clean 20 s clip; 4 models (or backups) approved with recorded licences |
| M1 | Contrast tool (§2.1) and "before" report | Table and contact sheet for stages 1–7 |
| M2 | Obstacle GLB and the sprite pipeline (§4), runtime atlas and GLB loading, fallbacks | `obstacles.glb` ≤ 400 KB, atlas ≤ 12 KB; `npm test` green (hitboxes re-checked); `?era=1..7` show the new obstacles |
| M3 | Contrast fixes (§2.2) | Every stage × obstacle passes; before/after sheets |
| M4 | SUPER donut: CSS and 3D, bars, no bloom, Play button, min-run and cap, no tier pop | Play at 2.5 s ±0.1 on both load profiles, ≤ 3.0 s worst; 60 fps on the iGPU at Medium; the budget check passes |
| M5 | Record the full game (§5) | MP4 in `recordings/`; frame-time and loudness checks pass; iGPU fps table |
| M6 | README (new params, `npm run record`), CREDITS, `ai/next_1.md` | Ready for you to commit |

## 7. Risks

- **Low-poly models next to the smooth 3D world** can look toy-like in stage 7. That's intended (cute), and the PBR lighting, rim and shadows still apply.
- **Auto pixel art can look mushy.** Mitigation: the line pass, per-stage palette maps and hand overrides per frame.
- **Model proportions vs. hitboxes.** Mitigation: change the boxes rather than stretch, guarded by the existing tests.
- **Tab capture at 1080p60 drops frames** (VP9 software encoding). Mitigation: H.264 when `isTypeSupported`, lower bitrate, or 1440×810 upscaled. The frame-time log tells us.
- **WebGPU on Linux Chrome or PRIME offload doesn't pick the RTX.** Mitigation: record on WebGL2 at the High tier on the RTX, and log the backend in the output.
- **A Chrome window will be open on your desktop for about 4 min** during `npm run record`. Clicking into it no longer pauses the game; audio is muted locally.
- **2.5 s to Play is slower than today's 0.15 s.** It's intentional and tunable (§3.2).

## 8. Decisions (answered in chat)

1. "Donut" = a ring-shaped loading wheel (torus + rising bars).
2. Minimum wheel run 2.5 s (inside the spec's 2–3 s).
3. **Cute, stylized low-poly obstacles** (changed from the photoscan default).
4. Video: 1920×1080 at 60 fps, landscape MP4, ending in a deliberate crash about 40 s into stage 7. No vertical cut.
5. The cat gets the same rim/contrast treatment.
