# Next 1 — implementation summary and what to do next

Implements `ai/plan_1.md` (revision 2: defaults, with cute low-poly obstacles). Not committed.

## What was built

| Area | Where | Notes |
|---|---|---|
| Obstacle models | `public/models/obstacles.{glb,json}` (83 KB), `tools/blender/{import,export}_obstacles.py` | Cute low-poly CC-BY models from Sketchfab via Blender MCP: a cucumber (Johan Hoof), "Kaktiss" cactus pot (LanaGre), a low-poly Roomba (Seats; recoloured coral, made taller, googly eyes added), a blocky crow (DracTheZach; wings on hinge empties, flapped in code). They fit the existing hitboxes, so no gameplay tuning changed. |
| Pixel-art obstacles | `tools/blender/render_obstacle_sprites.py`, `tools/build-obstacle-sprites.mjs`, `tools/obstacle-look.mjs` → `src/assets/obstacles.{png,json}` (3 KB), `src/render2d/obstacleAtlas.js` | Blender renders side views at 384 px/unit (crow: 4 flap frames). Node area-downsamples to each stage's density and maps colours: 1-bit silhouette with white eyes and glints, CGA and 3-bit by colour-family ramps (no sky blue), 256 colours with Bayer dither. Outlines are chosen for contrast. The atlas is inlined into the core; the procedural sprites remain as a fallback. |
| Contrast fixes | `src/render3d/world3d.js`, `props3d.js`, `tools/obstacle-look.mjs` | 2D: white outlines in CGA (like the cat), a warm sunset rim-outline at 256 colours. 3D: a pale wide lane, the fence moved back, contact shadows, a height-aware fresnel rim (via `outputNode`, so the PS1 retro pass keeps it), and an **adaptive ink outline**: a layer-only mask pass marks obstacle silhouettes, and edge pixels take a dark or light ink opposite to the background just outside. The ink runs after TRAA, DoF and motion blur where those are on. The cat gets a softer rim, moonlit in stage 5. |
| Contrast tool | `src/dev/contrast.js` (`?contrast`, dev only), `tools/contrast.mjs` | Edge ΔL (OKLab) between the obstacle silhouette and the background just outside, per stage × obstacle × scroll offset. 3D cases scroll like gameplay and use an off-screen mask. Pass = ≥ 85 % of edge samples at ΔL ≥ 0.2. |
| SUPER donut | `src/render3d/wheel.js`, `index.html` | Lacquered rainbow torus (one mesh; segment colours and engraved grooves in TSL), 48/64/96 anodized-aluminium bars on damped springs (a progress ring, then a travelling wave), a procedural softbox studio PMREM, a key spot with shadows, a satin floor with a blurred reflection and contact shadow. AO and DoF on High and above, TRAA, light film grain, output dither. **No bloom, no sparkles.** The CSS donut at first paint matches it (conic ring + 48 animated bars). |
| Play flow | `src/main.js`, `src/config.js` (`WHEEL`) | Play (▶ in the donut's hole) shows after ≥ 2.5 s, once the obstacle atlas is in and the 3D donut has been on screen ≥ 1 s; never later than 3 s. The donut keeps running until Play is pressed. A tier change after the benchmark no longer rebuilds the donut on screen. |
| WebGPU robustness | `src/render3d/graphics3d.js`, `src/main.js` | A SwiftShader or fallback WebGPU adapter is skipped in favour of WebGL2. A lost WebGPU device rebuilds the 3D view on WebGL2 (on a fresh canvas). Fixed GTAO normal sampling and the motion-blur input: **stage 7 on High/Ultra used to fail to compile**. `?fx=nodof,nomb,notraa,noao,nogodrays` toggles single effects. |
| Recording | `tools/record/{record.mjs,harness.html}` (`npm run record`), `?autopilot=human`, `?crash=7:40` | Headed full-screen Chrome; the harness tab-captures itself (video + game audio in sync) while the game runs in a 16:9 iframe; MediaRecorder H.264; ffmpeg crops, scales to 1920×1080 at 60 fps CFR, x264 CRF 16, AAC, loudness −14 LUFS. Also writes a contact sheet and a JSON report with per-stage frame times. Autopilot runs don't pause on window blur. |

## The video

`recordings/wheel-v.d8d5-2026-10-06-19-13.mp4` (227 MB, git-ignored), plus `.sheet.png` and `.json` beside it. It runs 3:02 at 1920×1080, 60 fps, H.264 + AAC. It opens on the donut loading (CSS donut cross-fading into 3D); Play shows 2.5 s after the page starts loading and is pressed 3 s later. Then stages 1–7 (stage 7 at about 2:17), a deliberate crash 40 s into stage 7, and game over at about 2:58. Ultra tier, WebGPU on the RTX 3050.

- Frame times while recording (render, vsync off): p95 ≤ 11.1 ms in every stage, ≤ 0.8 % of frames over 20 ms.
- Audio: −14.4 LUFS integrated, −1.5 dBFS peak.

## Measured

- **Load** (production build, CDP throttling, cold cache):

  | Profile | First paint | 3D donut | Play |
  |---|---|---|---|
  | 50 Mbps / 40 ms | 0.14 s | 0.68 s | 2.52 s |
  | 10 Mbps / 100 ms / 4× CPU | 0.20 s | 1.45 s | 2.50 s |

  Critical path (gzip): HTML 3.6 KB, core 17.4 KB (the atlas is inlined), audio core 5.8 KB.
- **Contrast**: all 28 stage × obstacle cases pass on every tier (low, medium, high, ultra) on the RTX 3050 with WebGPU. Before the fixes, with the new obstacles: the 3D cucumber measured 3–11 % (stages 5–7), stage 2's crow 85 % with its worst offset at 75 %, and stage 4's cucumber and crow 83 %.
- **Intel iGPU** (Raptor Lake UHD, WebGL2, no discrete GPU, auto tier): every stage holds this window's vsync cadence. With vsync off, stages 6–7 render at ≈ 110 fps on average at 1920×1052 (the benchmark picked High).
- `npm test`: 16/16. `npm run build`: budget passes.

## Deviations from the plan

- **Vacuum**: "Low-poly Roomba" by Seats instead of the first pick, which turned out to be fan art of *A Hat in Time*'s Roomba (someone else's character). It was plain, so it got googly eyes and a coral shell (credited as changes).
- **Crow**: DracTheZach's blocky crow (wings already spread). Its own fly clip is broken, so the wings flap in code, as before.
- **3D readability needed more than a rim**: the plan's rim plus haze couldn't satisfy both a pale lane and dark grass. The adaptive ink outline is new, as are the contact shadows and the pale lane.
- **Contrast metric**: bottom edges are skipped (that's where an obstacle meets the ground). Inside the edge it takes the best of 3 px, so an outline counts. 3D cases scroll for 17 frames and then hold still for 3.
- **Recording**: headless Chrome can't do it here (no audio output; WebGPU at about 1.4 s per frame). Headed tab capture is in the window's device pixels, so the game area is 1870×1053 and gets a 2.7 % upscale to 1080p. MediaRecorder uses H.264 because VP9 stuttered. Vsync is off so captured frames are always fresh.
- **Hybrid-GPU laptop quirks** (this machine): Chrome's default WebGPU adapter was SwiftShader. With Vulkan on, WebGPU on the RTX loses its device (`VK_ERROR_OUT_OF_DEVICE_MEMORY` at 58 MB: cross-GPU frame sharing), and HEAD had the same problem. The game now falls back to WebGL2. The recorder runs Chrome entirely on the RTX (PRIME offload) with 2D canvases in software, because GPU 2D canvases come out black in that mode.

## Not verified here

- **Phones**: Safari/iOS and Android Chrome, both performance and the new donut.
- **Windows and other GPUs**: the device-loss fallback is only exercised on this Linux laptop.
- **HDR output**: still untested on an HDR display.
- **Listening pass**: the recording was checked by levels and silence detection only.

## Next

1. **Dynamic resolution vs. refresh rate**: on this machine the vsync cadence is ~53 Hz (18.7 ms), and dynamic resolution (drop at > 19 ms average) lowered stages 6–7 to 80 % though the GPU had headroom. Base its target on the measured display interval (e.g. the 2D stages' median frame time) instead of a fixed 19 ms.
2. **Upload the video**: `recordings/wheel-v.d8d5-…mp4` is ready for YouTube. Re-record after committing so the version tag in the corner matches the commit (`npm run record`).
3. **Commit, then deploy**: `npx wrangler login && npm run deploy`. `playwright-core` is a new dev dependency (recorder and contrast tool only).
4. **Stage 7 look**: it reads soft and hazy (warm fog + DoF). Readability passes, but a little less fog would make the sunrise crisper.
5. **WebGPU on hybrid laptops**: today that's "fail, then fall back". A better path may be to request the low-power adapter when the high-performance one is lost, keeping WebGPU on the iGPU (it worked here at 182 MB).
6. **Phone playtest** of the 2.5 s title wait and the donut (`npm run dev` serves on the LAN).
