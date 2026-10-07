# wheel
single button jump game to avoid obstacles

A black cat runs through the history of computer graphics *and* game audio. It starts on a loading wheel that is a little solar system: planets form, crumble and orbit a star over a black mirror, and the game makes you wait for it. Past it, the menu's photoreal "SUPER donut" gets crunched down to 1-bit pixels and beeps, then the cat earns its way back up:

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
| `npm run loadtime` | Build, then measure first paint, when the fancy loading wheel plays ("page loading done") and when the menu is ready, on two throttled connections with a cold cache; fails past 4 s (`--gpu nvidia`, `--runs N`, `--steps`) |
| `npm run sprites` | Rebuild the obstacle pixel-art atlas from the Blender renders (`tools/build-obstacle-sprites.mjs`) |
| `node tools/contrast.mjs --tier high` | With `npm run dev` running: obstacle/background contrast table for every stage, on this machine's GPU |

### URL parameters

| Parameter | Effect |
|---|---|
| `?era=N` | Start at stage N (1–7), skipping the loaders |
| `?loader=skip` | Go straight to the menu |
| `?loader=lite` | Use the CSS version of the fancy loading wheel |
| `?loader=quiet:N` | Dev server only: N seconds of wheel before clicks can get through (default 5) |
| `?seed=N` | Fixed obstacle layout |
| `?tier=low\|medium\|high\|ultra` | Force a graphics quality tier |
| `?webgl=1` | Force the WebGL2 backend instead of WebGPU |
| `?hdr=0` | Disable HDR output |
| `?autopilot` | Jump automatically (watch every stage hands-free); `?autopilot=human` varies the timing like a player |
| `?crash=7:40` | With autopilot: stop jumping 40 s after stage 7 arrives (or `?crash=90`: after 90 s), so a run ends on game over |
| `?fx=nodof,nomb,notraa,noao,nogodrays` | Switch single 3D effects off, on any tier |
| `?contrast` | Dev server only: measure obstacle/background contrast in every stage (results in `window.__contrast`) |
| `?timescale=N` | Dev server only: run the game N× faster |

## Loading, on purpose

The loading wheel builds two [loading-ui](https://www.loading-ui.com) spinners, [Spiral](https://www.loading-ui.com/docs/components/spiral) and [Twin Orbit](https://www.loading-ui.com/docs/components/twin-orbit), as a solar system where the physics is a bit different:

- **Spiral** is a ring of 8 dots that grow and shrink in a wave. Here each dot is a planet's life: it condenses out of hot dust, matures and crumbles, and its dust (a GPU compute simulation) flies on clockwise to the planets forming ahead of it. The planets don't orbit; their matter does.
- **Twin Orbit** is two dots circling a centre dot with CSS `ease` timing. Here a star and two twins (ice with transmission and dispersion, liquid mercury) whose orbit plane leans back and precesses. The star is the only light; tides are exaggerated, so the star bulges toward the twins and they stretch toward each other.
- Every surface morphs (noise displacement in the vertex shader, normals from the per-pixel height). Eight planet looks share one material: lava, ocean, gas giant (sheen), crystal, pearl (iridescence), chrome, velvet and rock.

The page loads in three stages:

1. **Pre-load**: a flat CSS copy of Spiral paints immediately, while only the fancy wheel loads behind it (three.js, then building it, compiling its shaders and warming it up on a hidden canvas).
2. **The fancy wheel** takes over in the same place and phase. This counts as the page having loaded (`loader:fancy`; spec: 2–3 s, 4 s at most), so it starts by 3.5 s at the latest, as a CSS version if 3D isn't ready yet. For 5 s the screen shows nothing but the wheel and its reflection, and nothing responds, while the menu, audio and sprites load behind it.
3. After that, a click, tap or Space **may** get through: 35 % at first, more with every miss and every second, and the 3rd try always works. A miss makes the wheel stall as if the page were busy. A hit pulls everything into the star, and the menu's donut springs out of the hub.

Tunables: `LOADER` and `ORBIT` in `src/config.js`. Motion: `src/loader/orbitPhysics.js`; the odds: `src/loader/gate.js` (both tested in `tests/loader.test.js`).

## How it loads fast

- `index.html` (≈5 KB gzipped) paints the CSS pre-loader immediately; its dots run on the compositor (Web Animations), so they keep moving while scripts load.
- The 3D chunk (three.js and the wheel, ≈285 KB) loads first; audio and the 2D stages wait until the fancy wheel plays.
- The wheel's shaders are kept small (one noise evaluation per shader stage, compact noise functions), because on a first visit (a cold shader cache) compile time decides when the wheel can play. The menu's donut compiles in the background while the wheel plays; its last blocking warm-up happens at the click, when the page may look busy anyway.
- The game core (≈18 KB, with the obstacle sprite atlas inlined) runs the 1-bit stage on Canvas 2D; the 3D world loads behind the menu, and each 3D stage's shaders are compiled off-screen before it can start.
- WebGPU is used when the GPU offers it; a software (SwiftShader) adapter or a lost device falls back to WebGL2. A stage only arrives once it is ready; until then the music just keeps chilling.

## Recording a video

```bash
npm run record                       # ultra tier, seed 7, crash 40 s into stage 7
npm run record -- --seed 3 --tier high --crash 7:20
```

A full-screen Chrome window plays the whole game (loaders → a few clicks until the menu → Play → stages 1–7 → game over, about 3¾ min) while Chrome's tab capture records picture and game audio together. ffmpeg then crops the game area, scales it to 1920×1080 at a constant 60 fps, and normalises the audio to −14 LUFS. Next to the MP4 you get a contact sheet with one still per stage and a JSON report with frame times per stage.

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
