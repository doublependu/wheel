# Plan 0 — SUPER wheel → cat runner that "evolves" its graphics *and sound*

Answers `ai/prompt_0.md`. Nothing implemented yet.

**Revision 2** (follow-up in chat):
- after game over the run **restarts from the beginning**;
- the **default difficulty** is tuned so a typical player reaches the later graphics stages;
- **sound is added** and evolves in stages alongside the graphics.

## 0. Core idea

The game opens on a photorealistic three.js "SUPER wheel of death". When you start, the wheel gets crushed down to a 1-bit pixel world with a 1-bit beeper soundtrack. From there the cat runs through the history of computer graphics *and game audio*:

- **Graphics**: 1-bit → CGA → 8-color → 256-color → PS1 polygons → smooth PBR 3D → HDR.
- **Sound**: beeper → 4-channel chip → FM synth → 16-bit samples → CD-era → modern mix → spatial "HDR audio".

You *earn the wheel's graphics and sound back* by running. One original theme plays the whole time, re-orchestrated in each era, so you can hear the progression as well as see it.

That arc also solves the main engineering tension. The spec needs **interaction in 1–3 s on entry-level phones**. The prompt wants **maximum three.js graphics**. Those fit together because:

- the first eras are tiny: Canvas 2D graphics and oscillator-only audio, so the game is playable in about 1 s;
- three.js, 3D assets and the sample bank stream in **while the player is in the cheap early eras**;
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
| Local tools | node 24, npm 11, **ffmpeg** (for encoding audio). No `toktx` (so no KTX2 encoding unless installed). `@gltf-transform/cli` 4.5.1 available via npm |
| Audio libs (npm) | `soundfont2` 0.5.0 (MIT): an SF2 parser for build-time sample extraction. `spessasynth_lib` 4.3 (Apache-2.0): a full in-browser SF2 synth, considered but too heavy for what we need |
| Browser audio rules | An AudioContext only starts after a user gesture, so the title wheel is silent until the first tap. The start tap is that gesture. |
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
| T1a | Audio core, loaded in parallel and not blocking start: beeper/chip/FM synths, sequencer, song data, crusher AudioWorklet | ≤ 10 KB | ~1 s |
| T2 | three.js chunk + wheel scene, `RoomEnvironment` lighting; cross-fade CSS wheel → 3D wheel (matching rotation angle) | ~300 KB + ~30 KB | ~1.5–2.5 s |
| T3 | Wheel upgrades in place: post FX → UltraHDR studio env → HDR output (if supported) | ≤ 400 KB | idle |
| T4 | Era 2–4 sprite sheets (tiny), the **era-4 sample subset**, then 3D world, obstacles, cat `.glb`, env, **full sample bank**, meows; `renderer.compileAsync()` precompiles each 3D era's pipelines | era-4 samples ≤ 300 KB; full bank ≤ 1.5 MB; cat ≤ 1.5 MB; total by era 5 ≤ 4.5 MB | during gameplay, before needed |

Rules:

- The wheel screen **is the title screen**. "Start" unlocks at T1 and does not wait for the 3D wheel. The wheel keeps upgrading itself while you watch (CSS → 3D → lit → post FX → HDR), which previews the game's theme.
- A loader queue with priorities. The next era's assets come first. Under `saveData` or slow connections, heavy assets are deferred.
- **Era gating**: a graphics era transition fires only when run time ≥ threshold **and** `assetsReady(era)` **and** `pipelineCompiled(era)`, on the next musical bar. Otherwise the current era continues seamlessly.
- **Audio never blocks an era.** If an era's samples aren't decoded yet, it keeps the previous era's instruments until they are.
- `npm run build` runs a budget check (`tools/check-budget.mjs`) that fails if T0/T1/T1a exceed their budgets.

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
- **Start transition "Crunch"**, picture and sound together. The start tap unlocks audio: a lush stereo wheel whoosh with reverb spins up. Then PixelationPassNode pixel size ramps up and the palette quantizes down to 1-bit. At the same time the crusher worklet takes the whoosh down to 1-bit at a low sample rate until it becomes the beeper's first note. It then cross-fades into the Canvas 2D era-1 world. If the 3D wheel is not loaded yet, a plain CSS scale/fade with the same audio crunch is used.

## 4. Game design

- **Controls (single button)**: Space / ArrowUp / pointerdown anywhere. Hold for a higher jump (release early to cut the jump short, like Chrome Dino).
- **Simulation** is renderer-agnostic: fixed 120 Hz step, 2D logic (x = distance, y = height), shared by the 2D and 3D views and by the audio event bus. Rendering interpolates between steps. Hitboxes are identical in every era.
- **Obstacles** (cat-themed, 3 ground + 1 air): cucumber, robot vacuum, flower pot, and a crow. Gaps are drawn in *time* (seconds of travel), not distance, so they stay jumpable as speed rises. A seeded RNG plus a bot-verified "always clearable" rule.
- **Screens**:
  - Title (wheel) → Run → Pause (blur / `visibilitychange` / Esc / P / small pause button on touch) → Game over (score, high score in localStorage).
  - **Game over → one tap restarts from the beginning**: era 1, score 0, full lives. A quick reverse Crunch crushes the picture and sound back to 1-bit. The wheel title is not shown again, so retries are instant.
- **Camera in 3D eras** stays near side-on so jump timing remains readable.
- **Dev/test**: URL params `?era=N` (jump to an era), `?seed=` (deterministic runs), `?tier=` (force a quality tier), `?difficulty=` (choose a preset).

### 4.1 Default difficulty "Nine Lives": tuned so typical players see every era

Restarting from the beginning makes reachability the key tuning goal. Every lever pulls the same way:

| Lever | Default ("Nine Lives") | Why |
|---|---|---|
| Lives | **9** (it's a cat). A hit costs 1 life, the obstacle gets knocked away cat-style, 1.5 s invulnerability blink, era-styled "meow" | A few mistakes don't end the run. Game over only after the 9th hit. |
| Era length | Eras 1–4: **10 bars = 20 s** each. Eras 5–6: ~12 bars. **Final era at ~2:08**, then endless. | Short enough that restarting from era 1 isn't a chore |
| Speed | `v = v0 · (1 + 0.4·(1 − e^(−t/180)))`: 1.08× at 0:40, ~1.2× at 2:08, cap 1.4× | "Slightly faster over time" |
| Obstacle ramp | Era 1: single ground obstacles, gaps ≥ 1.6 s. Era 2: more variety. Era 3: crows (high = run under, low = jump). Era 4+: occasional pairs that one jump clears. Minimum gap shrinks to 1.1 s by era 7. | Never needs frame-perfect timing |
| Forgiveness | Hitboxes at 75 % of the visual; 100 ms coyote time; 150 ms jump buffer; hold-to-jump-higher | Near misses count as misses |
| Breathers | 2 s with no new obstacles around every era transition and after each lost life | You don't die mid-transition while the camera or palette is changing |

- **Lives HUD**: one era-styled paw icon plus a count (`🐾×9` style) under the score. It stays compact on small phones.
- **Other presets** live in `config.js` but aren't in the UI yet:
  - `classic` = 1 life, 85 % hitboxes, 0.6 speed factor, Chrome-Dino density (`?difficulty=classic`);
  - an easier `kitten` preset if testing shows it's needed.
- **Reachability is tested, not guessed.** A Monte-Carlo vitest suite runs 1,000 seeded runs with a noisy "player" bot (jump-timing error σ = 70 ms, ~250 ms reaction, 2 % missed presses). Targets:
  - ≥ 95 % of runs reach **era 5 (3D)**;
  - ≥ 80 % reach **era 7 (HDR)**;
  - a "first-timer" bot (σ = 110 ms) reaches era 7 in ≥ 60 % of runs;
  - a perfect bot never dies (fairness).

  If a target is missed, tune lives, hitbox scale, gaps and speed (in that order) until it passes.

## 5. Era timeline (graphics + sound)

The two visual axes from the prompt (pixel → 3D, B&W → HDR) plus the sound stages are merged into one timeline. Music is 120 BPM, so 1 bar = 2 s. Era starts are whole bars of uninterrupted run time.

| # | Era | Starts (bar) | Renderer | Look | Sound |
|---|---|---|---|---|---|
| 1 | **1-bit** | 0:00 (0) | Canvas 2D | Black cat silhouette with a white eye pixel, ground line, clouds. Pure Chrome Dino homage. ~150 virtual rows. | 1-voice **beeper** |
| 2 | **4-color (CGA)** | 0:20 (10) | Canvas 2D | Black/cyan/magenta/white (alternative: Game Boy greens). Hills appear. | **4-channel chip** (4 colors ↔ 4 channels) |
| 3 | **8-color (3-bit RGB)** | 0:40 (20) | Canvas 2D | ZX/teletext primaries, pixel size halves, first parallax layer (rooftops). | **FM synth**, ~8 voices |
| 4 | **256-color (VGA/16-bit)** | 1:00 (30) | Canvas 2D | Rich palette, Bayer-dithered sunset gradient, 3 parallax layers, more animation frames, resolution doubles again. | **16-bit samples**, 8 channels, 32 kHz, echo |
| 5 | **True color, PS1 polygons** | 1:20 (40) | three.js | Low-poly cat LOD, RetroPassNode (vertex snapping, affine textures), ~320-line internal res, nearest filtering, near side-on camera. | **CD-era**: 24 voices, 22 kHz stereo, console-style reverb |
| 6 | **Smooth 3D** | 1:44 (52) | three.js | Full res, PBR, real shadows, fog, AA. Camera eases to a slight 3/4 angle (gameplay stays readable). | **Modern mix**: full-rate samples, stereo panning, paw-step foley, ambience |
| 7 | **HDR / next-gen** | 2:08 (64) | three.js | Full cat LOD, sheen "fur", GTAO, bloom, TRAA, DoF, godrays, motion blur. **HDR output** if `(dynamic-range: high)` + WebGPU; otherwise the best SDR equivalent (no fake "HDR" label). The SUPER wheel reappears as the sun. | **"HDR audio"**: spatial HRTF, convolution reverb, wide-dynamic-range mix, cinematic arrangement |

### Transitions (each one is 1–2 bars long and starts on a downbeat)

| From → to | Picture | Sound |
|---|---|---|
| wheel → 1 | **Crunch** (see §3) | Hi-fi whoosh bitcrushed down to the first beeper note |
| 1 → 2 | **Raster wipe**: a CRT beam sweeps top to bottom, with the new palette behind it and a small degauss wobble | The 4 chip channels switch on one per beat as the beam passes |
| 2 → 3 | **Paint bloom**: new colors spread radially out from the cat while a mosaic dissolve halves the pixel size | Filter sweep opens up into an FM bell swell |
| 3 → 4 | **Mode-7 swoop**: SNES-style rotate/zoom of the playfield, then it settles back at higher resolution with parallax | Pitch swoop (tape spin-up), then the echo unit kicks in |
| 4 → 5 | **Pop-out** (the hero transition): the current pixel-cat frame's pixels extrude into voxels (`InstancedMesh`) exactly over the 2D sprite. The camera dollies from a near-orthographic view into perspective. The voxels collapse into the low-poly 3D cat at the **same run-cycle phase**, and the flat background peels away to reveal the 3D world. | An original "disc spin-up" shimmer (not a copy of any console boot sound), then the CD-era arrangement drops in |
| 5 → 6 | **Focus pull**: vertex-snap strength and pixelation ramp to 0, internal res ramps to native, and shadows fade in, like a lens finding focus | Low-pass "muffled" → full band; mono → wide stereo |
| 6 → 7 | **Sunrise exposure**: the sun (the wheel) rises with an exposure ramp. Bloom and highlights grow; on HDR displays highlights go past SDR white. No harsh full-screen flash (photosensitivity), and it is softened further under `prefers-reduced-motion`. | Orchestral swell + timpani; the reverb opens up into a large space; spatial audio turns on |

## 6. Sound design: the audio evolves like the graphics

### 6.1 Music

- **One original theme**: a 16-bar A/B tune at 120 BPM, with no resemblance to existing game music. The homages are to the *sound technology*, not to any existing tune.
- The theme is written once as compact tracker-style pattern data (`src/audio/song.js`). Each era has its own **arrangement layers** and **instrument set**, so you hear the same melody "upgrade":

| # | Sound technology homage | Voices | How it's made (Web Audio, mostly procedural) | Arrangement |
|---|---|---|---|---|
| 1 | PC speaker / 1-bit beeper | 1 | Square `OscillatorNode`, on/off only (no envelopes). SFX **steal the single voice** and interrupt the melody, like the real thing. | melody only |
| 2 | 4-channel handheld chip | 4 | 2 pulse (12.5 / 25 / 50 % duty via `PeriodicWave`), one 4-bit 32-step wavetable, one LFSR noise buffer; 4-bit crusher on the bus | + bass, noise drums |
| 3 | FM synthesis (late-80s sound cards and consoles) | ~8 | 2-operator FM: modulator oscillator → gain → carrier `.frequency`, ADSR envelopes | + chords, arpeggios, FM bells and bass |
| 4 | 16-bit sample-based console | 8 | Small sample subset resampled to 32 kHz mono, soft low-pass interpolation, feedback-delay **echo** | + sampled drums, string pad, slap bass |
| 5 | CD era | 24 | Full sample bank at 22 kHz stereo, console-style reverb preset (short generated IR) | full band |
| 6 | Modern mix | 32 | Full-rate samples, bus compression, stereo panning that follows obstacles, **paw-step foley synced to the 3D run cycle**, wind/birds ambience bed | + countermelody, live-feel drums |
| 7 | "HDR audio" (wide-dynamic-range game mixing) | 32+ | HRTF `PannerNode` for passing crows/obstacles, convolution reverb, **priority-based loudness mixer** (loud events duck quieter ones, so peaks hit harder), mastering limiter | cinematic: strings, choir pad, timpani |

- **Reacting to play**: after a lost life the music is muffled (low-pass) for one beat. On pause it is low-passed and ducked. On game over a short descending jingle plays in the current era's voice.

### 6.2 Sound effects (each one re-voiced per era)

- **Events**: jump, land, hit, life lost, score milestone (every 100 points, like Chrome Dino), era sting, game over, UI start/pause.
- SFX fire **immediately** from sim events. Only music and transitions are quantized to the beat.
- **The meow evolves**, a signature moment:
  - two-tone beep (era 1);
  - pulse pitch sweep (2);
  - FM formant "meow" (3);
  - lo-fi 32 kHz sample (4);
  - CD-quality meow (5);
  - a real recorded meow with spatial placement (6–7).

### 6.3 Engine

- **Context**: `AudioContext({ latencyHint: 'interactive' })`, created and resumed inside the start tap handler (iOS needs this). `navigator.audioSession.type = 'ambient'` where supported, so we respect the iOS silent switch and don't stop the user's own music.
- **Signal graph**: per-era instrument bank → era bus → **crusher AudioWorklet** (automatable bit depth and sample rate; used in eras 1–2 and for the Crunch) → echo/reverb sends → compressor/limiter → output. Era buses cross-fade during transitions.
- **Sequencer**: a lookahead scheduler wakes every 25 ms and schedules **200 ms ahead** on `AudioContext.currentTime`. The generous lookahead rides through main-thread hitches from shader compiles or garbage collection.
- **Sync with visuals**: the sim decides that an era is due. The transition is scheduled on the next bar of the audio clock, and the picture starts it when the clock reaches that bar (mapped via `ctx.getOutputTimestamp()`).
- **Controls**: a mute toggle (speaker icon + `M` key), saved in localStorage. A hidden tab calls `ctx.suspend()`.
- **No download for eras 1–3, the wheel whoosh, ambience or reverb IRs.** Everything is synthesized; IRs are rendered at runtime with an `OfflineAudioContext` (decaying filtered noise).

### 6.4 Audio assets

- **Samples**: extracted at build time from a permissively licensed General MIDI SoundFont (e.g. FluidR3_GM, reportedly MIT; **verify**) by `tools/build-samples.mjs` (uses `soundfont2`).
  - ~10 instruments with a few key zones each; loop points stored in JSON.
  - Encoded with ffmpeg: Opus/WebM, with AAC fallback chosen by a decode check.
  - Era-4 subset ≤ 300 KB; full bank ≤ 1.5 MB.
- **Meows**: CC0 recordings (verify licence, credit anyway), with a formant-synthesis fallback.

## 7. Quality tiers ("best graphics and sound the device can provide")

- **Inputs**: WebGPU availability and adapter limits, `deviceMemory`, `hardwareConcurrency`, `(pointer: coarse)`, `(dynamic-range: high)`, `(color-gamut: p3)`, `saveData`, `prefers-reduced-motion`, plus the wheel benchmark.

| Tier | Typical device | Render scale / DPR cap | Post | Shadows | Audio |
|---|---|---|---|---|---|
| Low | entry phone, old iGPU, WebGL2 fallback | 0.5–0.75, DPR ≤ 1.5, FSR1 upscale | FXAA, light bloom | blob shadow | equal-power panning, ≤ 16 voices, ≤ 1 s IR |
| Medium | mid phone, modern iGPU | 0.75–1, DPR ≤ 1.5 | bloom, half-res GTAO, SMAA | 1024 map | equal-power, 24 voices, 1.5 s IR |
| High | flagship phone, good iGPU | 1, DPR ≤ 2 | + TRAA, DoF, godrays | 2048 PCF soft | HRTF, 32 voices, 2.5 s IR |
| Ultra | discrete GPU | 1, DPR ≤ 2 | + SSR, SSGI, motion blur | 2048+ | HRTF, 32+ voices, 2.5 s IR |

- **Dynamic resolution**: a frame-time EMA adjusts render scale in steps. A sustained miss drops one tier; long headroom probes one tier up (once). Target 60 fps; Low may hold a steady 30.
- The 2D eras are cheap everywhere: render to a low-res offscreen canvas, then nearest-neighbor upscale.

## 8. Responsive full-screen layout

- `100dvh` full-bleed canvas, `viewport-fit=cover`, safe-area insets for the HUD, `touch-action: none`, no scroll/zoom/selection.
- **Camera fit**: world height is fixed in units. The visible width grows with aspect ratio, but there is a **minimum look-ahead** (≈2.5 s of travel). In portrait, the view fits that look-ahead in width and fills the extra height with sky/ground, so phones in portrait aren't unfairly short-sighted.
- 2D eras: integer pixel scale where possible, `virtualCols = ceil(screenW / pixelSize)`.
- **HUD corners**:

  | Corner | Contents |
  |---|---|
  | top-right | score / HI, lives (`🐾×9`) |
  | top-left | pause + mute buttons during play; **"Fork me on GitHub" ribbon** on title, pause and game over |
  | bottom-right | **`v.xxxx`** version, small, low contrast, non-interactive |
  | bottom-left | free; "Credits" link on title/pause screens (CC-BY attribution) |

## 9. Asset pipeline (Blender via MCP)

Scripts are kept in `tools/blender/*.py` so they are reproducible and run through `execute_blender_code`. Output is checked with `look`.

1. **Import** the black cat (`aec2569…`). Check the licence/original author and list its actions. Need: `run` (in-place loop), `jump` (takeoff/air/land, or a single clip), `idle`/`sit` (title and pause), `hit` (stumble; can be authored).
2. **If clips are missing**: try the Somali cat. Failing that, author `jump` and `hit` in Blender from run-cycle poses with bpy keyframes.
3. **Clean up**: apply transforms, forward = +X, strip root motion, trim and loop clips, rename clips to the names above, scale so cat height ≈ 1 unit.
4. **Foot-contact markers**: record the frames where each paw lands in the run clip. They drive the paw-step foley in eras 6–7.
5. **LODs**: LOD0 ≈ 7k tris (eras 6–7); LOD1 ≈ 800 tris, flat-shaded (PS1 era 5); same skeleton.
6. **Export** glTF binary, then `gltf-transform optimize` with meshopt, quantization, resampled animations, and WebP textures ≤ 1024 px. KTX2 only if `toktx` gets installed. Target ≤ 1.5 MB.
7. **Pixel sprites from the same rig**: orthographic side camera, flat/emission shading, render every run/jump/idle/hit frame at low res (e.g. 48×32 for eras 1–2, 96×64 for eras 3–4). `tools/build-sprites.mjs` then quantizes the frames into **indexed sheets** per palette, with optional Bayer dither. This keeps the 2D and 3D cats the same character with the same run phase, which the Pop-out transition needs. A hand-authored ASCII 1-bit cat ships first as a placeholder and fallback.
8. **Obstacles**: modeled procedurally in bpy (cucumber, robot vacuum, flower pot, crow) to keep licences clean and files tiny. Rendered to sprites the same way.
9. **Credits**: `CREDITS.md` plus an on-screen credits line covering the model, SoundFont and meows (CC-BY requires attribution).

## 10. Project layout

`npm create vite` refuses or prompts on a non-empty directory and could overwrite `README.md`, so the vanilla template files are created by hand instead.

```
index.html              critical inline CSS, CSS/SVG wheel, HUD, fork link, version slot
vite.config.js          define __APP_VERSION__, three in its own chunk, es2022 target
wrangler.jsonc          assets-only Worker, preview_urls:false
public/_headers         immutable caching for /assets/*, no-cache for HTML
src/
  main.js               boot, screen state machine, loader orchestration
  config.js             tunables: difficulty presets, speeds, era bars, palettes, budgets
  input.js  loop.js  loader.js  eras.js  quality.js
  sim/                  world.js cat.js obstacles.js lives.js rng.js (renderer-agnostic, emits events)
  ui/                   hud.js screens.js
  render2d/             pixelRenderer.js palettes.js dither.js sprites.js transitions2d.js
  render3d/  (lazy)     renderer.js wheel.js world3d.js catModel.js post.js transitions3d.js
  audio/                engine.js sequencer.js song.js mixer.js crusher.worklet.js
                        voices/{beeper,chip,fm,sampler}.js sfx.js spatial.js reverb.js
  assets/               sprites/*.png models/cat.glb env/studio.jpg audio/{bank,meow}.*
tools/
  blender/*.py          import/cleanup/export/sprite-render scripts
  build-sprites.mjs     palette quantization → indexed sheets
  build-samples.mjs     SoundFont subset → encoded samples + zone/loop JSON
  check-budget.mjs      critical-path size gate
tests/                  vitest: sim, spawn fairness bot, reachability Monte-Carlo, sequencer timing
CREDITS.md
```

**Dependencies**: `three`. Dev: `vite`, `wrangler`, `vitest`, `@gltf-transform/cli`, `sharp` (sprites), `soundfont2` (sample extraction). Plain JS (matches the README's `--template vanilla`).

## 11. Version tag and Cloudflare deploy prep

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

## 12. Milestones (implementation order)

| M | Deliverable | Done when |
|---|---|---|
| M0 | Scaffold: Vite, `index.html` shell with CSS wheel, fork link, version tag, `_headers`, wrangler config, budget script | `vite build` passes the budget; `wrangler deploy --dry-run` OK; `v.8b72`-style tag shows |
| M1 | Playable era 1 in Canvas 2D with the placeholder ASCII cat; sim, input, HUD, **lives + restart from the beginning**, pause/game over, responsive fit; **beeper audio** (theme + SFX), mute | Playwright: interactive ≤ 1 s average, ≤ 3 s conservative; vitest fairness bot green; **reachability Monte-Carlo wired up** |
| M2 | Blender pipeline (cat import/clean/LOD/export, sprite renders, obstacles) + `build-sprites` + `build-samples` (SoundFont subset, meows) | `cat.glb` ≤ 1.5 MB with run/jump/idle/hit; sprite sheets for 4 palettes reviewed; sample bank ≤ 1.5 MB with licences recorded |
| M3 | Eras 2–4: graphics + **chip / FM / 16-bit audio**, transitions 1–3 on the bar grid, era gating | `?era=2..4` look and sound right; transitions hold frame rate at 4× CPU throttle; reachability targets met for eras 1–4 |
| M4 | 3D SUPER wheel, tiers + benchmark, progressive upgrade, **audio-visual Crunch** (start and restart) | 3D wheel ≤ 2.5 s average; stable 60 fps on an iGPU at Medium |
| M5 | 3D eras 5–7, cat animation synced to sim, **CD / modern / HDR audio**, foley, spatial audio, Pop-out / Focus pull / Sunrise, `compileAsync` precompile, HDR spike | No shader-compile hitch or audio dropout at era change; HDR on a capable display, clean SDR fallback |
| M6 | Performance pass: dynamic resolution, tier tuning (GPU and audio), real phone over LAN (`vite preview --host`), memory check on iOS | Every era holds its tier target on a 5-year-old iGPU laptop and an entry phone with no audio crackle; full reachability targets met |
| M7 | Polish: credits, reduced motion, README, `ai/next_0.md` | Ready for you to deploy |

## 13. Risks and mitigations

- **Shader/pipeline compile hitches** (WebGPU and TSL on WebGL2). Mitigation: `compileAsync` during earlier eras, an off-screen warm-up render, and era gating.
- **TSL on the WebGL2 fallback is heavy on low-end phones.** Mitigation: Low tier keeps node graphs minimal and uses FSR1 upscaling.
- **HDR tone mapping**: three.js only switches the canvas to extended mode; output > 1.0 needs a custom exposure/soft-clip curve. A spike is in M5. If it looks bad, ship wide-gamut P3 SDR and keep "HDR" only where verified.
- **Audio scheduling starved by main-thread jank**. Mitigation: the 200 ms lookahead; sample decoding and IR rendering kept away from transition moments. If glitches persist, move the sequencer into the AudioWorklet.
- **iOS audio quirks**: the context must be resumed inside a gesture, the silent switch mutes it, and phone calls leave it "interrupted". Mitigation: resume on every tap while not running.
- **Era-7 music may sound weaker than the era-7 visuals** (procedural + SoundFont). Mitigation: good samples, reverb and mixing. Fallback: an era-7 stem pre-rendered offline from the same song, ≤ 1 MB.
- **Sketchfab model**: it may be a re-upload, lack a jump clip, or have heavy textures. Mitigation: check the original upload, use the Somali backup, author clips, compress textures.
- **Licences** for the model, SoundFont and meow recordings: verify each one and credit it on screen and in `CREDITS.md`.
- **Auto-rendered pixel art can look mushy.** Mitigation: the silhouette for 1-bit is easy; palette eras get hand touch-ups or overrides in `build-sprites`.
- **Bundle creep**: the budget script fails the build.
- **iOS memory and thermal throttling**: 1K textures on mobile, dynamic resolution, and tier step-down.

## 14. Open questions (defaults in bold; I'll proceed with these unless told otherwise)

1. **Lives**: **9 lives** vs. 3 lives for more tension. The reachability test will show how much each costs.
2. **Difficulty selector**: **URL-only for now** (`?difficulty=classic`) vs. a small Classic toggle on the title screen.
3. **Pacing**: **3D at ~1:20 and HDR at ~2:08** of run time.
4. **Music mood**: **upbeat, playful, 120 BPM** vs. chill lo-fi.
5. **Cat**: **realistic black cat (Evil_Katz)**, subject to its clips checking out, vs. the stylized Somali or the tuxedo cat.
6. **4-color palette**: **CGA cyan/magenta** vs. Game Boy greens.
7. **Fork link target**: **https://github.com/doublependu/wheel** (assumes the repo will be public).
