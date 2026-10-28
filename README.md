# GameForge AAA

An **Agent Skill + zero-install technology stack** that gives Claude Code (and other coding
agents) the abilities of an autonomous game studio. You describe a game in one prompt; a
Director agent plans it (spec → GDD → task graph), 17 specialist agents build it with real,
reusable engines and generators, and automated playtests verify it. The output is a single HTML
file that runs offline.

No Unity, Unreal, Godot, Blender, external AI services, API keys or `npm install`.

> Status: v0.2. The product is the skill and its technology. The games in `examples/` are
> integration tests, not the product. Read [LIMITATIONS.md](LIMITATIONS.md) before judging
> fidelity: the results are **not** AAA or photorealistic, and this README claims nothing that
> isn't backed by a test or benchmark in this repository.

## Install (one command)

```bash
curl -fsSL https://raw.githubusercontent.com/m2gsg7rf22-cmd/-/gameforge-aaa/install.sh | sh
```

The installer needs `git` and Node.js 18 or newer. It installs:
- the skill and its runtime into `~/.claude/skills/gameforge` and `~/.agents/skills/gameforge` (Codex);
- the 17 specialist subagents into `~/.claude/agents`.

Then, in Claude Code:

```
/gameforge an open-world superhero game in a night city with swinging, a villain and side missions
```

Inside a clone of this repository, nothing needs installing: `.claude/skills` and
`.claude/agents` are checked in. Optionally, install Playwright to enable automated browser
playtests (`npm i -g playwright && npx playwright install chromium`); `doctor` detects it.

## What's inside

| Layer | Where | What |
|---|---|---|
| Skill | `skills/gameforge/` | SKILL.md pipeline, references (spec, engine API, characters, recipes, testing, quality gates) and 17 role briefs with inputs, outputs, file ownership and acceptance criteria |
| Agents | `.claude/agents/`, `tools/lib/agents-def.mjs` | Director plus 17 specialists. They run in parallel waves with file ownership; runners without subagents execute the waves sequentially |
| Engines | `engine/` | browser ES modules on vendored three.js r180 (see the table below) |
| Tools | `tools/` | `gameforge.mjs` (doctor, new, gdd, plan, validate, serve, playtest, build, shot, export, status), single-file bundler, Playwright playtest runner, benchmarks, skill packager |
| Tests | `tests/unit/`, `examples/*/playtest.json`, `docs/benchmarks/` | unit tests, scripted playtests, and quality benchmarks with inspection images |
| Examples | `examples/` | 4 demo games and a recipes lab, used as integration tests |

### Engines

| System | Modules | Evidence |
|---|---|---|
| Character generation | `engine/humans.js`, `engine/character/*` | Realistic parametric humans built from **CC0 MakeHuman data**: body/face morphs, exact stature, 163-bone rig, baked skin + SSS, eyes, expressions, hair, garments, shoes, archetypes. Verified by [character benchmark](docs/benchmarks/characters/REPORT.md) and `tests/unit/humans.test.mjs` |
| 3D modelling | `engine/geometry/*` | Loft/lathe/tube builders, props, buildings and [vehicles v2](docs/benchmarks/vehicles/REPORT.md) (9 types), GLB/OBJ export |
| Animation & rigging | `engine/animation/*` | Procedural clip library, layered animator, retargeting onto any rig, BVH mocap import |
| World generation | `engine/world/*` | Heightfield terrain, roads, vegetation, water, procedural city with traffic |
| Rendering & materials | `engine/render/*` | PBR, procedural seamless textures, physical sky, day/night cycle, post-processing, light pool, quality tiers |
| Physics & gameplay | `engine/physics/*`, `engine/gameplay/*` | Character controller, raycast vehicle, combat, traversal (swing/glide), inventory, progression, save/load |
| Narrative & quests | `engine/gameplay/narrative.js`, `tools/lib/design.mjs` | Dialogue scripts with branching and flags, typed quest chains, GDD and task-graph generation |
| NPC intelligence | `engine/ai/*` | Behaviour trees, FSM, perception, steering, A*, attack tokens, traffic |
| Audio | `engine/audio/*` | Synthesized SFX, engine/ambience loops, adaptive music |
| QA & visual evaluation | `tools/playtest.mjs`, `tools/report.mjs`, `tools/bench-*.mjs` | Deterministic playtests via `window.__GF`, dist-build tests, anthropometric and geometry metrics, inspection sheets |

The full status of every capability is in [CAPABILITIES.md](CAPABILITIES.md), marked
TESTED / IMPLEMENTED / EXPERIMENTAL / UNSUPPORTED.

## Quick start without an agent

```bash
node tools/gameforge.mjs doctor
node tools/gameforge.mjs new ./my-game --template action --title "My Game"
node tools/gameforge.mjs gdd ./my-game && node tools/gameforge.mjs plan ./my-game
node tools/playtest.mjs ./my-game
node tools/gameforge.mjs build ./my-game          # -> my-game/dist/<id>.html
```

To verify quality:

```bash
npm test                                   # unit tests
node tools/report.mjs                      # all example playtests (source + dist) -> TEST_RESULTS.md
node tools/bench-characters.mjs            # human quality metrics + inspection sheets
node tools/bench-vehicles.mjs              # vehicle metrics + renders
```

For visual inspection, open `sandbox/humans.html?who=knight:3,civilian:8` and
`sandbox/vehicles.html?types=sedan,suv,truck`.

## Documentation

- **Design:** [ARCHITECTURE.md](ARCHITECTURE.md) explains the design and decisions;
  [docs/RESEARCH.md](docs/RESEARCH.md) covers the technology evaluation.
- **Status:** [CAPABILITIES.md](CAPABILITIES.md) and [LIMITATIONS.md](LIMITATIONS.md) give the
  honest status; [TEST_RESULTS.md](TEST_RESULTS.md) holds the latest generated test results.
- **Planning:** [ROADMAP.md](ROADMAP.md) lists what's next; [PROGRESS.md](PROGRESS.md) is the
  resume point for agents.
- **Running it:** [docs/PORTABILITY.md](docs/PORTABILITY.md) covers Claude Code, Codex and other
  runners; [AGENTS.md](AGENTS.md) holds instructions for coding agents.

## Licenses

GameForge code is MIT ([LICENSE](LICENSE)). It bundles:
- three.js (MIT);
- MakeHuman 1.x **assets** under CC0 (no MakeHuman code is used).

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Publication

Creating a new public repository was blocked from the build environment (GitHub returned
`403 Resource not accessible by integration`). The project is therefore published on the
`gameforge-aaa` branch of `m2gsg7rf22-cmd/-`.
