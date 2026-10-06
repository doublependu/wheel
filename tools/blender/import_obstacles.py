# Builds the four obstacles (cucumber, pot, vacuum, crow) from cute low-poly Sketchfab models.
# Run inside Blender (Blender MCP execute_blender_code) after importing the sources:
#
#   import_asset sketchfab 8f9206e5dff740afbab92e073dfe0a93  ("Collection of Vegetables", JohanHoof)
#     → separate loose parts, keep the cucumber + its stem → rename src_cucumber / src_cucumber_stem
#   import_asset sketchfab a5330259df174753a35abfde4c966dc1  ("Kaktiss", LanaGre)        → join → src_pot
#   import_asset sketchfab be32b697116f4c70971da8c53b3b6653  ("Low-poly Roomba", Seats)  → join → src_vacuum
#   import_asset sketchfab 00a776f578304cce8c096fc0034582ef  ("Low Poly Crow", DracTheZach) → root src_crow
#
# Output: collection "Obstacles" with objects cucumber, pot, vacuum and crow (an empty with
# crow_body, crow_wing_near, crow_wing_far). Units match the game (cat ≈ 1 long), Z up, the
# origin on the ground at the obstacle's centre, facing −X (towards the cat). The game flaps the
# crow's wings in code (rotation about X), so no animation is exported.
import math

import bpy
import bmesh
from mathutils import Vector, Matrix

SIZES = {
    'cucumber': {'length': 0.9},
    'pot': {'height': 0.9},
    'vacuum': {'width': 0.95, 'height': 0.27},  # the puck is stretched a little: a chunkier, cuter toy
    'crow': {'length': 0.8},
}
VACUUM_COLORS = {'lambert66': '#f07f74', 'RombaBlack': '#3a3f55', 'lambert65': '#3a3f55', 'lambert67': '#3a3f55'}

scene = bpy.context.scene
col = bpy.data.collections.get('Obstacles') or bpy.data.collections.new('Obstacles')
if col.name not in scene.collection.children:
    scene.collection.children.link(col)
for o in list(col.objects):
    if not o.name.startswith('src_'):
        bpy.data.objects.remove(o, do_unlink=True)


def world_mesh(objs, name):
    """One mesh from `objs` with their world transforms applied and materials merged."""
    bm = bmesh.new()
    mats = []
    for o in objs:
        me = o.data.copy()
        me.transform(o.matrix_world)
        remap = []
        for s in o.material_slots:
            if s.material not in mats:
                mats.append(s.material)
            remap.append(mats.index(s.material))
        for p in me.polygons:
            p.material_index = remap[p.material_index] if p.material_index < len(remap) else 0
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    return me


def bounds(me):
    xs = [v.co.x for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    zs = [v.co.z for v in me.vertices]
    return Vector((min(xs), min(ys), min(zs))), Vector((max(xs), max(ys), max(zs)))


def ground(me, scale=(1, 1, 1)):
    """Centre on x/y, put the bottom at z = 0, then scale."""
    mn, mx = bounds(me)
    c = (mn + mx) / 2
    me.transform(Matrix.Translation((-c.x, -c.y, -mn.z)))
    me.transform(Matrix.Diagonal((*scale, 1)))


def new_object(name, me, parent=None):
    o = bpy.data.objects.new(name, me)
    col.objects.link(o)
    o.parent = parent
    return o


def hex_rgba(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return [x ** 2.2 for x in c] + [1]


# ---- cucumber: lying along X ----
me = world_mesh([bpy.data.objects['src_cucumber'], bpy.data.objects['src_cucumber_stem']], 'cucumber')
mn, mx = bounds(me)
s = SIZES['cucumber']['length'] / (mx.x - mn.x)
ground(me, (s, s, s))
new_object('cucumber', me)

# ---- pot ----
me = world_mesh([bpy.data.objects['src_pot']], 'pot')
mn, mx = bounds(me)
s = SIZES['pot']['height'] / (mx.z - mn.z)
ground(me, (s, s, s))
new_object('pot', me)

# ---- vacuum: recoloured (coral bumper, slate details) and given two googly eyes ----
me = world_mesh([bpy.data.objects['src_vacuum']], 'vacuum')
mn, mx = bounds(me)
s = SIZES['vacuum']['width'] / (mx.x - mn.x)
sz = SIZES['vacuum']['height'] / ((mx.z - mn.z) * s) * s
ground(me, (s, s, sz))
for i, m in enumerate(me.materials):
    if m.name in VACUUM_COLORS:
        m2 = m.copy()
        m2.name = 'vacuum_' + m.name
        bsdf = next(n for n in m2.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        bsdf.inputs['Base Color'].default_value = hex_rgba(VACUUM_COLORS[m.name])
        bsdf.inputs['Roughness'].default_value = 0.45
        me.materials[i] = m2
vac = new_object('vacuum', me)


def eye_material(name, color, rough):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = hex_rgba(color)
    b.inputs['Roughness'].default_value = rough
    return m


white = eye_material('vacuum_eye', '#ffffff', 0.25)
black = eye_material('vacuum_pupil', '#15161c', 0.2)
R = SIZES['vacuum']['width'] / 2
H = SIZES['vacuum']['height']
eyes = bmesh.new()
for ang in (232, 256):  # on the camera-facing side (−Y), towards the front (−X)
    a = math.radians(ang)
    n = Vector((math.cos(a), math.sin(a), 0))
    centre = n * (R * 0.985) + Vector((0, 0, H * 0.62))
    for rad, mat_i, push in ((0.055, 0, 0.0), (0.03, 1, 0.035)):
        g = bmesh.ops.create_uvsphere(eyes, u_segments=12, v_segments=8, radius=rad)
        look = (n + Vector((-0.8, 0, 0.1))).normalized()  # pupils look left, towards the cat
        off = centre + look * push
        bmesh.ops.scale(eyes, vec=(1, 1, 1.15), verts=g['verts'])
        bmesh.ops.translate(eyes, vec=off, verts=g['verts'])
        for f in {f for v in g['verts'] for f in v.link_faces}:
            f.material_index = mat_i
eme = bpy.data.meshes.new('vacuum_eyes')
eyes.to_mesh(eme)
eyes.free()
eme.materials.append(white)
eme.materials.append(black)
for p in eme.polygons:
    p.use_smooth = True
new_object('vacuum_eyes', eme, vac)

# ---- crow: body + two wings that flap about X; faces −X ----
src = bpy.data.objects['src_crow']
parts = {}
for o in src.children_recursive:
    if o.type != 'MESH':
        continue
    names = []
    p = o.parent
    while p and p != src:
        names.append(p.name)
        p = p.parent
    key = 'wingL' if any(n.startswith('leftwing') for n in names) else 'wingR' if any(n.startswith('rightwing') for n in names) else 'body'
    parts.setdefault(key, []).append(o)
meshes = {k: world_mesh(v, 'crow_' + k) for k, v in parts.items()}
# rotate +90° about Z so the head (+Y) points to −X, then scale to length and ground the body+wings
rot = Matrix.Rotation(math.pi / 2, 4, 'Z')
for me in meshes.values():
    me.transform(rot)
allv = [v.co.copy() for me in meshes.values() for v in me.vertices]
mn = Vector((min(v.x for v in allv), min(v.y for v in allv), min(v.z for v in allv)))
mx = Vector((max(v.x for v in allv), max(v.y for v in allv), max(v.z for v in allv)))
s = SIZES['crow']['length'] / (mx.x - mn.x)
c = (mn + mx) / 2
T = Matrix.Diagonal((s, s, s, 1)) @ Matrix.Translation((-c.x, -c.y, -mn.z))
for me in meshes.values():
    me.transform(T)
crow = bpy.data.objects.new('crow', None)
col.objects.link(crow)
body = new_object('crow_body', meshes['body'], crow)
bmn, bmx = bounds(meshes['body'])
for key, name in (('wingL', 'crow_wing_far'), ('wingR', 'crow_wing_near')):
    me = meshes[key]
    wmn, wmx = bounds(me)
    # hinge on the body's side, at the wing's mid height
    hinge_y = bmx.y if wmn.y > (bmn.y + bmx.y) / 2 else bmn.y
    hinge = Vector(((wmn.x + wmx.x) / 2, hinge_y, (wmn.z + wmx.z) / 2))
    me.transform(Matrix.Translation(-hinge))
    # an empty at the hinge carries the wing mesh: mesh quantization moves mesh nodes' transforms,
    # so the game rotates this empty instead
    pivot = bpy.data.objects.new(name, None)
    col.objects.link(pivot)
    pivot.parent = crow
    pivot.location = hinge
    new_object(name + '_mesh', me, pivot)

for o in col.objects:
    o.select_set(False)
print('obstacles:', [(o.name, len(o.data.polygons) if o.type == 'MESH' else '-') for o in col.objects if not o.name.startswith('src_')])
