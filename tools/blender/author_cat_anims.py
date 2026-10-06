# Authors in-place "Run" (bounding gallop) and "Jump" actions for the Sketchfab cat
# "Somali Cat Animated ver 1.2" by DreamNoms (CC BY 4.0), which ships with idle/walk/sit clips only.
# Run inside Blender (Blender MCP execute_blender_code) with the cat imported into the active scene.
# Rig axes (armature space): +Y forward, +Z up, X lateral. All rotations are sagittal pitches.
# The paws/feet are root-level deform bones (IK targets in the original rig), so after posing
# each leg chain we move them to the end of their leg.
import bpy
import math
from mathutils import Quaternion, Vector

arm = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
pb = arm.pose.bones
LAT = Vector((1, 0, 0))  # +angle: a downward limb swings forward / a forward chain pitches up

LEGS = {
    'L': {'hip': 'Hip.L_4', 'thigh': 'Thigh.L_3', 'heel': 'Heel.L_2', 'foot': 'Foot.L_33',
          'upper': 'UpperArm.L_25', 'arm': 'Arm.L_24', 'paw': 'Paw.L_32'},
    'R': {'hip': 'Hip.R_7', 'thigh': 'Thigh.R_6', 'heel': 'Heel.R_5', 'foot': 'Foot.R_34',
          'upper': 'UpperArm.R_27', 'arm': 'Arm.R_26', 'paw': 'Paw.R_35'},
}
LOWER_SPINE, UPPER_SPINE, COLLAR = 'LowerSpine_13', 'UpperSpine_29', 'Collarbone_28'
NECK, HEAD = 'Neck_23', 'Head_22'
TAIL = ['TailBase_11', 'TailBaseMiddle_10', 'TailTipMiddle_9', 'TailTip_8']
ROOT = 'Root_31'


def pitch(name, a):
    b = pb[name]
    axis = (b.bone.matrix_local.to_3x3().inverted() @ LAT).normalized()
    b.rotation_mode = 'QUATERNION'
    b.rotation_quaternion = Quaternion(axis, a)


def move(name, delta):
    """Translate a bone by an armature-space delta (bone-local location)."""
    b = pb[name]
    b.location = b.bone.matrix_local.to_3x3().inverted() @ delta


def reset():
    for b in pb:
        b.rotation_mode = 'QUATERNION'
        b.rotation_quaternion = Quaternion()
        b.location = Vector()
        b.scale = Vector((1, 1, 1))


def follow(target, chain_end, foot_pitch):
    """Move a root-level paw/foot bone so it stays attached to the end of its leg chain."""
    bpy.context.view_layer.update()
    end_pose = pb[chain_end].tail
    end_rest = pb[chain_end].bone.tail_local
    head_rest = pb[target].bone.head_local
    desired = end_pose + (head_rest - end_rest)
    move(target, desired - head_rest)
    pitch(target, foot_pitch)


def legs_follow(fold):
    for side in ('L', 'R'):
        B = LEGS[side]
        fh, ff = fold[side]
        follow(B['foot'], B['heel'], -0.5 * fh)
        follow(B['paw'], B['arm'], 0.7 * ff)


def run_pose(phi):
    """Bounding gallop: phi=0 gathered (legs under the body, back arched), 0.5 fully stretched."""
    reset()
    c = math.cos(2 * math.pi * phi)
    fold = {}
    for side, off in (('L', 0.0), ('R', 0.07)):
        B = LEGS[side]
        cs = math.cos(2 * math.pi * (phi + off))
        sn = math.sin(2 * math.pi * (phi + off))
        fold_h = max(0.0, -sn)  # hind leg swinging forward
        fold_f = max(0.0, sn)  # fore leg swinging forward
        fold[side] = (fold_h, fold_f)
        pitch(B['hip'], 0.8 * cs + 0.35 * fold_h)
        pitch(B['thigh'], 0.75 * fold_h)
        pitch(B['heel'], -0.8 * fold_h - 0.1)
        pitch(B['upper'], -0.85 * cs + 0.35 * fold_f)
        pitch(B['arm'], -1.3 * fold_f)
    pitch(LOWER_SPINE, -0.16 * c)
    pitch(UPPER_SPINE, 0.16 * c)
    pitch(COLLAR, 0.05 * c)
    move(ROOT, Vector((0, 0, 0.5 * max(0.0, -c) - 0.1)))
    pitch(NECK, -0.1 * c)
    pitch(HEAD, 0.08 * c)
    for i, name in enumerate(TAIL):
        pitch(name, -0.1 + 0.14 * math.sin(2 * math.pi * phi - i * 0.8))
    legs_follow(fold)


def jump_pose(f):
    """f: 0 take-off crouch → 0.5 stretched apex → 1 landing reach."""
    reset()
    crouch = max(0.0, 1 - f * 5)
    stretch = math.sin(math.pi * min(1.0, f / 0.8))
    land = max(0.0, (f - 0.6) / 0.4)
    for side in ('L', 'R'):
        B = LEGS[side]
        pitch(B['hip'], 0.55 * crouch - 0.9 * stretch * (1 - land) + 0.35 * land)
        pitch(B['thigh'], 0.4 * crouch + 0.2 * land)
        pitch(B['heel'], -0.4 * crouch + 0.25 * stretch)
        pitch(B['upper'], -0.45 * crouch + 1.0 * stretch * (1 - land) + 0.55 * land)
        pitch(B['arm'], -0.6 * crouch + 0.15 * stretch)
    pitch(LOWER_SPINE, -0.15 * crouch + 0.05 * stretch)
    pitch(UPPER_SPINE, 0.15 * crouch - 0.05 * stretch)
    move(ROOT, Vector((0, 0, -0.25 * crouch)))
    pitch(NECK, 0.12 * stretch - 0.15 * land)
    for i, name in enumerate(TAIL):
        pitch(name, 0.12 * stretch + 0.03 * i * stretch - 0.05 * land)
    legs_follow({'L': (0.0, 0.0), 'R': (0.0, 0.0)})


def bake(name, frames, fn, loop):
    old = bpy.data.actions.get(name)
    if old:
        bpy.data.actions.remove(old)
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    if arm.animation_data is None:
        arm.animation_data_create()
    arm.animation_data.action = act
    for fr in range(frames + 1):
        t = (fr % frames) / frames if loop else fr / frames
        fn(t)
        for b in pb:
            b.keyframe_insert('rotation_quaternion', frame=fr)
            b.keyframe_insert('location', frame=fr)
    return act


arm.data.pose_position = 'POSE'
if arm.animation_data:
    for tr in list(arm.animation_data.nla_tracks):
        arm.animation_data.nla_tracks.remove(tr)
run = bake('Run', 20, run_pose, loop=True)
jump = bake('Jump', 20, jump_pose, loop=False)
arm.animation_data.action = run
print('authored', run.name, tuple(run.frame_range), jump.name, tuple(jump.frame_range))
