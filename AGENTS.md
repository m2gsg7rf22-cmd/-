# AGENTS.md — instructions for coding agents (Codex and others)

This repository is **GameForge AAA**: a skill + zero-install toolkit for building playable 3D
browser games. If you are asked to make a game, follow `skills/gameforge/SKILL.md` exactly (it
is runner-agnostic). Runtime directory `GF` = this repository root.

Quick start:
```bash
node tools/gameforge.mjs doctor
node tools/gameforge.mjs new ./my-game --template action --title "My Game"
node tools/gameforge.mjs gdd ./my-game && node tools/gameforge.mjs plan ./my-game
node tools/playtest.mjs ./my-game
node tools/gameforge.mjs build ./my-game     # -> my-game/dist/<id>.html
```

Role briefs for the 17 specialists are in `skills/gameforge/agents/*.md`. If your runner cannot
spawn subagents, execute `tasks.json` waves sequentially, adopting each role's brief.

## Working on the toolkit itself
- Engine code is browser ES modules under `engine/` using **relative imports only** (the bundler
  rejects bare specifiers and dynamic `import()`).
- Run `npm test` (unit) and `node tools/report.mjs` (all playtests + dist builds) before committing.
- Never add network dependencies to games; vendored three.js lives in `engine/vendor/three`
  (refresh with `node tools/vendor-three.mjs <three-package-dir>`).
- After editing `tools/lib/agents-def.mjs` or `skills/gameforge/*`, run `node tools/build-skill.mjs`.
