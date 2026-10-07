# Plan 3: a slower ring of planets on a changing connection, where each planet's wreckage builds the next

Answers `ai/prompt_3.md`.

**Revision 2** (follow-up in chat), answering decision 1:
- one whole planet at a time stays;
- while it is whole, traces of dust flow into it from the previous station and out of it to the next;
- the previous and the next planet show as faint shades of dust. (§3.2, §4.3)

## 0. Summary

| Prompt item | Plan |
|---|---|
| Slow the animation down | Today a planet's whole life takes 1.5 s and about five planets overlap, so the wave laps the ring in 1.5 s. New: **one whole planet at a time, 2.0 s each** at normal speed (`ORBIT.hop`), so a lap of the 8 stations takes about 16 s. (§5) |
| Vary the speed as if the internet speed were changing | The wheel gets its own clock, which runs between about **0.1× and 2.3×** real time: steady stretches, slowdowns, short near-stalls and catch-up bursts, like a download. It's seeded, differs on each visit and averages 1×. Everything on the wheel follows that clock. (§5) |
| Remove the 3 things in the middle | The star and both twins go, with their light, shadows, corona and tides. The hub stays empty. The planets are lit by the studio environment, a key light and their own explosions. (§2) |
| A planet explodes, breaks into pieces, then dust; the material moves on and forms the next planet | Each planet is built from 12–36 solid wedge-shaped pieces that fit together into the sphere. Its seams open and glow, it bursts, and the pieces fly, tumble and grind down into dust. The dust streams clockwise to the next station and accretes there into the next planet, which has a different look. Every mote is accounted for at every moment, and the new planet grows exactly as fast as the bulk of the dust lands. (§3.1, §4) |
| Over the whole ring, then repeat | The new planet rests briefly, then bursts in turn. Eight hops take the matter once round the ring through all eight looks, then it starts over. (§3) |
| Follow-up: traces and faint neighbours | While a planet is whole, a thin trace of dust still flows into it from the previous station, and another already flows on to the next. The previous planet shows as a faint shade of dust that thins out; the next one as a faint shade that thickens. So three stations and the two gaps between them are alive at once. (§3.2, §4.3) |

Two words used below: a **station** is one of the ring's 8 fixed positions (as in the code today); a **hop** is the matter's trip from one station to the next.

## 1. Facts checked while planning

| Item | Finding |
|---|---|
| Today's ring | `stationLife()`: 0.75 s forming, 0.75 s breaking up, each station 0.19 s behind the previous one. The break-up is cracks plus a dithered dissolve, with no pieces. The dust flies **1 to 4 stations** ahead (`dustPlan`), not to the next one. |
| What the star does today | It is the scene's main light: a point light at the hub, with cube shadows on High and Ultra. The mirror-like looks (chrome, pearl, crystal) reflect it. Without it only a dim studio environment (0.7) and a rim light remain, so the lighting has to be redone. |
| Room for debris | Stations are 0.70 apart (ring radius 0.92) and a planet's radius is 0.27, so neighbours are 0.16 apart. The lowest planet clears the mirror floor by 0.13. The hub is free once the star and twins are gone. So debris has to fly forward and inward, not outward. |
| Surface spin | Planets "spin" by rotating the noise, not the mesh (`spinY` in `bodies.js`). On a flying piece the surface would slide across it, so spin and morph must freeze when a planet bursts. |
| Mote size | Motes are 0.006–0.018 world units across. On a 390 px wide phone that is about 0.5–1.4 CSS px, and Low renders at 0.7× resolution. A cloud of 50 such motes can't carry a visible "shade" by itself. (§4.3) |
| three r186.1 | Has `attribute()` for custom per-vertex data, which the pieces need. Everything else the plan uses is already in `orbit.js` and `bodies.js`: GPU compute, per-object uniforms, the reflector, mask-based dissolve. |
| Shader cost | From next_2, cold compile on Intel/Mesa: star 173 ms, ice 147, mercury 139, ring 201. Three of the four body shaders go away, and so do the shadow and transmission passes on High. |
| Load today | `loader:fancy` at 0.81 / 2.70 s (WebGL2, Medium) and 1.15 / 3.25 s (WebGPU, High) on the fast / slow profile. |
| Hand-off from the pre-loader | Flat dot *i* and planet *i* share position and phase today. The new wheel has one whole planet at a time, so that one-to-one match is gone and the hand-off needs a new idea (§6). |
| CSS fallback (fancy-lite) | Built by `index.html`'s inline script, Twin Orbit included. The miss "hitch" pauses its Web Animations. |
| Tests and budget | 30/30 pass now. 6 of the 14 loader tests pin behaviour this plan changes (the 3D ring's Spiral timing, Twin Orbit, body collisions ×2, tides, the dust plan). HTML 5.0 of 14 KB, core 18.5 of 40 KB. |

## 2. What is on screen

- **Removed**: the star, the ice twin, the mercury twin, the corona, the star's point light and its shadows, and all tides (they had no other source).
- **Kept**: the 8 stations at Spiral's positions (31.25 % of the box, clockwise from 3 o'clock), the eight looks (lava, ocean, gas, crystal, pearl, chrome, velvet, rock), the black screen, the mirror floor and its reflection, the framing, the 8° lean, FXAA, and no bloom.
- **Looks belong to stations**, as today. So the matter changes as it moves on: the lava planet's dust becomes the ocean planet, and so on round the ring.
- **Three stations are alive at a time**: the whole planet, the faint shade of the one before it and the faint shade of the one after it, joined by dust (§3.2). The other five are empty.
- **Light**, now that the star is gone:
  - the studio environment at about 1.0 (the chrome, pearl and crystal looks need something to reflect);
  - one warm key light from the upper left front, and the existing cool rim light;
  - a **blast light**: a point light without shadows at the bursting planet. It pulses with the explosion and lights the forming planet and the mirror.
  - No shadows on any tier. With one solid planet at a time there is nothing for a shadow to fall on.

## 3. One hop

Times are for normal speed (2.0 s per hop). *u* is the share of the hop.

### 3.1 The bulk of the matter (80 %)

| *u* | Seconds | What happens |
|---|---|---|
| 0.00–0.10 | 0.2 | **Seams open.** The pieces part slightly, and the glowing inside shows through the gaps. |
| 0.10 | | **Burst.** Hot dust from the core sprays out, and the blast light pulses. |
| 0.10–0.48 | 0.76 | **Pieces.** They fly forward along the ring and in toward the hub, tumble, cool from glowing to dark, and grind down from their edges. |
| 0.16–0.70 | 1.08 | **Dust.** It peels off the pieces and streams clockwise along the ring. Its colour shifts from the old planet's to the next one's. |
| 0.34–0.74 | 0.8 | **The next planet forms.** The dust swirls in and lands on a hot, lumpy blob, which grows with it and cools. |
| 0.74–1.00 | 0.52 | **Rest.** The new planet is whole, in its own look. Then its seams open: the next hop. |

- A whole planet is on show for about 0.7 s per hop (rest plus seams).
- Eight hops make a lap. The cycle then repeats exactly, apart from the speed.
- For comparison, today's break-up takes 0.75 s with five planets doing it at once.

### 3.2 Traces and the two faint neighbours (revision 2)

A fifth of the dust doesn't travel with the bulk:

- **Stragglers** (10 %) stay behind at the burst. They hang where the planet was, in its shape. They leave late, as a thin trace, between *u* = 0.70 and 1.00, and the last one lands at 1.08, just before the next burst at 1.10.
- **Leaders** (10 %) run one station ahead of everything else. They hang at the station where the next planet will form, in its shape. When the bulk arrives there it sweeps them on: they leave between 0.35 and 0.90 and gather at the station after that between 0.60 and 1.15.

So while a planet is whole (*u* = 0.74 to 1.10, counted in the hop that formed it), the ring shows:

| Where | What shows |
|---|---|
| Previous station | A faint shade of the old planet, thinning as its stragglers leave |
| The gap behind | A thin trace of dust flowing clockwise into the whole planet |
| Current station | The whole planet, in its own look |
| The gap ahead | A thin trace of dust flowing on |
| Next station | A faint shade of the next planet, thickening as leaders arrive |
| The other five stations | Nothing |

- The previous shade is gone before the current planet bursts.
- The next shade is in place when it does. The bulk then forms the planet inside it, and the shade gives way to the growing blob.
- The timings are set so that at most two shades are drawn at once.

## 4. Pieces, dust and shades: how

### 4.1 Pieces

- **Geometry** (built once in code, shared by all 8 planets, no download):
  - scatter 12–36 seed points on the icosphere and give each triangle to its nearest seed;
  - close each patch with walls down to a point at half the radius, so every piece is a **solid wedge**;
  - at rest the wedges tile the sphere exactly, so the whole planet and its pieces are the same mesh, and nothing pops when it bursts.
  - Cost: roughly 15–20 % more triangles than today's sphere, and a few ms to build (both estimates; M0 measures them).
- **Per-vertex data**: the piece's centre direction, three random numbers and an "inner face" flag.
- **Shading**: outer faces keep the planet's look, since they use the same material and shader as today. Inner faces are flat-shaded magma that cools as the piece flies. The glowing seams are simply the gaps between pieces.
- **Motion**, in the vertex shader, closed-form in *u*:
  - a blast along the piece's own direction, biased forward and inward, with drag;
  - a tumble about a random axis;
  - erosion: the piece shrinks toward its own centre while the existing dithered mask eats its edges.
  - The planet's mesh itself moves a short way along the ring, so the debris cloud drifts toward the next station.
- Spin and surface morph freeze at the burst, so each piece keeps the patch of surface it broke off with.
- Each planet's mesh gets its own fixed rotation, so the eight break in different patterns.

### 4.2 Dust

- Still the GPU compute simulation, with the same counts (512 / 2k / 8k / 24k). All motes now belong to one chain of matter, so the stream is denser than today.
- Three groups, each repeating its routine every hop:

  | Group | Share | Routine |
  |---|---|---|
  | Bulk | 80 % | Rides hidden on its piece (a quarter sit in the core). Released at the burst (core) or as its piece erodes. Flies along the ring, corkscrewing, pulled toward the ring as today. Swirls once round the forming planet, lands and hides. |
  | Stragglers | 10 % | Hang at the old station as part of its shade. Leave late as a thin trace. Land on the whole planet and hide. Reappear when that planet bursts. |
  | Leaders | 10 % | Hang at the next station as part of its shade. Swept on when the bulk arrives, they fly to the station after it. They never land. |

- The schedule (group, piece, release time, flight time) is made on the CPU by `dustPlan()`, as today, so it stays testable.
- **Mass bookkeeping**: the forming planet's radius is the cube root of the share of the bulk that has landed. Every mote is in exactly one place: on a piece, in flight, in a shade or in a planet. The shares always add up to one planet.
- Motes are kept above the mirror floor.

### 4.3 The faint neighbours

A shade is two things drawn together at a station:

- **the hovering motes** (stragglers or leaders), spread through a ball of the planet's size, slowly swirling, tinted with that station's colour;
- **the planet itself as a sparse, shimmering stipple**: the same mesh and material, with the dissolve mask it already has letting through about 10–15 % of its pixels, in a pattern that changes every frame. The planet's shape, shading and look stay recognisable, but faint and grainy.

Notes:

- The stipple is there because motes can't carry the shade on small screens (§1, mote size).
- A shade's strength follows the share of its motes that are hovering there, so it thins and thickens with the traces.
- Cost: two more draws of the planet mesh with most pixels discarded. No new material and no new shader; the mask gets one more per-object value.
- The shades appear in the mirror like everything else.

### 4.4 Physics module

`src/loader/orbitPhysics.js` stays the pure, tested description of the motion:

- **goes**: the twins, the tides, `EASE` (CSS `ease`);
- **stays**: stations, the hitch, the bézier solver, and Spiral's curve (now only for the hand-off, §6);
- **new**: the hop timeline, the three groups' schedules, the mass shares, each shade's strength, the debris cloud's path and the new dust plan.

## 5. Pace and the changing speed

- **Pace**: `ORBIT.hop = 2.0` s per planet at 1×, so a lap takes 16 s. During the 5 quiet seconds a visitor sees about 2½ planets live and die.
- **The wheel clock**: wheel time = Φ(real time), where Φ is the running total of a speed that changes like a connection.

  | State | Speed | Lasts | Share of time |
  |---|---|---|---|
  | Steady | 0.8–1.25× | 0.8–1.8 s | about 55 % |
  | Slow | 0.35–0.6× | 0.6–1.4 s | about 20 % |
  | Near-stall | 0.08–0.15× | 0.35–0.8 s | about 8 % |
  | Burst (always after a near-stall, sometimes on its own) | 1.7–2.3× | 0.4–0.9 s | about 17 % |

  - Drops are quick (0.15 s) and recoveries slower (0.4 s), both eased.
  - The speed never reaches zero, so the wheel never looks hung. The average is scaled to exactly 1×.
  - The first 0.8 s are steady, for the hand-off. A slowdown and a burst are guaranteed inside the first 5 s, so the effect shows before anyone can click.
- **What follows the clock**: the hop timeline, the pieces, the dust and the shades (the simulation's time step is wheel time). An explosion may crawl in slow motion and then rush. Surface morph follows a softer mix (about a third real time), so a near-stalled planet still looks alive.
- **Code**: a new `src/loader/netSpeed.js`, with no three.js.
  - A seeded table of segments with a closed-form Φ: pure, monotonic and testable.
  - `Math.random` seeds it in production; `?seed=` makes it repeatable, as for the gate.
  - It lives in the core, because the CSS fallback needs it too.

## 6. Everything around the wheel

- **Pre-loader → fancy wheel.** The pre-loader stays the flat Spiral at its reference speed (the prompt is about the fancy wheel).
  - At hand-off, the flat dots visible at that moment turn into white dust where they stand: the CSS dots fade over 0.4 s while 3D dust appears in their place.
  - The dust streams clockwise and accretes into the **first planet**, two stations ahead of the Spiral's wave. From there the hops run.
  - The first planet's stragglers are the last of the flat dots' dust. Its leaders run on past it, so the next station's shade forms as usual.
  - `loader:fancy` is still marked at the start of the hand-off, so the spec's metric keeps its meaning.
- **A miss** hitches as today: the wheel clock freezes for 0.15 s, then catches up. It sits on top of the speed changes.
- **A hit**: the planet, the shades, the pieces and the dust spiral into the empty hub over 0.7 s, and the donut springs out as today.
- **Fancy-lite** (the CSS fallback at the 3.5 s cap, or without 3D):
  - the CSS Twin Orbit goes;
  - one coloured dot at a time: it breaks into 5 crumbs that travel to the next station, where the next dot grows;
  - the dots before and after it show as faint, soft-edged discs, with a single crumb trickling along each of the two gaps;
  - a mirrored copy below, as today.
  - It follows the same wheel clock: the animations' `playbackRate` is updated at each speed change and corrected toward Φ, so the 3D wheel can take over mid-hop in phase.
  - It moves from `index.html`'s inline script into the core (`src/loader/lite.js`), since it is only needed late. `index.html` keeps just the pre-loader.
- **Reduced motion**: half speed, a narrow speed range (0.7–1.2×, no near-stalls or bursts), pieces that drift apart instead of blasting, a stipple that doesn't shimmer, and no light pulse. Even at full speed the pulse comes at most about once a second and covers a small part of the screen.
- **Unchanged**: the 5 quiet seconds, the odds, the 3.5 s cap, the menu, the crunch, and `?loader=skip|lite|quiet:N`.

## 7. Tiers and cost

| | Low | Medium | High | Ultra |
|---|---|---|---|---|
| Pieces per planet | 12 | 18 | 26 | 36 |
| Dust motes (unchanged) | 512 | 2k | 8k | 24k |
| of which stragglers, and leaders | 51 each | 205 each | 819 each | 2.5k each |
| Faint neighbours | 2 stippled draws | 2 stippled draws | 2 stippled draws | 2 stippled draws |
| Sphere detail (unchanged) | 8 | 12 | 18 | 24 |
| Shadows, transmission | none | none | none (today: both) | none (today: both) |
| Reflection, AA | as today | as today | as today | as today |

- **Per frame** it draws less than today: one or two solid planets and two sparse shades, instead of about five planets plus three hub bodies, with no shadow or transmission pass.
- **Start-up** compiles fewer shaders: the ring (slightly larger), the dust, the floor and the post pass. I expect `loader:fancy` to come earlier, most of all on WebGPU's slow profile (3.25 s today, next_2's open item 3). M0 measures it.
- **Target**: no profile slower than today, the slow profile at 2.5 s or better, and never past 4 s.

## 8. Files, tests and budget

| File | Change |
|---|---|
| `src/loader/netSpeed.js` (new) | The speed table and Φ |
| `src/loader/lite.js` (new) | The CSS fallback: crumbs, faint neighbours, mirror copy, clock following, hitch |
| `src/loader/orbitPhysics.js` | As in §4.4 |
| `src/render3d/bodies.js` | The wedge geometry, piece motion and inner faces in the ring material; the stipple for shades. The star, ice and mercury materials and the tide code go. |
| `src/render3d/orbit.js` | New lights, the blast light, the new dust compute with its three groups, the two shades, the hand-off from flat dots, the collapse without a star. The star, twins, corona and shadows go. |
| `src/render3d/graphics3d.js`, `src/main.js` | Pass the speed plan in; switch fancy-lite to `lite.js`; the hitch goes through the wheel clock |
| `src/config.js` | `ORBIT` becomes `{ stations, hop, the phase windows, the straggler and leader shares, the shade's strength }`; new `NET` for the speed states |
| `index.html` | Inline script keeps only the pre-loader; Twin Orbit markup and CSS go; crumb and faint-disc styles are added |
| `tests/loader.test.js` | See below |
| `README.md`, `CREDITS.md`, the Credits dialog | The new wheel. The Twin Orbit credit goes, since nothing uses it any more; Spiral's stays. |
| `tools/` | No change expected. `record.mjs` and `loadtime.mjs` use the same body classes and marks; M4 confirms. |

**Tests.** The gate, hitch and bézier tests stay. The Twin Orbit and tide tests go. New:

- **Sequence**: bulk matter from station *i* lands only at *i* + 1, and that planet starts to grow only after *i* has burst. Eight hops visit every station once, and then the layout repeats.
- **Order within a hop**: seams, burst, pieces gone, last bulk dust landed, rest, in that order.
- **Neighbours**, at every sampled time while a planet is whole:
  - the previous and the next station each have a shade, and dust is in flight in both gaps;
  - the other five stations have nothing;
  - the previous shade is empty, with every straggler landed, before the planet bursts;
  - no more than two shades are ever drawn at once.
- **Mass**: planet + pieces + flying dust + shades + new planet = 1 at every sampled time, and the three groups add up to all motes.
- **Clearance**: no piece centre and no dust guide point goes below the floor, and every piece has eroded away before it could reach the forming planet.
- **Speed**:
  - Φ strictly increases;
  - the speed stays within its limits, and the mean over the table is 1;
  - no near-stall lasts longer than 0.8 s;
  - the first 5 s contain a slowdown and a burst;
  - the same seed gives the same Φ, and the table loops without a jump;
  - a hitch on top never runs the clock backwards.
- **Reduced motion**: half speed and the narrow range.

**Budget** (estimates): `index.html` shrinks slightly; the core grows by about 1.3 KB gzip (19.8 of 40 KB); the 3D chunk stays about the same size. No new assets.

## 9. Milestones

| M | Deliverable | Done when |
|---|---|---|
| M0 | Spike: one planet bursting into wedges and re-forming, with the traces, both faint neighbours and the new lights, on the Intel UHD (WebGL2) and the RTX (WebGPU) | Build time, compile time and frame time known; §7 confirmed or adjusted; a short clip, and a phone-sized still at Low, to judge the look |
| M1 | `netSpeed.js`, the new `orbitPhysics.js` and their tests | `npm test` green |
| M2 | The 3D wheel: pieces, the three dust groups, shades, lights, hand-off from the flat dots, collapse | A full lap with no pops and no console errors, at every tier |
| M3 | `lite.js`, the slimmer `index.html`, the wiring in `main.js`, reduced motion | `?loader=lite` runs the same sequence; the 3D wheel takes over mid-hop in phase; miss and hit work in both |
| M4 | Measurements: `npm run loadtime` on both GPUs, frame rate per tier on the Intel UHD, phone emulation at Low, the benchmark's tier verdicts compared with today, recorder run | §7's target met; budget check passes; the tiers picked are the same as today |
| M5 | README, credits, a filmstrip of one hop (Low and High), `ai/next_3.md` | Ready for you to commit |

## 10. Decisions

1. **Answered in revision 2**: one whole planet at a time, with traces of dust flowing in from the previous station and out to the next, and the previous and next planets as faint shades of dust.

Still on their defaults; tell me what to change:

2. **2.0 s per planet**, so 16 s per lap at normal speed. One number (`ORBIT.hop`).
3. **The connection is rough**: it includes near-stalls at 0.1× and bursts at 2.3×. A gentler profile (0.4–1.6×, no near-stalls) is a change to the `NET` table.
4. **The pre-loader is untouched**: the flat Spiral at its reference 1.5 s.
5. **On a hit the matter spirals into the empty hub**, and the donut springs out as today.
6. **The Twin Orbit credit is removed.**

## 11. Risks

- **The faint neighbours may read wrong**: too faint on a phone, or like a screen-door pattern instead of dust. Mitigation: M0 judges them first, including a phone-sized still at Low. The stipple's density and the two shares are config values. If the stipple still looks wrong, a soft haze disc in the station's colour replaces it.
- **No bloom**, so the explosion has to read through geometry, emissive pieces, hot dust and the blast light alone. M0 checks this first. If it's weak: more core dust and a longer light pulse.
- **The benchmark sees a lighter scene** than today and may keep a weak device one tier too high for the donut and the 3D stages. Mitigation: M4 compares its verdicts with today's on both GPUs. If they differ, its thresholds are retuned so the verdicts match.
- **Piece motion exists twice**: in JS for the tests and in the shader for the picture. They can drift apart. Mitigation: both read the same constants, and the formulas are kept to a few lines.
- **A near-stall may look like a hang.** Mitigation: the speed never reaches zero, the surface keeps morphing, and near-stalls are capped at 0.8 s. Decision 3's gentler profile is the fallback.
- **Fancy-lite runs exactly when the main thread is busy**, so its rate updates can arrive late. Mitigation: each update steers toward Φ instead of assuming the last one was on time.
