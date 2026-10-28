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

**Always open the image and critique it before using the asset.** In a game, load the script
the same way: `import build from './assets/lantern.model.js'; scene.add(build(K, {...}))`.

Worked examples are in `skills/gameforge/models/`:

| Example | Technique it teaches |
|---|---|
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

## Triangle budgets (per asset, desktop WebGL)

| Asset class | Budget |
|---|---|
| Hero prop or creature | 10–60k |
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
