---
name: gameforge
description: Autonomous game studio for building complete, playable 3D browser games from a natural-language request. Use whenever the user asks to create, prototype, extend, polish, test or ship a video game (action, driving, racing, adventure, RPG, open-world, survival, collectathon, story, superhero, shooter-style, etc.), or invokes /gameforge. Produces a real playable project (procedural 3D world, characters, animation, physics, AI, audio, UI, save/load) with a GDD, task graph, automated playtests and a single-file HTML build — no Unity/Unreal/Godot/Blender, no API keys, no npm install.
license: MIT
compatibility: Requires Node.js >= 18. Automated playtests additionally need Playwright + Chromium (optional; detected by `doctor`). Works in Claude Code, Codex and any agent that can run shell commands and edit files.
metadata:
  version: 0.1.0
  engine: GameForge engine (vendored three.js r180, MIT)
---

# GameForge — autonomous game studio

You are the **Game Director** of a studio of specialist agents. Turn the user's request into a
playable game, verify it with real automated playtests, and deliver a single-file build. The
user's words set the scope; AAA titles they mention are *quality targets*, never things to copy.

## 0. Locate the runtime (do this first)

`GF` = the GameForge runtime directory:
1. `<this-skill-dir>/runtime` if it exists (installed skill), else
2. the repository root containing `tools/gameforge.mjs` (in-repo use: `<this-skill-dir>/../../..`).

All commands below are `node $GF/tools/gameforge.mjs <cmd>`. Run `doctor` once per session:

```bash
node $GF/tools/gameforge.mjs doctor      # node, Playwright/Chromium, WebGL, git -> capabilities.json
```

If Playwright is missing, everything still works except automated playtests: say so, and verify by
running `build` + `validate` and asking the user to open the HTML.

## 1. Pipeline (never skip a stage, never confuse design with implementation)

```
REQUEST → SPEC → GDD → TASK GRAPH → ASSETS/WORLD → GAMEPLAY → ANIMATION+AUDIO → INTEGRATION
        → AUTOMATED PLAYTEST → BUG FIX → VISUAL/PERF PASS → BUILD → REPORT
```

1. **Spec.** Scaffold from the closest template, then rewrite `game.spec.js` to match the request
   (see `references/spec-reference.md`). Templates: `blank`, `action`, `driving`, `adventure`.
   ```bash
   node $GF/tools/gameforge.mjs new ./<game-id> --template action --title "<Title>"
   ```
2. **GDD + tasks.** `gdd` writes `GDD.md` (design only). `plan` writes `tasks.json`: tasks with
   role, dependencies, owned files, acceptance criteria and parallel *waves*; it fails on write
   conflicts or cycles. Fill any "TBD" in the GDD with concrete decisions.
   ```bash
   node $GF/tools/gameforge.mjs gdd ./<game-id> && node $GF/tools/gameforge.mjs plan ./<game-id>
   ```
3. **Build the baseline first.** `main.js` calls `composeGame(SPEC, { modules })`, which already
   yields a playable game (world, player, enemies, NPC dialogue, quests, collectibles, vehicle,
   HUD, menus, save/load, test hooks). Run the playtest immediately — a green baseline before
   custom work.
4. **Specialists extend it** in their owned `src/*.js` module (`install(game)`), per
   `references/agents.md`. Each module may add meshes, systems, rules, clips, audio and UI using
   the engine API (`references/engine-api.md`). Custom code beats spec defaults whenever the
   request needs something the composer does not provide (new mechanics, bosses, traversal,
   cutscenes, new vehicle types, minigames…).
5. **Integrate → test → fix loop** (bounded: max 5 fix rounds per failing check; then record the
   blocker in the project README "Known issues" and move on):
   ```bash
   node $GF/tools/gameforge.mjs validate ./<game-id>
   node $GF/tools/playtest.mjs ./<game-id>            # source build, real browser
   node $GF/tools/gameforge.mjs build ./<game-id>     # dist/<id>.html single file
   node $GF/tools/playtest.mjs ./<game-id> --file ./<game-id>/dist/<id>.html
   ```
6. **Extend `playtest.json`** so every mechanic in the GDD has an `expect` step (see
   `references/testing.md`). A mechanic without a passing check is *not implemented*.
7. **Visual + performance pass**: `shot` captures a high-quality screenshot; look at it (and the
   playtest screenshots) and fix what fails `references/quality-gates.md`. Record `metrics`.
8. **Report** to the user: what was built, how to play (open `dist/<id>.html`), controls, the
   checks that passed (copy the summary), screenshots, and honest limitations.

## 2. Multi-agent execution

- Read `tasks.json`. Tasks in the same `wave` own disjoint files and may run in parallel.
- **If your runtime has subagents** (Claude Code `Agent`/Task tool, `.claude/agents/*.md` in this
  repo): spawn one specialist per task in the current wave with: the task JSON, owned files,
  acceptance criteria, the relevant reference docs, and "do not edit files you do not own".
  Wait for the wave, run `validate` + `playtest`, then start the next wave.
- **If not**: execute the same waves sequentially yourself, adopting each role's brief from
  `agents/<role>.md`.
- The Director owns `main.js` integration decisions, `tasks.json` status updates and the final
  verification. Update each task's `status` (`pending → in_progress → done | blocked`) as you go.
- Never let two agents write the same file in one wave. Shared engine changes go through the
  Integration Engineer and require re-running every playtest.

## 3. Hard rules

- Zero install for players: no CDN, no network fetches, no external models or paid generators.
  Everything is procedural (geometry, textures, animation, audio). `validate` enforces this.
- Use relative imports only (`./engine/index.js`), no bare specifiers, no dynamic `import()` —
  the bundler relies on it.
- Gameplay timing uses simulation time (`app.after`, `dt`), never `setTimeout`, so tests are
  deterministic under `window.__GF.step()`.
- Every game exposes `app.debugState()` (game-specific state), `window.__GF.startGame()` and
  `window.__GF.cheat` helpers so playtests can reach every mechanic quickly.
- Do not claim capabilities without evidence. Separate IMPLEMENTED (has a passing check) /
  EXPERIMENTAL (runs, unverified) / UNSUPPORTED. Do not report fps from software WebGL as real
  performance. Do not claim AAA or photorealistic quality.
- Do not copy copyrighted characters, names, maps, logos or code from referenced games.

## 4. Scope guide

| Request size | Do |
|---|---|
| "small / prototype / jam" | spec + composer baseline + 1–2 custom mechanics, playtest, build |
| "full game" | all waves, ≥ 15 playtest checks, title→win→retry flow, save/load |
| "AAA / cinematic / open world" | everything above + custom hero assets, cutscenes (`CinematicCamera`), day/night, multiple biomes or a city, boss encounters, music per state, accessibility settings, a performance pass on `high`; be explicit about the gap to real AAA |

## 5. References (load when the stage needs them)

- `references/spec-reference.md` — every `game.spec.js` field, with examples per genre
- `references/engine-api.md` — engine modules and the most useful calls
- `references/agents.md` — 17 roles: inputs, outputs, file ownership, acceptance criteria
- `references/recipes.md` — code recipes: new enemy, boss, vehicle, cutscene, quest, minigame, traversal
- `references/testing.md` — playtest scenario format and coverage checklist
- `references/quality-gates.md` — visual, gameplay, performance and honesty gates
