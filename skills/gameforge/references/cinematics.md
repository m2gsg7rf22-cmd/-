# Cinematics: cutscenes and in-engine story moments

Write a cutscene as **data**: shots with film grammar and an event timeline. Review it as a
storyboard. Play it in the game with `playCinematic`.

```js
// cinematics/<name>.cine.js
export const env = { timeOfDay: 18.4, sunAzimuth: 250 };       // review lighting
export default async function build({ K, H, humanData, THREE }) {
  const set = /* Group: the location, built with the Modeling Kit or world API */;
  const vex = H.assembleHuman(humanData, { ...H.characterFromSpec('businessperson', 12), textureSize: 512 });
  const kai = /* … */;
  return { set, actors: { vex, kai }, cinematic: { duration: 19, shots: [...], events: [...] } };
}
```

To review a cutscene:

```bash
node $GF/tools/gameforge.mjs cinematic cinematics/<name>.cine.js
```

The command does three things:
- **Lints the grammar:** jump cuts, the 180° rule, shot lengths, gaps, subtitle reading time
  (15 characters per second), unknown actors.
- **Renders a storyboard:** one frame per shot at its midpoint, with labels and the active
  subtitle.
- **Checks every frame:** the subject is in frame and not occluded, and the camera is above
  ground.

**Open the storyboard.** The story must be readable without sound.

In a game:

```js
import { playCinematic } from './engine/gameplay/cinematic.js';
playCinematic(app, def, { actors: { vex: npcActor, kai: playerActor }, onEnd });
```

It drives the camera, letterbox, subtitles, actor clips (`Actor.anim`), expressions, moves,
facing, fades, sfx and music, and emits events. Pause skips it. A key/fill/rim character
lighting rig follows the subject; turn it off with `lighting: false`.

## Shots

`{ name, t, dur, size, subject, other, side, move, amount, fov, height, shake }`, or give
explicit `pos` and `look`.

**Sizes** (relative to subject height):
- `extremeWide`: establish the place;
- `wide` / `full`: the body in its space;
- `medium`: waist up, the dialogue default;
- `closeup`: emotion;
- `extremeCloseup`: eyes or a detail;
- `overShoulder`: dialogue coverage, needs `other`;
- `twoShot`: the relationship, needs `other`.

**Moves:** `static`, `dollyIn` (rising tension), `dollyOut` (isolation, reveal), `orbit`,
`truck` (follow sideways), `crane` (reveal height). `amount` is in metres or radians.

**`side`** (+1/−1) chooses the side of the line between `subject` and `other`. Keep it
consistent across a dialogue: for an OTS on A followed by an OTS on B, flip `side` together
with the subject so the camera stays on one side of the line (the linter checks this).

## Events

| Event | Fields |
|---|---|
| subtitle | `{ t, subtitle, speaker, dur }` |
| clip | `{ t, actor, play: 'clip', upperOnly }` |
| expression | `{ t, actor, expression: 'smile'\|'angry'\|…, weight }` |
| move | `{ t, actor, moveTo: [x, y, z], dur }` |
| facing | `{ t, actor, face: 'otherId'\|[x, y, z] }` |
| sound | `{ t, sfx, pos }` and `{ t, music, intensity }` |
| fade | `{ t, fade: 'in'\|'out', dur }` |
| game event | `{ t, event: 'name' }` |

## The method (how a cinematic director works)

1. **Beat sheet.** List what changes in the scene: who wants what, the turn, the reveal and
   the exit. One idea per shot.
2. **Coverage plan:** establish → two-shot → over-the-shoulder pair → close-ups for turns →
   inserts or cutaways → exit.
3. **Timing.**
   - Shots are 2–6 s; anything above 12 s drags and anything under 0.8 s flashes.
   - Cut on action or on dialogue turns.
   - Hold a reaction for 0.5–1 s after a line.
4. **Performance.** Every line gets an expression or gesture event. Characters face each other
   in dialogue, and moves have a purpose.
5. **Sound.** Music changes at the turn. Add an sfx for every visible action and a fade at the
   ends.
6. **Review loop.** Lint plus storyboard, then fix (at most 5 rounds). Check every frame:
   - Who is the subject?
   - Is the face lit and readable?
   - Does the eye-line match the previous shot?
   - Is the subtitle on screen long enough?

## Limits

Characters perform with procedural clips, retargeted BVH and expression units. There is no
facial mocap or lip-sync from audio, and no depth of field yet. Report cutscenes as authored
and reviewed with a storyboard, not as cinematic-quality animation.
