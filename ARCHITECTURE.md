# Architecture

GameForge AAA has three layers: an **agent layer** (skill + specialist agents + task graph), a
**toolchain** (zero-dependency Node CLI) and a **runtime engine** (browser ES modules on a
vendored three.js). Generated games are plain static files.

```
┌──────────────────────────── Agent layer ────────────────────────────┐
│ /gameforge skill (SKILL.md + references/)  ─ Game Director           │
│ 17 specialist agents (.claude/agents/*.md, skills/gameforge/agents/) │
│ game.spec.js ─► GDD.md ─► tasks.json (waves, ownership, acceptance)  │
└───────────────┬─────────────────────────────────────────────────────┘
                │ shell
┌───────────────▼──────────── Toolchain (tools/) ─────────────────────┐
│ gameforge.mjs: doctor new gdd plan validate serve playtest build     │
│                shot export status                                    │
│ lib/bundle.mjs (ES-module → single classic script → 1 HTML file)     │
│ lib/design.mjs (GDD, task graph + conflict/cycle validation,         │
│                 playtest generation)                                 │
│ playtest.mjs (Playwright driver over window.__GF) · report.mjs       │
│ serve.mjs · vendor-three.mjs · build-skill.mjs                       │
└───────────────┬─────────────────────────────────────────────────────┘
                │ copies / references
┌───────────────▼───────────── Runtime engine (engine/) ──────────────┐
│ compose/  composeGame(spec, {modules}) – playable baseline from spec │
│ core/     GameApp, fixed-step loop, input, events, save, RNG/noise   │
│ render/   renderer+post, sky/atmosphere, procedural textures,        │
│           material library, particles, light pool                    │
│ geometry/ loft/lathe/tube builders, props, buildings, vehicles,      │
│           GLB/OBJ export, validation                                 │
│ character/ procedural skinned humanoid · animation/ clips, animator, │
│           tweens                                                     │
│ world/    heightfield terrain, vegetation, water, city + traffic     │
│ physics/  world (colliders, raycasts, bodies, triggers), character   │
│           controller, raycast vehicle                                │
│ ai/       behaviour trees, FSM, steering, A* nav grid, perception    │
│ gameplay/ actors (Player, Enemy, NPC), combat/inventory/progression, │
│           quests/dialogue/flags/missions, traversal                  │
│ audio/    Web Audio SFX synth, engine/ambience loops, music sequencer│
│ ui/       HUD, menus, dialogue box, settings & accessibility         │
│ vendor/three/ three.js r180 + addons (MIT)                           │
└──────────────────────────────────────────────────────────────────────┘
```

## Key decisions (see docs/RESEARCH.md for the evaluation)

| Decision | Choice | Why |
|---|---|---|
| Renderer | three.js r180, vendored, relative imports | MIT, mature WebGL2 PBR, no build step; Babylon/PlayCanvas heavier for an agent to drive; R3F needs React + JSX build |
| Physics | in-house (kinematic character, raycast vehicle, sphere bodies, spatial hash) | deterministic, tiny, tailored to genres; Rapier is 1.6 MB WASM, cannon-es unmaintained since 2022 |
| AI | in-house BT/FSM/steering/A* | small, testable in Node, no dependency |
| Assets | 100 % procedural at load time | zero install, no paid generators, no licensing risk |
| Audio | Web Audio synthesis + sequencer | no audio files, adaptive music |
| Packaging | custom bundler → single HTML (works from `file://`) | no esbuild/npm; games open with a double-click |
| Determinism | fixed 60 Hz step, simulation-time timers, seeded RNG | reproducible automated playtests |
| Testing | Playwright (optional, detected) driving `window.__GF` | real browser, real WebGL, real input actions |

## Runtime flow

1. `index.html` loads `main.js` (module) → `composeGame(SPEC, { modules })` or a hand-written game.
2. `GameApp` creates renderer (quality tier auto-detected), scene, atmosphere, physics, input,
   audio (unlocked on first gesture), UI, VFX, save, loop and installs `window.__GF`.
3. The composer builds world → structures → vegetation → systems → player/enemies/NPCs →
   collectibles → HUD → menus; then every project module's `install(game)` runs.
4. Fixed-step update order: timers/input/atmosphere/physics/VFX (−1000) → traversal (−1) →
   game logic (0) → test releases (999) → input end-of-frame (1000); render once per rAF.

## Determinism & test hooks

`window.__GF.step(n)` advances the simulation synchronously (rAF loop paused), so a playtest is
a pure function of the scenario. Gameplay timing must use `dt`/`app.after()`; UI typewriter and
dialogue are driven by simulation time for the same reason.

## Generated project layout

```
my-game/ index.html main.js game.spec.js GDD.md tasks.json playtest.json README.md
         src/{world,assets,physics,animation,story,ai,gameplay,audio,hud,graphics}.js   (one owner each)
         engine/ tools/   (copied, or referenced with --shared inside this repo)
         dist/<id>.html   (gameforge build)
```
