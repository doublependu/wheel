# Exports the "Obstacles" collection (after import_obstacles.py) to one GLB with four root nodes:
# cucumber, pot, vacuum (+ vacuum_eyes) and crow (crow_body, crow_wing_near, crow_wing_far).
# Then optimize:
#   npx @gltf-transform/cli optimize /tmp/obstacles-src.glb public/models/obstacles.glb \
#     --compress meshopt --texture-compress webp --texture-size 256 --simplify false
import os

import bpy

OUT = os.environ.get('OBSTACLES_SRC', '/tmp/obstacles-src.glb')
col = bpy.data.collections['Obstacles']
keep = [o for o in col.objects if not o.name.startswith('src_')]
saved = {o.name: o.location.copy() for o in keep if o.parent is None}
for o in bpy.context.scene.objects:
    o.select_set(False)
for o in keep:
    if o.parent is None:
        o.location = (0, 0, 0)  # every obstacle sits at the origin in the file
    o.hide_set(False)
    o.select_set(True)
bpy.context.view_layer.objects.active = keep[0]
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, use_active_scene=True,
                          export_yup=True, export_apply=False, export_animations=False,
                          export_image_format='AUTO', export_lights=False, export_cameras=False)
for name, loc in saved.items():
    bpy.data.objects[name].location = loc
print('exported', OUT, os.path.getsize(OUT), 'bytes')
