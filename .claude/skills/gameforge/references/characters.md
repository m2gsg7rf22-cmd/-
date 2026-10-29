# Realistic human characters

GameForge ships a parametric human generator built on the **CC0 MakeHuman 1.x data** (base
mesh hm08, morph targets, 163-bone default skeleton, skin weights, eye proxy, BVH clips),
bundled as `engine/assets/human/human-data.js` (~6 MB). No external tools, models or APIs are
used. Everything runs in the browser and in Node.

Entry point: `engine/humans.js`. It is separate from `engine/index.js`, so games with stylized
characters don't ship the dataset.

## In a game project (default)

`main.js` loads the dataset and passes it to `composeGame`. After that, every `Player`, `NPC`,
`Enemy` and `Actor` is a realistic human:

```js
import * as Humans from './engine/humans.js';
Humans.loadHumanData().then((data) => composeGame(SPEC, { modules, humans: { H: Humans, data } }));
```

- Opt out per game with `SPEC.characters = 'stylized'`, and drop the import to save 6 MB.
- Opt out per character with `look.style = 'stylized'`.
- In hand-written games, call `app.useHumans(Humans, data, { textureSize })`. `textureSize` is
  the skin texture size: 512 on the low tier, 1024 otherwise.

### `look` objects

Both formats are accepted, so old specs keep working:

```js
{ archetype: 'knight', seed: 7 }              // civilian businessperson soldier knight superhero villager wizard athlete biker
{ archetype: 'civilian', seed: 3, sex: 0, heightCm: 168, hair: 'ponytail', hairColor: 0x2a1a10,
  outfit: 'business', skin: 'olive', eyes: { color: 0x3a6a8a }, beard: 'stubble' }
{ outfit: 'armor', top: 0x2e3440, accent: 0xc9a227, hairStyle: 'short' }   // legacy → knight, recoloured
```

`lookToHumanSpec(look)` performs the conversion.
- Legacy outfits map to archetypes: armor→knight, robe→wizard, suit→superhero, casual→civilian.
- `top`, `bottom`, `accent` and `shoes` recolour the matching garments.

## Direct API

```js
const data = await H.loadHumanData();
const human = H.assembleHuman(data, {
  sex: 0..1, age: 18..90, muscle: 0..1, weight: 0..1, heightCm, proportions: 0..1,
  ethnicity: { african, asian, caucasian },            // blend weights
  face: { 'nose/nose-scale-horiz': 0.4, ... },         // H.listModifiers(data) lists all detail modifiers
  body: { 'torso/torso-scale-depth': -0.2, ... },
  skin: 'fair' | { color, freckles, makeup }, eyes: { color },
  hair: 'short'|'long'|'ponytail'|'bun'|'braid'|'buzz'|'mohawk'|'bald'|{ style, color, length, volume, fringe, part },
  beard: 'stubble'|'beard'|null, outfit: 'casual' | [{ type: 'jeans', color }, ...],
  textureSize: 1024, seed });
scene.add(human);
```

`human.userData` contains:

| Field | Description |
|---|---|
| `mesh`, `skeleton`, `bones` | skinned mesh, 163-bone skeleton, bones by name |
| `sockets` | `hand_R`, `hand_L` (grip frames), `head`, `back`, `hip_L`, `hip_R` |
| `height` | stature in metres |
| `retargeter` | retargeting helper (see Animation) |
| `face` | `FaceRig`: `update(dt)`, `speak(seconds)` |
| `setExpression(name, w)` | smile, grin, sad, angry, surprised, fear, disgust, determined, pain; aliases such as happy and scared |
| `garments`, `hair` | the generated clothing and hair meshes |

### Garments and outfits

- **Garment types** (`H.GARMENTS`):
  - Underwear and tops: underwear, tshirt, longsleeve, shirt, hoodie, tanktop, bodysuit.
  - Legwear: pants, jeans, shorts, skirt.
  - Outerwear and full-body: jacket, coat, vest, robe, dress.
  - Footwear: boots, shoes, sneakers. These are a procedural shoe last plus an outsole.
  - Accessories: gloves, belt.
  - Armour: cuirass, pauldrons, vambraces, greaves, helmet.
- **Materials:** cotton, fleece, denim, wool, silk, spandex, leather, canvas, steel.
- **Outfit presets** (`H.OUTFITS`): casual, business, street, biker, soldier, knight, superhero,
  villager, wizard, athlete, dress.

## Animation

- **Engine clips.** `Animator` detects `userData.retargeter` and bakes every engine clip (idle,
  walk, run, attack1, …) onto the 163-bone rig. Use `defineClip` / `CLIP_LIBRARY` exactly as for
  stylized characters.
- **Mocap.**
  `H.clipFromBVHCanonical(human.userData.retargeter, bvhText, { names: 'mixamo'|'cmu'|'makehuman', up: 'y', name, loop })`
  retargets BVH files with any of the known naming schemes. The bundled CC0 clips are in
  `data.poses`: walk, dance, zombieWalk, tpose.
- **IK and ragdoll.** Actors plant their feet on terrain, look at targets, reach, hold weapons
  with two hands and can ragdoll on death. See "Procedural IK, look-at and ragdoll" in
  `animation.md`.
- **Hands.** `retargeter.setHands(gripL, gripR)` curls the fingers.
  `app.humans.create({ ..., armed: true })` sets a weapon grip.

## Verify: the benchmark is the acceptance test

```bash
node tools/bench-characters.mjs        # metrics + inspection sheets → docs/benchmarks/characters/REPORT.md
```

The benchmark checks:
- stature accuracy;
- proportions against anthropometric norms (Winter 2009; de Leva 1996);
- skin weight normalisation, NaNs, floor contact and symmetry;
- determinism, face variation between seeds, and build time.

It also renders lineup, diversity, portrait, expression, walk, run and BVH sheets. Look at the
images. Typical failure signs are hair spikes, clipping garments, crossed or splayed limbs,
wrong skin tones and blank eyes. Fix them in the generator, not per game.

For a quick look at custom characters, open `sandbox/humans.html?who=knight:3,civilian:8`. The
`hair`, `outfit`, `clip`, `bvh`, `exprs`, `phase`, `side`, `cx`/`cy`/`cz` and `fov` parameters
are listed in the file.

## Budgets and limits

- **Size and build time.** A dressed human has about 38–41k triangles and builds in about
  0.5 s on the CPU. Use around 10–20 humans per scene on mid-range hardware. For crowds, use
  `textureSize: 256` and fewer garments, or the stylized mannequin for distant extras.
- **Not photorealistic.**
  - Hair is a textured shell, not strands.
  - Garments are offset shells without cloth simulation.
  - Skin is a baked albedo with a wrap-lighting SSS approximation.
- **Rigid shoes.** Shoes do not bend at the toes.
- **Children are not supported.** The bundled targets are adult only.

## LOD for realistic humans (triangle reduction)
`assembleHuman(data, { ...spec, decimate: 0.3 })` or `H.decimateHuman(human, 0.3)` simplifies the body and every garment with
quadric half-edge collapse (engine/geometry/decimate.js): UVs, seams, borders, skin weights and face morphs survive; underwear
under trousers/dresses is dropped and outer layers are pushed out a few mm so nothing pokes through. Measured on civilian:5:
27.8k body tris → 13.9k (0.5) / 6.9k (0.25), ~1–2 s per template — decimate the crowd *template* once and `cloneHuman()` it.
Suggested ladder: full < 15 m · 0.5 at 15–30 m · 0.25 + `lod:'crowd'` beyond 30 m · impostor/hidden beyond 80 m.
Preview: `sandbox/humans.html?who=civilian:5&decimate=0.25`.

## Cloth: capes, flags, banners (`engine/physics/cloth.js`)
Position-based Verlet cloth (fixed 240 Hz substeps → deterministic, frame-rate independent) with stretch/shear/bend
constraints, long-range tethers (no rubbery stretch), wind with gusts + aerodynamic drag and skin friction, and
sphere / capsule / plane colliders (Object3D or Vector3 ends, so bones work).
```js
const cape = GF.Cloth.cape(human, { length: 1.05, material });   // gathered at the shoulders, body capsules, ground plane
scene.add(cape.mesh); app.add((dt) => cape.update(dt));          // after the mixer/IK so it follows the pose
const flag = new GF.Cloth({ width: 1.8, height: 1.1, segX: 26, segY: 16, pin: 'left', wind: new THREE.Vector3(6, 0, 1.5), frame });
flag.pinTo(pole); flag.addSphere(ball, 0.3); flag.wind.set(…);   // pin: 'top' | 'left' | 'corners' | [indices]
```
Cost: ~1.7 ms/frame (CPU) for a 460-particle flag; budget a few hero cloths per scene, and use `applyWind` vertex
shaders (materials.js) for background flags/foliage. Preview: `sandbox/cloth.html?wind=6&who=knight:3&clip=walk`.
Limits: no self-collision; colliders are spheres/capsules/planes only; garments built by `dress()` stay skinned (not simulated).

## Quick facts
- `sex`: **1 = male, 0 = female**, values in between blend. `characterFromSpec(archetype, seed)` picks it from the seed;
  override with `{ ...H.characterFromSpec('civilian', 4), sex: 1 }`.
- Garment `material`: `cotton | fleece | denim | wool | silk | spandex | leather | canvas | steel`. Differences are in
  weave scale, sheen and roughness — `canvas` and `cotton` read alike from a distance; use `leather`/`silk`/`denim` for a
  visible change, and colour (`color`) for the biggest one.
