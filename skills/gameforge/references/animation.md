# Authoring animation

You can create any character motion in code (attacks, emotes, climbs, dances, idles, cutscene
acting) as an **anim script**, then review it with metrics and contact sheets. Engine clips and
your clips are retargeted automatically onto the realistic 163-bone human and onto the stylized
mannequin.

```js
// anims/overhead-slash.anim.js
export default ({ S, C, ease, seg, bell, relaxed, locomotion }) => ({
  duration: 0.9, loop: false,
  pose: (p) => relaxed({ upperArm_R: [-150 * bell(p, 0, 0.35, 0.8), 0, -20], ... , hipsY: -0.03 * bell(p, 0.3, 0.5, 0.9) }),
  events: [{ t: 0.45, name: 'hit' }],          // gameplay hooks (damage frame)
});
```

To review a script:

```bash
node $GF/tools/gameforge.mjs anim anims/overhead-slash.anim.js [--phases 8]
```

The command prints checks and writes `review/<name>.side.jpg` and `review/<name>.front.jpg`.
Each sheet shows `--phases` N figures (default 8) at p = i/N, i.e. 0, 0.125, …, 0.875. p = 1
equals p = 0 for loops. The sheets use an orthographic camera, so there is no perspective
distortion: a forward reach really is a forward reach. Each figure is labelled with its p, and
green discs mark feet within 6 cm of the floor. **Open both images and critique them.** The
checks name the phase and foot of the worst value. The metrics JSON has a `frames` table (p,
footL, footR, hipsY) for 61 samples, so you can find moments that fall between sheet phases.

**`groundFeet: true`** pins the lowest foot or toe to the floor on every frame by adjusting the
hips height automatically. Use it for walks, idles, stances and anything else that keeps a foot
down. You no longer need to guess leg lengths to avoid floating or sinking. Leave it off for
jumps and airborne moves (and set `airborne: true`). In-place locomotion makes a planted foot
slide backward at walk speed; that is expected, because the character controller moves the
body.

To register the clip in a game, call `defineClip('overheadSlash', def)` from
`engine/animation/clips.js`. After that, every `Animator` and every realistic human plays it
like an engine clip.

## Joint vocabulary and sign conventions

These conventions were measured on the realistic rig. The character faces +Z, +X is the
character's left, and all angles are degrees relative to the relaxed rest pose.

| Joint key | x | y | z |
|---|---|---|---|
| `hips` (also `hipsX/Y/Z` offsets in metres: **hipsY + raises the body**, hipsX + = towards the character's left) | pelvis tilt | turn | sway |
| `spine`, `chest` | **+ = bend forward** | twist | side bend |
| `neck`, `head` | + = nod down | **+ = turn** | tilt |
| `upperLeg_L/R` | **− = leg forward (hip flexion)**, + = leg back | twist | `_L`: + = out (abduction); `_R`: − = out |
| `lowerLeg_L/R` | **+ = knee flexion (only bend this way)** | — | — |
| `foot_L/R` | **+ = toes DOWN (plantar flexion), − = toes up** (both feet) | — | — |
| `shoulder_L/R` (clavicle) | shrug forward/back | — | raise |
| `upperArm_L/R` | **− = arm forward / up in front**, + = arm back | twist | `_L`: + = raise sideways; `_R`: **− = raise sideways** |
| `lowerArm_L/R` | **− = elbow flexion (only bend this way)** | forearm twist | — |
| `hand_L/R` | wrist flex | — | wrist side |

Clip options: `duration`, `loop`, `groundFeet`, `airborne`, `events: [{ t, name }]` (t in 0..1).

Helpers (passed to your default export):

| Helper | Meaning |
|---|---|
| `S(p)`, `C(p)` | sine / cosine of one full cycle per unit of p |
| `ease(t)` | smoothstep, clamped to 0..1 |
| `seg(p, a, b)` | 0 → 1 over [a, b] |
| `bell(p, a, m, b)` | 0 → 1 → 0 rising over [a, m] and falling over [m, b] |
| `relaxed(o)` | natural arm hang merged with your overrides. It sets `upperArm_L` z −4 and `upperArm_R` z +4, which means slightly *lowered* toward the body |
| `locomotion(p, { stride = 25, knee = 40, arm = 18, elbow = 12, bob = 0.03, lean = 4, twist = 6, kick = 0 })` | a full walk/run cycle you can layer on. All values are **degrees** except `bob`, which is metres |

## The method (how an animator works)

1. **Brief.** Write the intent in a comment: action, weight, mood, duration and contact points
   (when the feet are planted, when a hand hits).
2. **Key poses first.** Write 3–5 key poses as plain objects: anticipation → action → impact →
   recovery for attacks; contact → down → passing → up for gaits. Review them as a
   non-animated contact sheet.
3. **Timing.** Interpolate between the keys with `seg`/`bell`/`ease`:
   - ease in and out of extremes;
   - make actions faster than anticipations;
   - hold impacts for 2–4 frames.
4. **Principles.** Apply the classic animation principles:
   - **Weight and balance:** hips go down on impacts, and the centre of mass stays over the
     planted foot.
   - **Overlapping action:** the chest leads the arms, and the head settles last (offset the
     phase by 0.03–0.08).
   - **Arcs:** hands move on curves, not straight lines.
   - **Asymmetry:** avoid twinned limbs.
5. **Loop hygiene.** For loops, make `pose(0)` equal `pose(1)`: use periodic functions
   (`S`, `C`) and avoid `p`-linear terms.
6. **Review loop.** Run `gameforge anim`, read the checks, open the sheets, fix, and re-run
   (at most 5 rounds).

## Review checklist

1. **Readable silhouette:** is the action clear from the side sheet alone?
2. **Feet:** no sinking (the check fails below −3 cm) and no skating. Planted feet should keep
   their place between neighbouring phases on the side sheet.
3. **Hinges:** knees and elbows bend the right way (checked automatically).
4. **Smoothness:** no pops (more than 25° per frame is flagged), and the loop seam is 4° or
   less.
5. **Weight:** the hips dip on landings and impacts, and the torso counter-rotates on swings.
6. **Gameplay:** the hit `events` happen at the visual contact frame, and recovery returns close
   to idle so blending looks clean.

## Common pitfalls (found in blind tests)

- Use `seg()`/`bell()` to build 0..1 ramps. Do not feed raw `p` arithmetic into easing.
- For a planted or dragged foot, combine `groundFeet: true` with a fixed `foot` angle instead
  of solving leg geometry yourself.
- Check sign conventions with a one-joint probe clip, e.g.
  `pose: () => ({ foot_R: [30, 0, 0] })` with `--phases 1`. Don't assume them.

## Motion capture

Real mocap beats hand keys for realism. `H.clipFromBVHCanonical(retargeter, bvhText, { names })`
retargets BVH files with CMU, Mixamo-style or MakeHuman naming. Only CC0 or properly licensed
BVH may be bundled.

## Procedural IK, look-at and ragdoll (after the mixer)

`engine/animation/ik.js` and `engine/animation/ragdoll.js` add a procedural layer on top of
clips. They work on both rigs (realistic 163-bone human and stylized mannequin). Every
`Actor`, `Player`, `NPC` and `Enemy` already has one. Use them for these cases:

| Need | Use |
|---|---|
| Feet float or sink on slopes, stairs or rocks | **foot IK** (on by default for realistic humans when the world has a heightfield) |
| An NPC should watch the player, or a guard should track a noise | **look-at** (`actor.lookAt(target)`; NPCs look at the player within `lookRange`, default 8 m) |
| A hand must touch something: a lever, a door handle, a wall, a ledge | **hand IK** (`actor.reach('R', obj)`) |
| Two-handed sword, rifle or staff | **grip** (`actor.twoHanded()`): the left hand goes to a point on the right-hand weapon |
| Deaths should react to the hit and to the terrain | **ragdoll** (`ragdollOnDeath: true`, or `actor.goRagdoll({ impulse })`) |

Don't use foot IK for airborne moves. The Actor fades it out automatically when the actor is
not grounded, during overrides (sit, drive, fall, swing) and during `dodge`, `jump`, `kick` and
`death`. Keep authoring clips on flat ground with `groundFeet: true`. The IK adapts them to the
terrain at runtime.

```js
// Actor options (all optional)
new GF.Enemy(app, { type: 'grunt', ragdollOnDeath: true,
  ik: { footIK: true, lookAt: true, lookLimits: { yaw: 70, up: 35, down: 40 }, lookRate: 6, maxStepUp: 0.5, maxStepDown: 0.55, maxFootTilt: 35 } });
// ik: false switches the layer off.
actor.lookAt(player);                 // Actor (looks at its head), Vector3, Object3D, or null
actor.reach('R', leverObject, { weight: 1 });   // reach('R', null) releases
actor.twoHanded(true, { point: new THREE.Vector3(0, -0.12, 0) }); // weapon-local grip point; or add a child 'grip_L'
actor.goRagdoll({ impulse: dir.clone().multiplyScalar(60), point });  // kg·m/s at a world point
actor.ragdoll.deactivate({ blend: 0.4 });  // blend back to animation (get-up clip not included)
```

Standalone (your own mixer loop):

```js
import { CharacterIK, groundFromPhysics, solveTwoBone, solveCCD } from './engine/animation/ik.js';
import { Ragdoll } from './engine/animation/ragdoll.js';
const ik = new CharacterIK(model, { ground: groundFromPhysics(app.physics) }); // or groundFromHeightfield(hf), flatGround(y)
// each frame: mixer.update(dt); place model; model.updateMatrixWorld(); ik.update(dt);
const rd = new Ragdoll(model, { physics: app.physics }).activate({ velocity, impulse, point });
// each frame afterwards: rd.update(dt)   (don't run the mixer while it is active)
solveTwoBone(upper, mid, end, targetWorld, { pole: kneeWorld.clone().add(forward), weight: 1 });
solveCCD([b0, b1, b2, b3], tipObject, targetWorld, { iterations: 12 });
```

How it works and what the parameters mean:
- **Two-bone IK** is analytic: it is exact for reachable targets, and an unreachable target
  straightens the chain towards it. `pole` is the world point the knee or elbow bends towards.
  If you omit it, the solver keeps the current bend plane. Use **CCD** for chains longer than
  two bones, such as tails, spines and tentacles.
- **Foot IK** works on each foot separately:
  - It probes the ground under the heel and the toe. A toe that cuts into a step edge lifts
    the foot.
  - It drops the hips so that the lower foot can reach. It never raises them.
  - It solves each leg with the knee pole pointing forward.
  - It tilts each foot onto the ground normal, up to `maxFootTilt`. The tilt weight comes from
    contact, i.e. how far the clip lifts the foot. A swinging foot keeps its animated arc and
    follows the terrain height.
- **Look-at** clamps yaw and pitch relative to the body. It spreads the rotation over
  spine → neck → head (the head takes about 50%) and eases in with `lookRate`. When a target
  goes more than about 25° past the yaw limit (behind the character), it lets go smoothly.
- **Bones** that the mixer leaves alone are restored every frame, so IK never accumulates.
- **Ragdoll:**
  - It uses 18 Verlet particles at the major joints and capsule ground contact.
  - Bones and the torso are held by distance constraints. Joint limits are distance ranges:
    elbows, knees, ankles, neck, hip flexion and hip abduction. A hinge-side rule stops knees
    from bending backwards.
  - It collides with the heightfield and walkable static tops, and walls push it out through
    `resolveCylinder`.
  - It sleeps once it has settled (`ragdoll.settled`).
  - Bones are aimed from where they actually are, so the skinned mesh stays on the particles.

Review: `node tools/bench-ik.mjs [--style stylized]` renders `sandbox/ik.html`. It shows IK
off/on pairs on a 20° slope and a 16 cm step, plus a ragdoll drop on bumpy ground, and writes
the shots and metrics to `docs/benchmarks/ik/`. Open the images and check three things: no
gap or penetration under the feet, the knee bent on the uphill or step side, and the ragdoll
lying on the ground without stretched limbs.

Limits:
- The ragdoll has no self-collision between limbs, except through the joint limits.
- It doesn't twist the forearms.
- It has no get-up animation. `deactivate` blends straight back to the current clip.
- Foot IK assumes an upright character.
- Look-at doesn't drive the eyes.
