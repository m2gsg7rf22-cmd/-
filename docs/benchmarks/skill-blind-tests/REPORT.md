# Blind skill tests

A fresh agent (the `3d-artist` role) gets **only** the skill documentation
(`references/modeling.md`, the example scripts) and the tools. It is not told about any built-in
generator for the requested object. It must produce the asset itself through the review loop.

## Test 1: weeping willow (2026-10-28)

The agent produced `skills/gameforge/models/willow.model.js` (now kept as an example).

| Measure | Result |
|---|---|
| Review rounds | 5 (blockout → strands → height/colour → dome silhouette + budget → density/top cover) |
| Final metrics | 9 440 triangles, 2 meshes, 2 materials, W 11.2 × H 8.9 × D 11.4 m, build 183 ms |
| Checks | all pass |
| Seed variation | verified: seed 2 gave a 9.8 m tree with a more upright crown |

![willow](willow.views.jpg)

**Remaining issues the agent self-reported:**
- The crown reads dark from the top.
- The foliage colour is olive under studio light.
- The curtain is somewhat uniform.
- The trunk lacks root flare.
- Cards are not volumetric.

**Skill gaps found → fixed in the same session:**
- card UV orientation undocumented;
- no ribbon/strip helper (`cardStrip`);
- no curve helper (`curve`);
- no per-mesh triangle breakdown;
- unlabeled size axes;
- `pbr` options undocumented;
- open-edge warning on tubes;
- no pendulous-growth recipe;
- `RNG` methods undocumented;
- review sheet: scale figure hidden, top view dark, no eye-level detail view (now 6 views with
  a hemisphere fill light);
- no "fine detail is a texture" budget guidance.
