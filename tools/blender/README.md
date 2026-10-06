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
