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

The command prints checks and writes `review/<name>.side.jpg` and `review/<name>.front.jpg`: 8
phases from p = 0 on the left to p = 1 on the right. **Open both images and critique them.**

To register the clip in a game, call `defineClip('overheadSlash', def)` from
`engine/animation/clips.js`. After that, every `Animator` and every realistic human plays it
like an engine clip.

## Joint vocabulary and sign conventions

These conventions were measured on the realistic rig. The character faces +Z, +X is the
character's left, and all angles are degrees relative to the relaxed rest pose.

| Joint key | x | y | z |
|---|---|---|---|
| `hips` (also `hipsX/Y/Z` offsets in metres) | pelvis tilt | turn | sway |
| `spine`, `chest` | **+ = bend forward** | twist | side bend |
| `neck`, `head` | + = nod down | **+ = turn** | tilt |
| `upperLeg_L/R` | **− = leg forward (hip flexion)**, + = leg back | twist | `_L`: + = out (abduction); `_R`: − = out |
| `lowerLeg_L/R` | **+ = knee flexion (only bend this way)** | — | — |
| `foot_L/R` | + = toes up | — | — |
| `shoulder_L/R` (clavicle) | shrug forward/back | — | raise |
| `upperArm_L/R` | **− = arm forward / up in front**, + = arm back | twist | `_L`: + = raise sideways; `_R`: **− = raise sideways** |
| `lowerArm_L/R` | **− = elbow flexion (only bend this way)** | forearm twist | — |
| `hand_L/R` | wrist flex | — | wrist side |

Helpers (passed to your default export):

| Helper | Meaning |
|---|---|
| `S(p)`, `C(p)` | sine / cosine of one full cycle per unit of p |
| `ease(t)` | smoothstep |
| `seg(p, a, b)` | 0 → 1 over [a, b] |
| `bell(p, a, m, b)` | 0 → 1 → 0 rising over [a, m] and falling over [m, b] |
| `relaxed(o)` | natural arm hang merged with your overrides |
| `locomotion(p, { stride, knee, arm, elbow, bob, lean, twist })` | a full walk/run cycle you can layer on |

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

## Motion capture

Real mocap beats hand keys for realism. `H.clipFromBVHCanonical(retargeter, bvhText, { names })`
retargets BVH files with CMU, Mixamo-style or MakeHuman naming. Only CC0 or properly licensed
BVH may be bundled.
