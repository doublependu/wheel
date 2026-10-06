# wheel
single button jump game to avoid obstacles

A black cat runs through the history of computer graphics *and* game audio. It starts on a photoreal three.js "SUPER donut" loading wheel, gets crunched down to 1-bit pixels and beeps, then earns its way back up:

| Stage | Graphics | Sound |
|---|---|---|
| 1 | 1-bit (Chrome Dino homage) | 1-voice beeper |
| 2 | 4-colour CGA | 4-channel handheld chip |
| 3 | 8-colour 3-bit RGB, parallax | FM synth |
| 4 | 256 colours, dithered sunset | 16-bit samples + echo |
| 5 | PS1-style 3D (vertex snap, 15-bit colour) | CD-era lo-fi, tape + vinyl |
| 6 | Smooth PBR 3D, shadows | modern mix, stereo, paw-step foley |
| 7 | HDR sunrise (bloom, AO, DoF, godrays, motion blur) | "HDR audio": hall reverb, HRTF, loudness ducking |

Each stage is 8 bars of 90 BPM music (about 21 s): 6 bars of chill lo-fi, then a 2-bar upbeat build-up that drops into the next stage. One hit and you start again. The speed is tuned so most players reach the 3D stages (see `tests/sim.test.js`).

The obstacles (cucumber, potted cactus, robot vacuum, crow) are cute low-poly models from Sketchfab. The 3D stages use the models; the pixel stages use sprites rendered from them in Blender and converted to each stage's palette. Every obstacle is checked for contrast against its background in every stage (`?contrast`).

## Setup and run

```bash
npm install
npm run dev
```

## Initial setup

```bash
npm create vite@latest . -- --template vanilla
claude --dangerously-skip-permissions
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server (also on your LAN for phone testing) |
| `npm test` | Simulation tests: jump timing window, stage clock, spawn breathers, fairness and reachability bots, song data |
| `npm run build` | Production build + critical-path size budget check |
| `npm run preview` | Serve the production build locally |
| `npm run deploy` | Build and deploy to Cloudflare (warns if the working tree is dirty) |
| `npm run record` | Play the whole game hands-free and record it (video + game audio) to `recordings/` as a 1080p60 MP4; see below |
| `npm run sprites` | Rebuild the obstacle pixel-art atlas from the Blender renders (`tools/build-obstacle-sprites.mjs`) |
| `node tools/contrast.mjs --tier high` | With `npm run dev` running: obstacle/background contrast table for every stage, on this machine's GPU |

### URL parameters

| Parameter | Effect |
|---|---|
| `?era=N` | Start at stage N (1–7) |
| `?seed=N` | Fixed obstacle layout |
| `?tier=low\|medium\|high\|ultra` | Force a graphics quality tier |
| `?webgl=1` | Force the WebGL2 backend instead of WebGPU |
| `?hdr=0` | Disable HDR output |
| `?autopilot` | Jump automatically (watch every stage hands-free); `?autopilot=human` varies the timing like a player |
| `?crash=7:40` | With autopilot: stop jumping 40 s after stage 7 arrives (or `?crash=90`: after 90 s), so a run ends on game over |
| `?fx=nodof,nomb,notraa,noao,nogodrays` | Switch single 3D effects off, on any tier |
| `?contrast` | Dev server only: measure obstacle/background contrast in every stage (results in `window.__contrast`) |
| `?timescale=N` | Dev server only: run the game N× faster |

## How it loads fast

- `index.html` (≈4 KB gzipped) paints a CSS donut immediately; its bars fill like a progress ring.
- The game core (≈17 KB, with the obstacle sprite atlas inlined) loads in parallel; the 1-bit stage is Canvas 2D.
- The donut runs for 2.5 s before Play shows in its hole (never later than 3 s; `WHEEL` in `src/config.js`), then keeps dancing until you press it.
- Audio (≈6 KB core) loads in parallel; stage 4–7 instruments are synthesized in a Web Worker.
- three.js and the 3D world load in the background, upgrading the donut in place, and each 3D stage's shaders are compiled off-screen before it can start.
- WebGPU is used when the GPU offers it; a software (SwiftShader) adapter or a lost device falls back to WebGL2. A stage only arrives once it is ready; until then the music just keeps chilling.

## Recording a video

```bash
npm run record                       # ultra tier, seed 7, crash 40 s into stage 7
npm run record -- --seed 3 --tier high --crash 7:20
```

A full-screen Chrome window plays the whole game (title donut → Play → stages 1–7 → game over, about 3½ min) while Chrome's tab capture records picture and game audio together. ffmpeg then crops the game area, scales it to 1920×1080 at a constant 60 fps, and normalises the audio to −14 LUFS. Next to the MP4 you get a contact sheet with one still per stage and a JSON report with frame times per stage.

On hybrid-GPU Linux laptops the default `--gpu nvidia` runs all of Chrome on the discrete GPU (otherwise its WebGPU device gets lost) with 2D canvases in software; `--gpu default` leaves the choice to Chrome.

## Deploy

```bash
npx wrangler login
npm run deploy
```

The site is a static, assets-only Cloudflare Worker (`wrangler.jsonc`, `preview_urls: false`). The version in the bottom-right corner is `v.` plus the first four characters of the deployed commit (`WORKERS_CI_COMMIT_SHA` on Workers Builds, otherwise `git rev-parse HEAD`).

## Backed by

Man & Bot

Browse web games at [Maize.Live](https://maize.live)
, or watch on YouTube [@RadWebGame](https://www.youtube.com/@RadWebGame)
