# Third-party notices

GameForge AAA bundles the following third-party software and data. No other third-party code,
models, textures, sounds or fonts are included; everything else is generated procedurally.

## three.js r180 (0.180.0)
- Location: `engine/vendor/three/` (build files `three.module.js`, `three.core.js` and the
  addons listed in `engine/vendor/three/VERSION.json`)
- License: MIT — full text in `engine/vendor/three/LICENSE`
- Copyright © 2010-2025 three.js authors
- Modifications: addon import specifiers rewritten from `'three'` to relative paths by
  `tools/vendor-three.mjs`; no other changes.

## MakeHuman 1.x assets (CC0 1.0)
- Location: `engine/assets/human/human-data.js` (compiled, compressed subset) with
  `engine/assets/human/LICENSE-CC0.md`.
- Content: base mesh hm08 (body, eyelash/teeth/tongue/hair/skirt/tights helper groups), adult
  macro + detail morph targets, expression units, the `default.mhskel` skeleton (163 bones),
  `default_weights.mhw` skin weights, the high-poly eye proxy and four BVH clips (walk, dance,
  zombie walk, T-pose) from the `makehuman` repository's `makehuman/data` tree.
- License: the MakeHuman project releases these assets under **CC0 1.0** (public domain
  dedication). Compiled by `tools/assets/compile-human.mjs` (pruned, quantised, delta-coded);
  geometry values are otherwise unmodified.
- **No MakeHuman code is used.** The MakeHuman application is AGPL-3.0; GameForge's morphing,
  skeleton fitting, skinning, skin/hair/garment generation and retargeting are independent
  implementations written for this project.

## Development-only (not bundled, optional)
- Playwright (Apache-2.0) is used, if present in the environment, by `tools/playtest.mjs` for
  automated browser testing. It is never shipped with games.

## Ideas and techniques (no code copied)
- `majidmanzarpour/threejs-game-skills` (MIT): director/specialist routing, deterministic test
  hooks, visual scorecard idea. GameForge's implementation is independent.
- `anthropics/skills` (Apache-2.0 / various): SKILL.md format conventions.
- Simplex noise algorithm after Stefan Gustavson's public-domain description; mulberry32 PRNG
  (public domain).
