# Exports the cat (after author_cat_anims.py) to a GLB with only the Run and Jump clips.
# Run inside Blender (Blender MCP execute_blender_code) with the cat's scene active.
# Then optimize:  npx @gltf-transform/cli optimize cat-src.glb public/models/cat.glb \
#                   --compress meshopt --texture-compress webp --texture-size 1024 --simplify false
import bpy
import os

OUT = os.environ.get('CAT_SRC', '/tmp/cat-src.glb')
arm = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
ad = arm.animation_data
for tr in list(ad.nla_tracks):
    ad.nla_tracks.remove(tr)
for name in ['Run', 'Jump']:
    tr = ad.nla_tracks.new()
    tr.name = name
    tr.strips.new(name, 0, bpy.data.actions[name]).name = name
ad.action = None
for img in bpy.data.images:
    if img.name.startswith('SomaliTexture') and img.size[0] > 1024:
        img.scale(1024, 1024)
root = arm
while root.parent:
    root = root.parent
floor = bpy.data.objects.get('Cube_41')  # the asset's display floor
skip = set() if not floor else {floor.name} | {o.name for o in floor.children_recursive}
for o in bpy.context.scene.objects:
    o.select_set(False)
for o in [root] + list(root.children_recursive):
    if o.name not in skip:
        o.select_set(True)
bpy.context.view_layer.objects.active = arm
# use_active_scene matters: without it the exporter also writes selected objects of other scenes.
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, use_active_scene=True,
                          export_animations=True, export_animation_mode='NLA_TRACKS', export_yup=True,
                          export_image_format='WEBP', export_image_quality=85, export_skins=True,
                          export_morph=False, export_lights=False, export_cameras=False)
print('exported', OUT, os.path.getsize(OUT), 'bytes')
