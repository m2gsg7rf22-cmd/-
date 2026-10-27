# Third-party notices

GameForge AAA bundles the following third-party software. No other third-party code, models,
textures, sounds or fonts are included; all game content is generated procedurally at runtime.

## three.js r180 (0.180.0)
- Location: `engine/vendor/three/` (build files `three.module.js`, `three.core.js` and the
  addons listed in `engine/vendor/three/VERSION.json`)
- License: MIT — full text in `engine/vendor/three/LICENSE`
- Copyright © 2010-2025 three.js authors
- Modifications: addon import specifiers rewritten from `'three'` to relative paths by
  `tools/vendor-three.mjs`; no other changes.

## Development-only (not bundled, optional)
- Playwright (Apache-2.0) is used, if present in the environment, by `tools/playtest.mjs` for
  automated browser testing. It is never shipped with games.

## Ideas and techniques (no code copied)
- `majidmanzarpour/threejs-game-skills` (MIT): director/specialist routing, deterministic test
  hooks, visual scorecard idea. GameForge's implementation is independent.
- `anthropics/skills` (Apache-2.0 / various): SKILL.md format conventions.
- Simplex noise algorithm after Stefan Gustavson's public-domain description; mulberry32 PRNG
  (public domain).
