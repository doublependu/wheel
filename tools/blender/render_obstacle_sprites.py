# Renders side views of the obstacles (after import_obstacles.py) as transparent PNGs at a high
# pixel density. tools/build-obstacle-sprites.mjs turns them into each pixel stage's sprites.
# Run inside Blender (Blender MCP execute_blender_code). Output: $SPRITES_OUT/<name>_<frame>.png
# plus meta.json with the pixel density and the pixel where the obstacle's ground origin lands.
import json
import math
import os

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector, Euler

OUT = os.environ.get('SPRITES_OUT', '/tmp/obstacle-sprites')
PPU = 384  # render pixels per world unit (8× the 256-colour stage)
ELEVATION = math.radians(12)  # look slightly down so flat obstacles show their top
# Frame per obstacle, in world units around its ground origin: x0, x1, z0, z1.
BOXES = {
    'cucumber': (-0.5, 0.5, -0.06, 0.36),
    'pot': (-0.36, 0.36, -0.06, 0.98),
    'vacuum': (-0.52, 0.52, -0.06, 0.4),
    'crow': (-0.46, 0.46, -0.06, 0.66),
}
# Crow flap cycle: wing angle (degrees, + = up) per frame.
FLAP = [55, 12, -38, 12]

os.makedirs(OUT, exist_ok=True)
scene = bpy.context.scene
col = bpy.data.collections['Obstacles']
roots = {n: bpy.data.objects[n] for n in BOXES}
saved = {n: o.location.copy() for n, o in roots.items()}

# ---- studio: transparent film, plain colours, a key light from the upper left ----
try:
    scene.render.engine = 'BLENDER_EEVEE'
except TypeError:
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.view_settings.view_transform = 'Standard'
scene.view_settings.look = 'None'
scene.render.resolution_percentage = 100
world = bpy.data.worlds.get('SpriteWorld') or bpy.data.worlds.new('SpriteWorld')
world.use_nodes = True
bg = next(n for n in world.node_tree.nodes if n.type == 'BACKGROUND')
bg.inputs['Color'].default_value = (0.55, 0.55, 0.6, 1)
bg.inputs['Strength'].default_value = 0.9
scene.world = world
key = bpy.data.objects.get('SpriteKey')
if not key:
    key = bpy.data.objects.new('SpriteKey', bpy.data.lights.new('SpriteKey', 'SUN'))
    scene.collection.objects.link(key)
key.data.energy = 3.2
key.data.angle = math.radians(8)
key.rotation_euler = Euler((math.radians(50), 0, math.radians(-35)))
cam = bpy.data.objects.get('SpriteCam')
if not cam:
    cam = bpy.data.objects.new('SpriteCam', bpy.data.cameras.new('SpriteCam'))
    scene.collection.objects.link(cam)
cam.data.type = 'ORTHO'
scene.camera = cam

hidden = {o.name: o.hide_render for o in scene.objects}
for o in scene.objects:
    if o.type in {'MESH', 'EMPTY'}:
        o.hide_render = True

meta = {'ppu': PPU, 'elevation': math.degrees(ELEVATION), 'frames': {}}
for name, (x0, x1, z0, z1) in BOXES.items():
    root = roots[name]
    root.location = (0, 0, 0)
    for o in [root] + list(root.children_recursive):
        o.hide_render = False
    w = round((x1 - x0) * PPU)
    h = round((z1 - z0) * PPU)
    scene.render.resolution_x = w
    scene.render.resolution_y = h
    cam.data.ortho_scale = max(x1 - x0, z1 - z0)
    # aim at the box centre from the front (−Y), tilted down by ELEVATION
    centre = Vector(((x0 + x1) / 2, 0, (z0 + z1) / 2))
    d = Vector((0, -math.cos(ELEVATION), math.sin(ELEVATION)))
    cam.location = centre + d * 10
    cam.rotation_euler = (math.pi / 2 - ELEVATION, 0, 0)
    bpy.context.view_layer.update()
    flaps = FLAP if name == 'crow' else [None]
    meta['frames'][name] = []
    for i, ang in enumerate(flaps):
        if ang is not None:
            a = math.radians(ang)
            bpy.data.objects['crow_wing_near'].rotation_euler.x = -a
            bpy.data.objects['crow_wing_far'].rotation_euler.x = a
            bpy.context.view_layer.update()
        path = os.path.join(OUT, f'{name}_{i}.png')
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        o = world_to_camera_view(scene, cam, Vector((0, 0, 0)))
        meta['frames'][name].append({'file': os.path.basename(path), 'w': w, 'h': h, 'ox': o.x * w, 'oy': (1 - o.y) * h})
    if name == 'crow':
        bpy.data.objects['crow_wing_near'].rotation_euler.x = 0
        bpy.data.objects['crow_wing_far'].rotation_euler.x = 0
    for o in [root] + list(root.children_recursive):
        o.hide_render = True

for n, loc in saved.items():
    roots[n].location = loc
for o in scene.objects:
    if o.name in hidden:
        o.hide_render = hidden[o.name]
with open(os.path.join(OUT, 'meta.json'), 'w') as f:
    json.dump(meta, f, indent=1)
print('rendered', sum(len(v) for v in meta['frames'].values()), 'frames to', OUT)
