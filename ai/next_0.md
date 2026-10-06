# Next 0 — implementation summary and what to do next

Implements `ai/plan_0.md` (revision 3). Not committed.

## What was built

| Area | Where | Notes |
|---|---|---|
| Simulation | `src/sim/world.js`, `src/eras.js`, `src/config.js` | Fixed 120 Hz step, one hit = game over, restart from stage 1. Stages are 8 bars at 90 BPM (6 chill + 2 build). A build-up is only promised once the next stage is ready; otherwise 2 more chill bars play. No obstacles from 1 s before to 2 s after each drop. |
| Difficulty | `config.js` | `v0` 5.5 u/s, ramp to ≈1.12× by 2:08, cap 1.3×. Tap jump peak 2.8 u with ≥ 400 ms timing window at every speed; hold for a higher jump. 75 % hitboxes, 150 ms jump buffer. |
| Tests | `tests/sim.test.js`, `tests/bot.js` | Jump window per obstacle and speed, stage clock, spawn breathers, perfect bot never dies, 1,000-run reachability. **Average bot (σ 70 ms): 97.9 % reach 3D, 94.7 % reach HDR. First-timer (σ 110 ms): 81.7 % reach 3D.** Song-data test. |
| Stages 1–4 (2D) | `src/render2d/*` | Procedural pixel art (cat + obstacles drawn as vectors at each stage's pixel density, snapped to the palette). 1-bit, CGA, 3-bit RGB, 256 colours (6×7×6 cube + greys, Bayer dither). Parallax backgrounds. Transitions: raster wipe, paint bloom, Mode-7 swoop. Build-up preview flickers next-stage pixels. |
| SUPER wheel | `src/render3d/wheel.js` | WebGPURenderer (WebGL2 fallback), clearcoat segments, dispersive transmission dome (High+), iridescent ring, anisotropic hub, planar `reflector()` floor, GPU-compute sparkles (WebGPU), TRAA / motion blur / bloom / film. Benchmarks the first frames to pick the quality tier. "Crunch" pixelates it to 1-bit on start. |
| Stages 5–7 (3D) | `src/render3d/world3d.js`, `props3d.js`, `cat3d.js`, `gltfCat.js` | 5: RetroPassNode (vertex snap, ~640 px internal) + 15-bit dither, night. 6: smooth PBR, shadows, dawn. 7: sunrise with the wheel as the sun, GTAO, godrays, DoF, motion blur, bloom, HDR output. Pop-out (pixels → voxels → 3D, frozen frame flips away in tiles), focus pull (retro resolution ramps to native and cross-fades), sunrise (exposure / sky / camera). Shaders warmed off-screen before a stage can start. Dynamic resolution in play. |
| Cat model | `public/models/cat.glb` (194 KB) + `cat.json`, `tools/blender/*` | "Somali Cat Animated ver 1.2" by DreamNoms (CC BY 4.0), tinted black. **I authored the Run gallop and Jump in Blender** (the model only had idle/walk/sit). Used in stages 6–7; stages 1–5 use the procedural cat that shares one pose function with the pixel cat. |
| Audio | `src/audio/*` | One original theme. Stage voices: beeper (SFX steal the voice), 4-channel chip, 2-op FM, then synthesized "samples" (Rhodes, pluck, bass, kit, strings, choir, timpani, meow) rendered in a **Web Worker**. AudioWorklet does 1-bit/4-bit crush, 32 kHz hold, wow/flutter and the tape-stop on hit. Echo (stage 4), vinyl crackle + room reverb (5), sidechain pump + ambience + paw-step foley + stereo whooshes (6), hall reverb + HRTF whooshes + loudness ducking (7). Chill → build-up → drop per stage. |
| Shell | `index.html`, `src/ui/hud.js`, `src/main.js` | CSS wheel at first paint, fork-me ribbon (title/pause/game over), `v.xxxx` bottom-right, credits, pause (Esc/P/button/blur), mute (M/button), safe areas, portrait fit. |
| Deploy prep | `wrangler.jsonc`, `public/_headers`, `tools/*.mjs` | Assets-only Worker, `preview_urls: false`, immutable `/assets/*`. `npm run build` enforces the size budget; `npm run deploy` warns on a dirty tree. `wrangler deploy --dry-run` passes. |

## Measured

- **Load** (production build, local server, CDP throttling):

  | Profile | Interactive | 3D wheel |
  |---|---|---|
  | 50 Mbps / 40 ms | 0.15 s | 0.74 s |
  | 10 Mbps / 100 ms / 4× CPU | 0.27 s | 1.88 s |

- **Critical path (gzip)**: HTML 2.9 KB, core 12.4 KB, audio core 5.8 KB. three.js chunk ≈275 KB, world ≈37 KB, cat 194 KB, all lazy.
- **2D stages**: steady 60 fps at 4× CPU throttle.
- **Full runs**: hands-free runs reach every stage on schedule (0, 21, 43, 64, 85, 107, 128 s) with no console errors.
- **Audio**: every stage and section is audible, with no NaNs and peaks under 0.9; build-ups are louder than chills.

## Deviations from the plan

- **Cat model**: the planned "An Animated Cat" (Evil_Katz) is a rip of the *Murdered: Soul Suspect* game cat (its description says it isn't the uploader's), so I didn't use it. I used the backup Somali cat and authored the run and jump clips myself.
- **Pixel sprites**: drawn procedurally from a shared pose function rather than rendered from the 3D rig. The 2D and 3D procedural cats match frame for frame, which the pop-out needs.
- **No SoundFont download**: every instrument and the meow are synthesized, sampled in a worker. No licence questions, zero audio downloads.
- **No UltraHDR HDRI**: the wheel uses the procedural RoomEnvironment plus a planar reflector instead.
- **No SSR**: not used anywhere. GPU timestamp queries aren't used either; the benchmark uses frame times only.
- **Crows fly low only**: a jump always clears them. High "run-under" crows would punish jumping, which conflicts with "easy to stay alive".
- **Reachability bot**: "1 % missed presses" became "1 % presses with 3× the timing error". With one life, a true 1 % miss rate caps survival to HDR at ~57 % whatever the speed.

## Not verified here (needs real hardware)

- **WebGPU path**: the test browser had no GPU adapter, so everything 3D was checked on the WebGL2 fallback (software). Check on a real GPU and on Safari/iOS 26.
- **HDR output**: `outputType: HalfFloatType` + highlight boost in stage 7 is untested on an HDR display.
- **Real-device frame rates**: tiers, dynamic resolution and thermal behaviour on a 5-year-old iGPU laptop and an entry-level phone (`npm run dev` serves on the LAN).
- **Listening pass**: the audio was checked by levels only; nobody has listened to it yet.

## Next

1. **Playtest on a phone and an iGPU laptop.** Tune `SPEED.v0` (in `config.js`) if it feels too slow. Re-run `npm test`, because the reachability test guards the targets.
2. **Listening pass**: per-stage mix levels (`ERA_MIX` in `hifi.js`, voice volumes in `retro.js`), lo-fi swing amount, and the meow.
3. **Visual polish**:
   - stage 6 reads more like full morning than dawn;
   - the stage-5 cat is very dark at night;
   - a grass-blade field and clouds in stage 7 (High/Ultra) would sell "next-gen" more.
4. **Cat**:
   - consider a low-poly LOD of the Somali for stage 5;
   - a stumble/hit clip;
   - keyframe tweaks in `tools/blender/author_cat_anims.py`.
5. **Deploy**: commit, then `npx wrangler login && npm run deploy`. The version tag will show `v.` + the commit's first 4 characters.
