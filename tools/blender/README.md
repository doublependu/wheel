# Cat asset pipeline (Blender via MCP)

The smooth 3D and HDR stages use a rigged cat from Sketchfab. The pixel stages and the PS1 stage use
the procedural cat (`src/render2d/sprites.js` → `catPose`), which shares one gallop with the 3D
procedural cat so the 2D → 3D pop-out lines up.

1. Import **"Somali Cat Animated ver 1.2" by DreamNoms** (Sketchfab `e185c3fd92b64c32b4515a32b29252fc`,
   CC BY 4.0) into an empty scene with the Blender MCP `import_asset` tool (`target_size` 0.75).
   The Blender MCP add-on stores its "use Sketchfab" toggle per scene; enable it on the new scene.
2. Run `author_cat_anims.py` (the model ships with idle/walk/sit only): it adds an in-place bounding
   gallop (`Run`) and a `Jump`, moving the root-level paw bones (IK targets in the original rig) to the
   ends of the leg chains every frame.
3. Run `export_cat.py`, then optimize with glTF-Transform (meshopt + WebP, ≈190 KB).
4. `public/models/cat.json` maps clip names, orientation, the black tint and the credit line.

Rejected: "An Animated Cat" (Sketchfab `aec25699…`) — its description says it isn't the uploader's
work; it traces back to a rip of the *Murdered: Soul Suspect* game cat, so its CC-BY label isn't
trustworthy.

## Obstacles

Cute low-poly CC-BY models (credits in `CREDITS.md` and `public/models/obstacles.json`).

1. Import with the Blender MCP `import_asset` tool into a scene with "use Sketchfab" on, and name the
   sources as `import_obstacles.py` expects (its header lists the UIDs): `src_cucumber` (+ `_stem`,
   separated from the vegetable set), `src_pot`, `src_vacuum`, and the crow's root `src_crow`.
2. Run `import_obstacles.py`: game-sized, grounded, facing −X; the vacuum is recoloured and gets googly
   eyes; the crow's wings hang on hinge empties (the game flaps them in code).
3. Run `export_obstacles.py`, then optimize (meshopt + WebP, ≈83 KB). Keep `--join false --flatten false`
   so the crow's wing hinges survive.
4. Run `render_obstacle_sprites.py` (side views at 384 px per unit, crow flap frames), then
   `npm run sprites` turns them into `src/assets/obstacles.{png,json}` (palette rules in
   `tools/obstacle-look.mjs`).
