# Modelling any 3D asset

You can create any 3D asset in code: trees, rocks, furniture, weapons, creatures, buildings,
vehicles, props. Do not search for a pre-made model. Write a **model script**, review it
visually, and iterate until it passes the checklist.

```js
// assets/lantern.model.js
export default function build(K, params) {   // K = engine/modeling/index.js
  ...
  return K.finish(K.ground(group), { kind: 'prop' });
}
```

To review a script:

```bash
node $GF/tools/gameforge.mjs model assets/lantern.model.js [--params '{"seed":2}'] [--glb]
```

The command:
- prints metrics and checks (triangles, size in metres, NaN, degenerate triangles, open edges,
  materials);
- writes `review/<name>.views.jpg`, a sheet with front, right, 3/4 and top views, a 1 m (or
  10 cm) grid, and a 1.75 m human silhouette for scale.

For a whole scene (terrain, vegetation, buildings, props) use
`node $GF/tools/gameforge.mjs scene <file.scene.js>`. It renders an aerial overview plus three
eye-level shots taken at 1.7 m from clear standing spots, and checks the scene budgets
(triangles, draw calls, lights). Scene scripts get `K.world` (Heightfield, terrainMesh,
populate, instanceProp, createWater, generateCity), `K.PROPS`, `K.BUILDINGS`, `K.car` and
`K.generateTree`. See `skills/gameforge/scenes/forest-clearing.scene.js`.

**Always open the image and critique it before using the asset.** In a game, load the script
the same way: `import build from './assets/lantern.model.js'; scene.add(build(K, {...}))`.

Worked examples are in `skills/gameforge/models/`:

| Example | Technique it teaches |
|---|---|
| `scifi-rifle` | hard-surface lofts, insets, emissive strips, sockets, grip-origin |
| `willow` | pendulous strands with `cardStrip` |
| `tree-lsystem` | grammar-driven branching, tubes, leaf cards |
| `boulder` | SDF sculpt, ridged noise, flat base |
| `armchair` | hard-surface blockout, lathe, mirrored parts |
| `creature` | organic SDF character, mirrorX, eyes |

Read the one closest to your task first.

## The method (what a professional modeller does)

1. **Brief and reference.** Write down, in a comment at the top of the script:
   - the real-world size in metres;
   - the silhouette in a few words ("squat, wide base, tapering, leaning left");
   - 3–5 defining features;
   - the materials;
   - the triangle budget (see the table below).

   If the user named a style (realistic, stylized, low-poly), state it.
2. **Proportions first.** Decide the key dimensions as variables (`const H = 1.8, seatH = 0.45`),
   using real measurements. Common ones:

   | Object | Dimension |
   |---|---|
   | door | 2.0–2.1 × 0.9 m |
   | chair seat | 0.45 m high |
   | table | 0.75 m |
   | counter | 0.9 m |
   | stair riser / tread | 0.17 / 0.28 m |
   | sedan | 4.7 × 1.85 × 1.45 m |
   | adult human | 1.6–1.9 m |
   | oak | 15–25 m; game trees 6–12 m |
   | sword | about 1 m |
   | rifle | 0.85–1.0 m long, receiver about 6 cm wide |
   | pistol | 0.18–0.22 m long |
   | weapon grip | about 0.12 × 0.03 m, about 10–15° rake |
   | magazine | 0.15–0.25 m |
   | coin | 2.5 cm |

3. **Blockout (primary forms).** Build only the big masses, then review. Fix the silhouette and
   proportions now; detail never rescues a bad blockout.
4. **Secondary forms.** Add bevels, rounding, insets, cut-outs, panel lines, branch forks,
   muscle masses and folds. Review again.
5. **Tertiary detail.** Add surface noise, rivets, bark, small leaves, decals and wear, mostly
   through materials, normal detail, displacement or cards rather than triangles.
6. **Materials.** Use one material per real surface type. Prefer `K.pbr(kind, { color, repeat })`
   with the kinds in `K.TEXTURE_KINDS`. Use plausible albedo:
   - no pure black or white;
   - roughness above 0.3 except metal, glass and lacquer.
7. **Review loop.** Run `gameforge model`, look at all four views, and answer the checklist
   below. Fix the script and re-run. Stop when every answer is yes, or after five rounds;
   report the remaining issues honestly.
8. **Integrate.** Ground the asset (`K.ground`), centre it, set the collider (`K.finish`), keep
   the material count low, and use instancing for repeats (`world/vegetation.js instanceProp`).

## Choosing the technique

| Shape family | Tool in K | Notes |
|---|---|---|
| Organic, sculpted, blobby (rocks, creatures, mushrooms, food, clay, cliffs, caves) | SDF: `sphere ellipsoid capsule box torus cylinder` + `smoothUnion/smoothSubtract/mirrorX/noiseDisplace/cut` → `meshSDF` | `smoothUnion` k = blend radius in metres. Resolution 48 for preview, 96–128 for hero. Cost grows with resolution³ |
| Branching (trees, roots, coral, antlers, veins, lightning, cracks) | `lsystem` + `turtle`, or `spaceColonization` + `sampleVolume`; `skinBranches` | Taper radius with depth (`!`, `radiusDecay`). Gravity or light via `tropism` |
| Thin or fine detail (leaves, needles, grass, fur, hair clumps, feathers, fences, chains) | `paint` → `cardTexture` / `cardMaterial` + `cards` | Bend normals around the volume centre (`normalBlend` 0.6–0.8) |
| Turned or rotational (bottles, columns, legs, wheels, vases, lamps) | `lathe(profile)` | The profile is `[radius, y]` from bottom to top |
| Extruded or swept (pipes, cables, rails, horns, tentacles, ropes) | `tube(points, r)`, `skinBranches` with radii | Use Catmull-Rom paths for smooth curves |
| Lofted bodies (vehicles, boats, aircraft, bottles, armour plates) | `loft(sections)`, `smoothLoft`, `superRing`, `profileRing` | Profile-driven like `geometry/vehicles.js` |
| Hard-surface (furniture, crates, machines, buildings, weapons) | `roundedBox`, `MeshBuilder.add(geo, mat, mat4(pos, rot, scale))`, `mirrorMerge`, `boxUV` | Bevel everything (0.5–3 cm). Perfectly sharp edges read as CG |
| Terrain or rocky detail on any mesh | `displace(geo, { amount, frequency })` | Displace after subdividing enough |

You can combine techniques. For example, an SDF trunk base with branching limbs and leaf cards,
or a lofted hull with hard-surface fittings.

## Review checklist (answer each one while looking at the sheet)

1. **Silhouette:** is the object recognisable from the front and the 3/4 view alone? Is it
   specific, not generic?
2. **Scale:** compared with the 1.75 m figure and the grid, are the dimensions right?
3. **Proportions:** do the key ratios match the brief and real references?
4. **Primary / secondary / tertiary:** are all three levels present? Big shapes should read
   first, then medium details, then fine texture.
5. **Surface:** check for facet stair-steps, grid artifacts, smeared or stretched UVs,
   z-fighting, and holes where solid. `openEdges` should be 0 for solid SDF or lofted meshes.
6. **Materials:** plausible colour and roughness, different surface types differentiated, no
   flat untextured walls on large surfaces.
7. **Grounding:** it rests on y = 0, nothing floats, and it is centred.
8. **Budget:** within the triangle budget and with 8 materials or fewer.
9. **Variation:** if it will be repeated, do `seed` and params produce visibly different
   instances?

## Kit reference details (read before your first script)

- **Sizes** print as `W × H × D` = x (width) × y (height, up) × z (depth, the model's forward
  axis is +Z). The metrics JSON has a `perMesh` triangle/material breakdown.
- **The review sheet** has six views: front, right, 3/4, back, top and detail (eye level,
  close). The 1.75 m figure stands at the front-left corner, outside the bounds.
- **`K.pbr(kind, opts)`** options:
  - **Shared:** `repeat` (number or [u,v]), `normalScale`, `tint`, `envMapIntensity`,
    `emissiveIntensity`, `physical`, `side`, `transparent`, `opacity`, `size` (texture px),
    `seed`.
  - **Recipe options**, passed through to the texture recipe: `color`, `color2` (secondary
    tone), plus per-kind keys:
    - `brick`: `mortar`, `mortarColor`, `rows`/`cols`;
    - `planks`: `planks`;
    - `tiles`: `tiles`;
    - `facade`: `panels`, `windowW`, `windowH`, `frameColor`, `glass`, `litRatio`;
    - `paintedMetal`: `rust`;
    - `fabric`: `weave`, `stripe`;
    - `cobble`/`rock`: `moss`;
    - `asphalt`: `lanes`.

  Unknown keys are ignored. The kinds are listed in `K.TEXTURE_KINDS`.
- **Untextured surfaces:** `K.polymer(c)`, `K.rubber(c)`, `K.chrome(c)`, `K.anodized(c)` and
  `K.ceramic(c)` cover gun furniture, plastics, tyres and grips.
- **Other material signatures:**
  - `K.solid(color, { roughness, metalness, emissive, emissiveIntensity, flat, vertexColors, transparent, opacity, side })`
  - `K.emissive(color, intensity = 3)` for glow strips, screens and lamps.
  - `K.glass({ color, opacity = 0.35, roughness = 0.05 })` for lenses, windows and visors.
  - `K.carPaint(color, { metallic, flakes })`
- **`new K.RNG(seed)`** (a class: always `new`; always seed everything):
  - `next()`, `range(a, b)`, `int(a, b)` (inclusive), `chance(p)`, `pick(arr)`, `sign()`;
  - `gaussian(mean, sd)`, `shuffle(arr)`, `weighted([[value, weight], …])`, `fork(salt)`
    (an independent stream per feature).

  `K.Noise(seed).noise3(x, y, z)` returns values in −1…1.
- **Curves:** `K.curve(controlPoints, { samples, radius: [r0, r1] })` returns
  `{ points, radii }`, a smooth Catmull-Rom path. Feed it to
  `skinBranches([{ points, radii }])`, `cardStrip(points)` or `tube(points, r)`.
- **Card UVs:**
  - `paint()` uses pixel coordinates with v = 0 at the top row of the image.
  - `cards()` puts v = 1 at the card base (`pos`) and v = 0 at its tip, so paint stems at the
    bottom of the texture. This holds for hanging cards too (base at the branch), so no flip is
    needed.
- **Strips:** `cardStrip(points, { width, tile, taper, twist, side })` builds a continuous
  ribbon along a path. v accumulates `distance / tile`, so build its material with
  `cardMaterial(tex, { repeat: true })` (that sets RepeatWrapping). Use it for vines, weeping
  strands, hair locks, kelp, banners, moss, tails and chains.
- **Open meshes:** tubes from `skinBranches`/`cardStrip` and alpha cards are intentionally open
  and are skipped by the closed-mesh check. Mark your own intentionally open geometry with
  `geo.userData.open = true`.
- **Fine detail is a texture, not geometry.** Twigs, needles, leaf veins, fur, rivets and
  stitching go into the card texture or the material. Keep geometry for silhouette-relevant
  forms (trunk, limbs, main masses). When you hit the budget, reduce tube sides
  (`radialFor`: 6 for thick limbs, 3–4 for thin ones) before cutting foliage coverage.

## Builder axes (which way things point, how to aim them at +Z)

| Builder | Built along | To point along +Z |
|---|---|---|
| `lathe(profile)` | Y; profile `[radius, y]` | `geo.rotateX(Math.PI / 2)` |
| `THREE.CylinderGeometry` / `CapsuleGeometry` | Y | `rotateX(Math.PI / 2)` |
| `tube(points, r)`, `skinBranches`, `curve` | along your points | — (design the points along +Z) |
| `loft(sections, { axis: 'z' })` (default) | sections at `z`, ring points `[x, y]` | — |
| `loft(..., { axis: 'y' })` | sections stacked in Y; a ring point `[a, b]` lands at (a, *, −b) | rotate as needed |
| `roundedBox(w, h, d)` | centred box: w = X, h = Y, d = Z | — |
| `MeshBuilder.add(geo, mat, mat4(pos, rot, scale))` | `rot` = Euler XYZ radians | — |

## Origins, sockets and grounding

- **Default origin:** the base at y = 0, centred in XZ (`K.ground`). The model faces +Z.
- **Held or attached assets** (weapons, tools, torches): put the **grip at the origin**, with
  +Z the pointing or muzzle direction and +Y up. Pass `--params '{"floating":true}'` to the
  review so the grounding warning is skipped. The grid is then drawn under the object, which is
  purely visual.
- **Sockets.** `K.socket(obj, name, pos, dir)` adds an oriented child and lists it in
  `obj.userData.sockets`. Standard names:

  | Asset | Socket names |
  |---|---|
  | Weapons | `grip`, `muzzle`, `offHand`, `sight` |
  | Vehicles | `seat`, `door_L`, `door_R`, `exhaust` |
  | Props | `top`, `handle` |

  A character holds a weapon with `human.userData.sockets.hand_R.add(weapon)`. Because the grip
  is at the origin, no offset is needed.
- **Review flags:**
  - `--no-ref` hides the 1.75 m figure. Small props (under about 1.2 m) hide it
    automatically and use a 10 cm grid.
  - `--yaw <deg>` rotates the asset for the review only.
  - The eye-level detail view looks at the broad side of long objects automatically.

## World API for scene scripts (exact signatures)

- **`new K.world.Heightfield({ size = 512, resolution = 256, seed, height = 40, type, waterLevel = 0, flatten, roads, island, base, generator })`**
  - `type` is `'hills' | 'mountains' | 'dunes' | 'flat'`.
  - `flatten` is a list of `[{ x, z, radius, height, falloff } | { x, z, rect: [w, d], height, falloff }]`.
  - `roads` is a list of `[{ points: [[x, z], …], width, falloff }]`; this shapes the ground only.
  - `generator(x, z, noise)` returns a height and overrides `type`; use it for coasts, valleys and
    plateaus.
  - Methods: `heightAt(x, z)`, `normalAt(x, z)`, `slopeAt(x, z)` (0 = flat … 1 = vertical),
    `inBounds(x, z, margin)`, `flattenArea({ x, z, radius | rect, height, falloff })`,
    `carveRoad({ points, width })`, `raycast(origin, dir)`.
- **`K.world.terrainMesh(hf, { palette: { grass, grass2, rock, dirt, sand }, …terrainMaterial opts })`**
  - Build it **after** every `flattenArea`/`foundation`.
  - `terrainMaterial({ waterLevel, snowLine = 60, sandBand = 2.5, scale, palette })`. With a
    custom `generator`, set `snowLine` high (e.g. 999) unless you want snow.
- **`K.world.createWater({ size, level, color, deep, heightfield: hf })`**
  - Set `size` ≈ `hf.size`; the default 2000 inflates the scene bounds.
  - It assumes the heightfield is centred at (0, 0). Keep the terrain at the origin and move the
    *composition*, not the terrain.
- **`K.world.populate(hf, { seed, trees, rocks, bushes, grass, species, exclude, treeMaxHeight, palette, grassRadius })`**
  returns `{ group, colliders }`. `species` comes from `K.TREE_SPECIES`.
- **`K.world.scatterPoints(hf, rules, rng)`** with rules `{ count, minHeight, maxHeight, maxSlope = 0.35, exclude, density: (x, z) => 0..1, scale: [a, b], spacing, margin }`.
  - `exclude` items are `{ x, z, r }` or `{ x, z, rect: [w, d], pad }`.
  - `density` gives gradients: dense at the forest edge, open at the village centre.
- **Placement helpers** (`engine/world/placement.js`):

  | Helper | What it does |
  |---|---|
  | `K.place(obj, hf, x, z, { yaw, align = 0, sink = 0.05 })` | sets y on the ground; `align` 0.6–1 tilts rocks, boats and debris to the slope |
  | `K.foundation(hf, x, z, w, d, { pad = 2, falloff = 4 })` | flattens a level pad at the highest corner and returns its height (call before `terrainMesh`) |
  | `K.pathStrip(hf, [[x, z], …], { width, kind = 'dirt' \| 'cobble' \| 'asphalt', color })` | a visible path draped on the terrain; pair it with `roads`/`carveRoad` to shape the ground |
  | `K.scatter(hf, prop, rules, { seed, align })` | instanced copies of any prop (lamps, fences, crates, rocks) |
  | `K.groundAudit(root, hf)` | lists floating or buried tagged assets |

- **`K.BUILDINGS`:**
  - `house({ width = 7, depth = 6, seed, wallColor, roofColor, style = 'cottage' })`
  - `shop({ width, depth, floors, seed, awning })`
  - `tower({ width, depth, floors, seed, style = 'modern', night })`
- **`K.PROPS`:**
  - nature: `tree`, `rock`, `bush`;
  - containers and furniture: `crate`, `barrel`, `chest`, `bench`, `stall`, `well`, `fence`;
  - lights and structures: `lampPost({ withLight })`, `torch`, `pillar`, `stoneWall`;
  - weapons and pickups: `sword`, `axe`, `shield`, `staff`, `pickup`;
  - street items: `trafficCone`, `hydrant`, `trashBin`, `trafficLight`, `barrier`.

  Prefer `withLight: false` with emissive lamps; the engine's light pool lights the nearest
  anchors.
- **Scene review options:**
  - **Time of day:** `export const env = { timeOfDay: 18.6, sunAzimuth: 250 }` in the scene
    script, or `gameforge scene … --time 18.6 --sun-azimuth 250`.
  - **Cameras:** set `root.userData.review = { focus: [x, y, z], cameras: [{ pos, look }] }`
    to choose the focus and up to three eye shots. Automatic eye shots pick the clearest of 40
    candidates around the focus, avoiding foliage and walls.
  - **Ground audit:** set `root.userData.heightfield = hf` to enable the floating/buried check.
  - **Budget:** keep the material count at 60 or fewer by reusing materials.

## Recipes for common hard cases

- **Insets, vents, panel lines, ports (hard-surface without booleans):** there are no mesh
  booleans. Use one of these:
  - **Shallow details:** a dark recessed strip, i.e. a thin `roundedBox` in a dark `trim`
    material, sunk 0.5–1 mm *into* the surface so only its face shows flush. Use 1–2 mm wide
    lines for seams, and slats spaced by their own width for vents.
  - **Real openings:** build the part from frames around the hole, i.e. 4 boxes around an
    ejection port, or `loft` a ring profile.
  - **Organic parts:** use SDF `subtract` / `smoothSubtract` and then `meshSDF`.

  Raised armour plates must be at least 2–3 mm proud and have bevels, or they vanish at
  gameplay distance.

- **Pendulous / weeping growth** (willow, wisteria, vines, hanging moss, tentacles):
  - **Structure:** build ascending limbs first. Limb rise should be inversely proportional to
    reach, so steep central limbs and wide low ones make a dome.
  - **Strands:** hang them from points along the outer secondaries with
    `curve([attach, attach + outward·0.3 + down·L/2, attach + down·L])`, with
    `L = clamp(heightAboveGround − 0.3, 1, 6)`, so outer strands nearly reach the ground and
    inner ones are shorter.
  - **Skinning:** draw each strand with `cardStrip` (0.3–0.5 m wide, tiling whip texture,
    `taper: [1, 0.6]`).
  - **Crown cover:** add a few flat cards over the crown top so it doesn't look hollow from
    above.
- **Crown shape from limb reach:** decide the silhouette (dome, column, vase, umbrella) as an
  envelope function `r(y)`. Set each limb's length so its tip lands on the envelope, or use
  `spaceColonization` with attractors sampled inside the envelope.
- **Faces / bilateral things:** sculpt the right half and apply `mirrorX`. Break symmetry
  afterwards with small displacements; perfect symmetry reads as CG.
- **Worn hard-surface:** use `roundedBox` bevels, then `displace` with a low amount on the large
  panels, then a pbr kind with `rust`/`moss`/`color2` variation.

## Triangle budgets (per asset, desktop WebGL)

| Asset class | Budget |
|---|---|
| Hero prop or creature | 10–60k |
| Hero weapon (first/third person) | 8–20k |
| Vehicle | 15–30k |
| Tree (near) / tree (forest, instanced) | 5–10k / 0.5–2k |
| Building | 2–15k |
| Small prop | 0.2–3k |
| Rock | 0.5–5k (instanced) |

Use `detail: 'low'` style params for distant copies.

## Making models animatable

- **Rigid parts:** keep them as separate child meshes (wheels, doors, turrets, eyelids) and
  animate their transforms.
- **Skinned creatures:** sculpt the creature in a T-pose or A-pose, then bind it to a skeleton.
  See the humans pipeline in `references/characters.md` and `engine/animation/retarget.js` for
  canonical clips.
- **Wind:** card materials from `cardMaterial` have `userData.wind = true` and sway when
  instanced via `instanceProp`.

## Honest limits

The output is procedural geometry with procedural textures. It can reach good stylized-realistic
quality, but:
- there are no scanned textures, baked ambient occlusion or normal maps from high-poly bakes;
- SDF meshes are dense, so watch the budget;
- card foliage is not volumetric.

Do not call an asset photorealistic. Show the review sheet as evidence.
