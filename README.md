# wheel
single button jump game to avoid obstacles

A black cat runs through the history of computer graphics *and* game audio. It starts on a photoreal three.js "SUPER wheel of death", gets crunched down to 1-bit pixels and beeps, then earns its way back up:

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

### URL parameters

| Parameter | Effect |
|---|---|
| `?era=N` | Start at stage N (1–7) |
| `?seed=N` | Fixed obstacle layout |
| `?tier=low\|medium\|high\|ultra` | Force a graphics quality tier |
| `?webgl=1` | Force the WebGL2 backend instead of WebGPU |
| `?hdr=0` | Disable HDR output |
| `?autopilot` | Jump automatically (watch every stage hands-free) |
| `?timescale=N` | Dev server only: run the game N× faster |

## How it loads fast

- `index.html` (≈3 KB gzipped) paints a CSS wheel immediately.
- The game core (≈12 KB) is playable well under a second; the 1-bit stage is Canvas 2D.
- Audio (≈6 KB core) loads in parallel; stage 4–7 instruments are synthesized in a Web Worker.
- three.js and the 3D world load in the background, upgrading the wheel in place, and each 3D stage's shaders are compiled off-screen before it can start. A stage only arrives once it is ready; until then the music just keeps chilling.

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
