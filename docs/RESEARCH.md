# GameForge AAA: Research Report

Date: 2026-10-27. Scope: prior art, the skill format, candidate libraries, and testing, for an
open-source Agent Skill plus a zero-install browser game toolkit (vanilla ES modules, vendored
three.js, no npm install for end users, WebGL in the browser).

Method: shallow clones in `/tmp/claude-0/research/` (no scripts were run from them).
`npm view` gave versions, licenses and dates. `npm pack --ignore-scripts` downloaded
tarballs so file sizes could be measured locally (raw bytes, plus `gzip -9`). GitHub search
gave stars, license and last-push dates. Web search and docs fetches covered conventions.
The jsDelivr/unpkg CDNs, agentskills.io and developers.openai.com could not be reached from
this sandbox (proxy 403 / DNS). Facts that depend on those sources are marked **unverified**,
or attributed to the secondary source they came from.

---

## 1. majidmanzarpour/threejs-game-skills

- **License:** MIT (Copyright 2026 Majid Manzarpour). Clone at `/tmp/claude-0/research/threejs-game-skills`.
- **Shape:** 9 self-contained skills under `skills/`. Each has a `SKILL.md` (26–120 lines,
  585 lines in total), `references/*.md`, optional `scripts/` and `assets/`, and
  `agents/openai.yaml`, which gives Codex `interface.display_name`, `short_description` and
  `default_prompt`. A single pack serves both Claude Code (`~/.claude/skills`) and Codex
  (`~/.agents/skills`, legacy `~/.codex/skills`). Install is `npx skills add …` or `install.sh`.
- **Frontmatter:** only `name` and `description`, with long descriptions full of trigger words.

### 1.1 The 9 skills and director routing

| Skill | Role | External API |
| --- | --- | --- |
| `threejs-game-director` | Entry point. Sets scope and quality bar, routes to the specialists, delegates in bounded ways (lead plus at most 2 workers with separate file ownership), keeps a continuity note (`artifacts/game-progress.md`), handles asset recovery, collects evidence | none (probes keys) |
| `threejs-gameplay-systems` | Design brief, core-loop contract, level plan, entities, input, camera, physics choice, game feel; ships the scaffold | none |
| `threejs-aaa-graphics-builder` | Art direction, procedural models, materials, shader cookbook, VFX, render budgets, **visual scorecard** | none |
| `threejs-game-ui-designer` | HUD and menus, safe areas, touch UI, text fit | none |
| `threejs-debug-profiler` | Blank canvas, runtime and resize bugs, draw calls, triangles, memory | none |
| `threejs-qa-release` | Playwright QA, canvas-pixel inspector, visual baselines, bot playtests, release risk report | none |
| `threejs-3d-generator` | Text/image to 3D, rigging, animation, GLB/FBX | **Tripo API** (`TRIPO_API_KEY`, paid) |
| `threejs-image-generator` | Concepts, textures, skies, icons, GUI art | **Google Gemini image API** (`GEMINI_API_KEY`, paid tiers) |
| `threejs-audio-generator` | SFX, music, ambience, TTS, voice conversion | **ElevenLabs** (`ELEVENLABS_API_KEY`, paid) |

Routing works like this. The director's `SKILL.md` maps each phase to a skill in a table and
resolves sibling skills through `../<skill>/SKILL.md` relative to the loaded file. For a
complete game it reads all five production skills before implementing. For a narrow edit it
loads only the affected skills. Scope comes from the user's own words: "premium/AAA/polished/
release-ready/less basic" switches on the full pipeline, and "small arcade game" does not.
`probe_asset_credentials.sh` sources shell profiles and prints `KEY=SET|MISSING`. When a key
is missing, the director falls back to procedural or local assets and reports the gap.

### 1.2 Scaffold

`skills/threejs-gameplay-systems/assets/threejs-vite-game/` is a **Vite 8 + TypeScript 6 +
three ^0.184 + lil-gui** project. It is laid out as `core/` (Renderer, Loop, InputController),
`systems/` (CollisionSystem, CameraRig, Hud, AudioSystem, DebugTools), `entities/` (Player,
Pickup) and `utils/` (dispose, seeded `random`). `create_threejs_game.py` copies it. It
**requires `npm install` and a build step**, so it is not zero-install. Useful patterns:

- `window.__THREE_GAME_TEST_HOOKS__` with `seed(n)`, `setState(name)` and
  `setPausedForScreenshot()`. Named states must acknowledge with `{state: NAME}`.
- `window.__THREE_GAME_DIAGNOSTICS__` publishes frame, score, objective, complete/fail state
  and player position.
- All gameplay randomness goes through a seeded RNG, so screenshots and bot runs are deterministic.

### 1.3 QA scripts

- `inspect-threejs-canvas.mjs` (Node + Playwright + pngjs). It takes screenshots and computes
  canvas metrics: `colorEntropyBits`, `dominantColorShare`, `edgeDensity` and
  `luminance.contrast`. It reports `renderer.info` against budgets (desktop: 300 calls / 750k
  tris / 300 geometries / 60 textures; mobile: 150 / 300k / 200 / 40). It flags
  `softwareRendered` when the GL renderer string matches swiftshader/llvmpipe. `--manifest`
  captures every declared viewport and state in one browser run.
- `check_evidence.py --manifest` checks that the declared captures exist for the current run ID.
- `playwright.config.ts`: `workers: 1` because parallel WebGL contexts flake, and
  `channel: 'chromium'` because Playwright's default headless shell falls back to SwiftShader,
  which the repo says is about 4x slower. A mobile project uses iPhone 13 metrics on Chromium.
- Test templates: smoke, visual-regression baseline, bot playtest. The bot playtest records
  `framesAdvanced`, `distanceTravelled`, score delta, `softlockWindows`, time to first fail,
  and console errors.

### 1.4 Visual scorecard

`threejs-aaa-graphics-builder/references/visual-scorecard.md` has 10 categories: art
direction, hero, obstacles/enemies, rewards/interactables, world, materials, lighting/render,
VFX/motion, UI/HUD, performance evidence. Each is scored 0–3 against three anchor JPGs.
**Premium** means every category is ≥ 2 and the average is ≥ 2.3. **Showcase** means at
least six categories at 3 and an average ≥ 2.7. Some conditions fail automatically: primitive
hero plus glow, a stat-card HUD, fog or bloom standing in for geometry, no active-play
screenshot, no renderer diagnostics. Measured thresholds: entropy < ~3.0 bits,
dominant-colour share > ~0.6, edge density < ~0.04, contrast < ~60. A measurement that falls
outside these "needs an explanation", and the scorecard says not to add clutter just to pass.

### 1.5 Reusable vs not

- **Reusable as ideas** (MIT, so code reuse needs attribution): director/specialist split,
  scope ladder, continuity note, evidence manifest, test-hook contract, seeded RNG, canvas
  metrics and render-budget rows, scorecard rubric, bot-playtest metrics, headless-WebGL caveats.
- **Not directly reusable:** the Vite/TS scaffold and npm-dependent inspector, which conflict
  with zero-install and vanilla ES modules. The 3 generator skills depend on paid APIs (Tripo,
  Gemini, ElevenLabs). Their physics guidance defaults to Rapier (WASM) with cannon-es as the
  fallback (`references/physics-engine-selection.md`), which is a different choice from ours (§10).
- Its own maintainer checks need `npm install` (`@playwright/test`, `pngjs`).

---

## 2. anthropics/skills and the Agent Skills spec

Clone at `/tmp/claude-0/research/skills`. `spec/` holds only a pointer to
<https://agentskills.io/specification>. The repo says most skills are Apache-2.0. The
docx/pdf/pptx/xlsx skills are source-available, not open source.

### 2.1 SKILL.md format (spec essentials)

The live spec page was unreachable, so these come from mirrors and search results and the
exact limits are **unverified**.

- A folder `<name>/` holding `SKILL.md`, which is YAML frontmatter followed by a Markdown
  body. Optional `scripts/`, `references/` and `assets/`.
- Required: `name` (≤ 64 chars, lowercase a–z, 0–9 and `-`, cannot start or end with `-`,
  should match the folder name) and `description` (non-empty, ≤ 1024 chars, says what the
  skill does and when to use it).
- Optional: `license`, `compatibility` (≤ 500 chars), `metadata` (string-to-string map),
  `allowed-tools` (experimental, space-separated).
- Progressive disclosure has three levels. Level 1 is name and description, always in
  context. Level 2 is the body, loaded when the skill triggers (keep it under 500 lines /
  ~5k tokens). Level 3 is references and scripts, loaded on demand.
- The reference validator is `skills-ref validate`. Repo: `agentskills/agentskills`, about 26.7k stars.
- `template/SKILL.md` is minimal: `name: template-skill`, `description: Replace with…`.

### 2.2 skill-creator guidance (`skills/skill-creator/SKILL.md`, Apache-2.0)

- Loop: capture intent → interview → draft → write test prompts → run with and without the
  skill → review qualitatively and quantitatively (`eval-viewer/generate_review.py`) →
  iterate → widen the test set.
- `description` is "the primary triggering mechanism". All "when to use" information belongs
  there, and descriptions should be a bit "pushy" because Claude tends to under-trigger skills.
- Keep `SKILL.md` under 500 lines and add a level of hierarchy with pointers before going
  over. Scripts handle deterministic or repetitive work.
- Tooling: `quick_validate.py`, `package_skill.py`, `run_eval.py` / `run_loop.py`. The
  description optimiser makes a 60/40 train/test split, runs each query 3 times, iterates up
  to 5 times, and picks the winner by test score. Simple one-step queries often don't trigger
  skills, so trigger evals need substantive prompts.

### 2.3 webapp-testing approach (Apache-2.0)

- The agent writes **native Python Playwright** scripts (`sync_playwright`, headless Chromium).
- `scripts/with_server.py` is meant to be used as a black box: run `--help` first and don't
  read the source. It manages one or more dev servers around the automation command.
- Decision tree: static HTML → read the file for selectors and use a `file://` URL. Dynamic
  app → reconnaissance first (wait for `networkidle`, take a screenshot or dump the DOM),
  then act with the selectors found.
- Examples cover element discovery, static HTML automation and console-log capture.
- For us: use the same reconnaissance-then-action pattern and the black-box helper idea, in
  Node instead of Python, since Playwright Node is the native API and matches an ES-module toolchain.

---

## 3. Renderers / engines

Versions and dates come from `npm view` on 2026-10-27. Sizes were measured from npm tarballs.

| | three | Babylon.js | PlayCanvas engine | react-three-fiber |
| --- | --- | --- | --- | --- |
| Latest | 0.186.1 (2026-09-24; 0.186.0 2026-09-08) | 9.32.1 (`@babylonjs/core` and `babylonjs`, 2026-10-27) | 2.23.3 (2026-10-27) | 9.8.2 (2026-10-21) |
| License | MIT | Apache-2.0 | MIT | MIT |
| Repo activity | pushed 2026-10-27, ~117k★ | pushed 2026-10-27, ~26k★ | pushed 2026-10-27, ~17k★ | pushed 2026-10-21, ~33k★ |
| Single-file ESM build | `build/three.module.js` (647 KB) + `three.core.js` (1,423 KB). About 2.0 MB raw / **~406 KB gz** unminified. No `.min.js` in the 0.186.1 tarball. `three.webgpu.js` is 2.2 MB / 433 KB gz | UMD `babylon.js` 8.5 MB / **~1.8 MB gz**. `@babylonjs/core` ESM is thousands of files and needs a bundler or a large import map | `build/playcanvas.min.mjs` 2.5 MB / **~640 KB gz** | Needs React 19 + react-dom (peer `react >=19 <19.4`, `three >=0.156`) |
| No-build fit | **Excellent.** Import map plus vendored `build/` and `examples/jsm/`. Addons are plain ESM that import `'three'` | UMD global works without a build but is heavy. Tree-shaking needs a bundler | Good. One ESM file. Editor-centric workflow is optional | **Poor.** JSX needs a compile step (or `htm`), plus React runtime and reconciler on top of three |
| Pros | Smallest core, huge example and addon corpus, best LLM familiarity, WebGL2 + WebGPU renderers | Batteries included (physics plugins, GUI, inspector, nav, audio), stable API | Fast, entity-component model, good mobile perf, glTF/WebGPU | Declarative and ecosystem-rich (drei, rapier bindings) |
| Cons | Renderer only: physics, AI, audio and UI are DIY. Breaking changes between revisions, so pin a version | Size, and a large API surface for an agent to stay consistent with | Smaller example corpus. Engine-without-editor docs are thinner | Build step, React state model, two abstraction layers |

Takeaway: three.js is the only option that is small, single-module, MIT and very well known
to LLMs. r3f is ruled out by the no-build constraint.

---

## 4. Physics

| Lib | Version / last publish | License | WASM? | Size (measured) | Maintenance |
| --- | --- | --- | --- | --- | --- |
| cannon-es | 0.20.0 (npm modified 2022-08-12) | MIT | No, pure JS | `dist/cannon-es.js` 338 KB / 72 KB gz | No npm release in about 4 years. Snyk rates it "inactive". Repo was not returned by GitHub search, so archive status is **unverified** |
| @dimforge/rapier3d-compat | 0.21.0 (2026-09-25) | Apache-2.0 | **Yes.** `-compat` inlines the WASM as base64 | `dist/rapier.mjs` 4.2 MB / **1.6 MB gz**. Raw `.wasm` is 3.0 MB | Active. `dimforge/rapier.js` is now **archived**, and npm points at the `dimforge/rapier` monorepo |
| ammo.js (Bullet via Emscripten) | npm `ammo.js` 0.0.10 (2022). Repo pushed 2026-09 | zlib-style (GitHub: NOASSERTION) | asm.js/WASM builds | npm `ammo.js` 1.5 MB / 309 KB gz | Stale npm package. Typically vendored from the repo builds. `ammojs-typed` 1.1.0 (MIT, 2026-09) |
| oimo.js / OimoPhysics | `oimo` 1.0.9 (2022), repo last push 2021. `oimophysics` 1.2.2 (2024-03) | MIT | No (Haxe → JS) | `OimoPhysics.js` 1.5 MB / 225 KB gz | oimo.js dormant. OimoPhysics repo pushed 2025-05 |

Other notes:
- three r186 ships `examples/jsm/physics/{AmmoPhysics,JoltPhysics,RapierPhysics}.js`. These
  are thin helpers that load those engines, often from a CDN.
- Jolt (`jolt-physics`) was not investigated in depth. **Unverified** here.

---

## 5. Navigation / AI

| Lib | Version / date | License | Notes |
| --- | --- | --- | --- |
| recast-navigation-js (`recast-navigation`, `@recast-navigation/core`) | 0.43.1 (2026-02-04 / core metadata 2026-04) | MIT | Recast/Detour compiled to WASM. `@recast-navigation/wasm` ships `.wasm` (339 KB) and a `wasm-compat.js` (987 KB / 231 KB gz). Navmesh generation, crowds, off-mesh links. Repo pushed 2026-07, ~435★ |
| three-pathfinding | 1.3.0 (2024-05) | MIT | Pure JS, 10 KB / 3 KB gz. A* plus funnel over a **pre-baked** navmesh (zones/groups). Repo pushed 2026-10. Navmesh authoring happens outside the library |
| yuka | 0.7.8 (npm 2022-09) | MIT | Pure JS game-AI library: steering behaviours, FSM, goal-driven agents, fuzzy logic, graph search (A*, Dijkstra, BFS), navmesh, perception and memory, triggers. `yuka.module.js` 432 KB / 82 KB gz (min 120 KB / 31 KB gz). Repo pushed 2026-10, but no npm release in about 4 years |
| mistreevous | 4.3.1 (2025-07) | MIT | Behaviour trees with a DSL or JSON definition. Repo pushed 2026-10 |
| behaviortree (BehaviorTree.js) | 3.0.0-beta.1 (2026-03) | npm: MIT. GitHub license field: none (**unverified**) | Small BT library. Current release is a beta |

Takeaway: grid or waypoint A*, steering and behaviour trees are a few hundred lines each in
plain JS. Recast is only worth adding for authored 3D levels that need automatic navmeshes.

---

## 6. three.js addons, procedural generation, animation, testing

### 6.1 Addons verified present in three 0.186.1 `examples/jsm/`

- `postprocessing/`: `EffectComposer`, `UnrealBloomPass`, `BloomPass`, `OutputPass`, `SMAAPass`, `SSAOPass`, `GTAOPass`, among others.
- `objects/`: `Sky`, `SkyMesh`, `Water`, `Water2`, `WaterMesh`, `Reflector`, `Refractor`, `Lensflare`, `GroundedSkybox`, `MarchingCubes`, `GaussianSplat`.
- `environments/`: `RoomEnvironment`, `ColorEnvironment`, `DebugEnvironment`. Use with `PMREMGenerator` for IBL without HDR files.
- `exporters/`: `GLTFExporter`, plus OBJ, PLY, STL, USDZ, DRACO, EXR and KTX2 exporters.
- `utils/`: `BufferGeometryUtils` (mergeGeometries, mergeVertices, computeTangents…), `SkeletonUtils`, `SceneOptimizer`, `SceneUtils`, `WorkerPool`.
- `animation/`: `CCDIKSolver`, `AnimationClipCreator`. The core has `AnimationMixer`,
  `AnimationClip`, `KeyframeTrack`, `SkinnedMesh`/`Skeleton` and `AnimationUtils`, so
  procedural clips can be authored in code with no assets.
- `csm/` (cascaded shadow maps), `geometries/` (RoundedBox, Text, Convex…), `math/`
  (`SimplexNoise`, `ImprovedNoise`, `ConvexHull`, `Capsule`, `Octree`).
- `math/Octree.js` and `math/Capsule.js` are what the official "games_fps" example uses for
  capsule-vs-world collision. This is a strong base for an in-house character controller.
- In r186 these all import the bare specifier `'three'` (or `three/addons/`), so an
  `<script type="importmap">` is required in no-build pages.

### 6.2 Other libraries

| Lib | Version | License | Size | Notes |
| --- | --- | --- | --- | --- |
| three-mesh-bvh | 0.9.16 (2026-10-08) | MIT | `build/index.module.js` 283 KB / 60 KB gz | Repo very active (pushed 2026-10-27, ~3.5k★). Fast raycasts, shapecasts and capsule-vs-mesh. Optional accelerator for large static levels |
| simplex-noise | 4.0.3 (2024-07) | MIT | 18 KB / 4 KB gz | Stable and complete. 2D/3D/4D, takes a seeded PRNG. three's own `SimplexNoise`/`ImprovedNoise` addons are an alternative that needs no extra dependency |
| THREE.Terrain | n/a | MIT | not measured | Procedural heightmap terrain. Ships its own SKILL.md (see §7) |

### 6.3 Procedural textures (approaches)

- `CanvasTexture` from a 2D canvas: noise, brick and tile patterns, decals, UI icons.
  Cheap and deterministic with a seeded RNG.
- `DataTexture` filled from a noise or fBm function on the CPU, for heightmaps, normal maps
  (from height gradients) and roughness masks.
- Shader-side noise via `onBeforeCompile` on `MeshStandardMaterial`, a `ShaderMaterial`, or
  TSL node materials (WebGPU path). Triplanar mapping avoids UV work on procedural meshes.
- `RoomEnvironment` + `PMREMGenerator` gives believable PBR reflections with no HDRI download.
- Render-to-texture (`WebGLRenderTarget`) can bake expensive procedural results once at load.

### 6.4 Browser game testing

- Playwright 1.64.1 (2026-10-27, Apache-2.0, ~99k★). It covers Chromium, Firefox and WebKit,
  screenshots and `toHaveScreenshot` baselines, console and pageerror capture, `page.evaluate`
  for test hooks, device emulation, and a built-in `webServer`.
- Headless WebGL details:
  - Chromium's automatic fallback to SwiftShader for WebGL is deprecated (Chromium docs
    reference M139). WebGL context creation now fails where it would have fallen back,
    unless Chromium is started with `--enable-unsafe-swiftshader`. The documented pairing
    is `--use-gl=angle --use-angle=swiftshader-webgl`. Edge deprecated SwiftShader from v144.
  - Per the threejs-game-skills config comments, the default headless shell has no GPU
    backend. `channel: 'chromium'` (full Chromium, `npx playwright install --no-shell
    chromium`) uses the real GPU when one is present.
  - On GPU-less CI, SwiftShader is still the practical choice. Treat FPS as meaningless
    there and assert on pixels, state and errors instead.
  - Whether Playwright passes `--enable-unsafe-swiftshader` by default is **unverified**
    (one third-party source says it does).
- Pixel reads need `preserveDrawingBuffer: true` or a read in the same frame. Alternatively,
  use `canvas.toDataURL()` right after `renderer.render()` from a test hook.

---

## 7. Other agent skills on GitHub (none installed)

Licenses and stars come from GitHub search on 2026-10-27.

| Repo | License | ★ | One-line assessment |
| --- | --- | --- | --- |
| `gamedev-skills/awesome-gamedev-agent-skills` | Apache-2.0 | ~5.1k | 74 cross-engine game-dev SKILL.md files (Godot, Unity, Phaser, three.js…) plus a router. Broad but shallow per engine. Useful to compare our description triggers against |
| `img2threejs/img2threejs` | Apache-2.0 | ~19.6k | Image → procedural, code-only Three.js model with quality gates. Closest to our "no paid asset API" ethos for hero models. Worth studying |
| `PlayableIntelligence/game-creator` | none detected | ~350 | Claude plugin for Phaser 2D and three.js 3D games. Includes a World Labs (paid API) splat skill. No license, so do not copy code |
| `linegel/threejs-complete-set-of-skill` | ISC | ~11 | 25 WebGPU/TSL skills (oceans, clouds, planets) with screenshot validation. Niche, high-end rendering reference |
| `Nice-Wolf-Studio/claude-skills-threejs-ecs-ts` | MIT | ~34 | Three.js + ECS + TS skills. TS/build oriented, ECS ideas transferable |
| `cesartevisual/threejs-skills` | MIT | ~9 | 24 three.js skills aimed at websites (R3F, WebGPU). Low relevance to games |
| `IceCreamYou/THREE.Terrain` (has `SKILL.md`) | MIT | ~914 | Long-lived procedural terrain library that now ships an agent guide. Good model for library-owned skills |
| `anthropics/skills` → `webapp-testing` | Apache-2.0 | n/a | Python Playwright testing pattern. Adapt the pattern rather than depend on it |

---

## 8. Agent orchestration conventions

### 8.1 Claude Code subagents: `.claude/agents/*.md`

Source: code.claude.com/docs/en/sub-agents, fetched 2026-10-27.
- Locations, highest priority first: managed settings, the `--agents` CLI JSON, project
  `.claude/agents/`, user `~/.claude/agents/`, plugin `agents/`. Directories are scanned
  recursively, and agents are identified by `name`, not by file path.
- Frontmatter: `name` (required, ≤ 256 chars, no `:`, cannot start with `-`) and
  `description` (required, tells Claude when to delegate). `tools` is an allowlist given as
  a comma string or YAML list, and inherits everything if omitted. `model` accepts
  `sonnet|opus|haiku|fable`, a full model ID, or `inherit`. Other optional fields:
  `disallowedTools`, `permissionMode`, `maxTurns`, `skills` (preloaded), `mcpServers`,
  `hooks`, `memory`, `background`, `effort`, `isolation: worktree`, `color`, `initialPrompt`.
  Unknown fields are ignored. The body is the system prompt.

### 8.2 Claude Code skills: `.claude/skills/<name>/SKILL.md`

Source: code.claude.com/docs/en/skills.
- Locations: enterprise, personal `~/.claude/skills/`, project `.claude/skills/`, nested
  `<subdir>/.claude/skills/`, `--add-dir`, plugin `skills/` (namespaced
  `/plugin:skill`). Precedence is enterprise > personal > project.
- Claude Code accepts the spec fields plus extensions: `when_to_use`, `argument-hint`,
  `arguments`, `disable-model-invocation`, `user-invocable`, `allowed-tools`,
  `disallowed-tools`, `model`, `effort`, `context: fork` + `agent`, `hooks`, `paths`, `shell`.
- Portability: outside Claude Code (claude.ai uploads, Skills API), only `name`,
  `description`, `license`, `compatibility`, `metadata` and `allowed-tools` are allowed.
  Other keys cause an upload error, so **our shipped SKILL.md should use only these**.
- `description` + `when_to_use` is truncated at 1,536 chars in the listing. After
  compaction, each invoked skill keeps its first ~5k tokens.

### 8.3 Codex: `AGENTS.md` and `~/.agents/skills`

The official Codex docs were unreachable, so this is from search results and the
threejs-game-skills README and is **partly unverified**.
- `AGENTS.md` at the repo root (and in subdirectories) holds project instructions for Codex
  and other agents, comparable to `CLAUDE.md`. threejs-game-skills ships one that points to
  the director skill.
- Skill discovery: `$CWD/.agents/skills`, parent directories up to the repo root,
  `~/.agents/skills`, `/etc/codex/skills`, then built-ins. Project skills beat user skills,
  which beat system skills. The legacy location is `~/.codex/skills`.
- Codex preloads only name, description and path. Explicit invocation is `$skill-name`.
- Optional `agents/openai.yaml` per skill: `interface.display_name`, `short_description`,
  `default_prompt`. A policy can disable implicit invocation (that field name is **unverified**).
- Cross-agent installer: `npx skills add <owner/repo> --skill '*' -a claude-code|codex -g`
  (the `skills` CLI, per the threejs-game-skills README).

Implication: one `skills/<name>/SKILL.md` tree with spec-only frontmatter, plus an optional
`agents/openai.yaml`, an `AGENTS.md` and a `CLAUDE.md` pointing at the entry skill. Ship
`.claude/agents/*.md` only for optional subagent roles.

---

## 9. Constraint fit summary

| Requirement | Implication |
| --- | --- |
| Zero install for players | Static files plus an import map. No bundler, no npm at runtime. Everything vendored |
| Agent-authored | Prefer small, well-known APIs (three.js) and in-house modules the skill fully documents |
| WebGL in browser | three `WebGLRenderer`, with WebGPU optional later. Avoid features that need WASM threads or COOP/COEP headers |
| Deterministic QA | Seeded RNG, fixed-timestep simulation, test hooks on `window` (pattern from §1.2) |
| Licensing | Keep vendored code MIT, Apache-2.0 or zlib, and keep LICENSE files next to vendored code |

---

## 10. Technology decisions

### 10.1 Renderer: three.js, vendored, MIT

- Vendor `three@0.186.1` `build/three.module.js` + `build/three.core.js` (~406 KB gz
  together), plus only the `examples/jsm` addons we use: EffectComposer, RenderPass,
  UnrealBloomPass, OutputPass, SMAAPass, Sky, Water, RoomEnvironment, GLTFLoader/Exporter,
  BufferGeometryUtils, SkeletonUtils, CCDIKSolver, Octree and Capsule. Keep the upstream
  `LICENSE` and pin the revision, since three breaks APIs between revisions.
- Map `"three"` and `"three/addons/"` with an import map so upstream addons load unmodified.
- Why not the others: Babylon's no-build path is the 1.8 MB gz UMD build. PlayCanvas is
  viable (single 640 KB gz ESM) but has a smaller corpus for agents. r3f needs a JSX build
  and React. three also has the strongest LLM prior and example base, which lowers
  agent error rates (this last point is a judgement, not measured).

### 10.2 Physics: in-house lightweight module

Scope: a kinematic **character controller** (capsule vs. static-world Octree/BVH, slopes,
steps, ground snap, coyote time, jump buffer), a **raycast vehicle** (4 suspension rays,
spring/damper, lateral friction, drift tuning), and **simple rigid bodies** (sphere, box and
capsule; impulses with restitution and friction; sleeping; triggers/sensors). It runs on a
fixed 60 Hz timestep with a clamped accumulator.

Rationale vs Rapier / cannon-es:
- **Size and zero-install:** `rapier3d-compat` is 4.2 MB raw / 1.6 MB gz (base64 WASM) and
  needs async `init()`. That is roughly 4x the renderer itself. An in-house module is
  expected to come in at tens of KB (estimate).
- **Maintenance risk:** cannon-es has had no npm release since 2022 (0.20.0). The
  `rapier.js` repo is archived and has moved into a monorepo. Both are API surfaces the
  agent must track.
- **Feel over realism:** the target genres (platformer, racer, shooter, arena) rely on tuned,
  authored character and vehicle feel, which general solvers make harder. The
  threejs-game-skills ladder also puts "custom collision" first for arcade genres.
- **Determinism and debuggability:** plain JS that the skill documents line by line can be
  seeded, stepped and inspected from test hooks, and the agent can modify it safely.
- **Escape hatch:** document an optional adapter for Rapier (Apache-2.0) for projects that
  need stacking, joints, CCD or many dynamic bodies. three's `RapierPhysics.js` addon is a
  reference. It is not bundled by default.

### 10.3 AI / navigation: in-house A* and behaviour trees

- Grid or waypoint-graph A* with a binary heap and string-pulling, steering behaviours
  (seek, flee, arrive, wander, separation, pursuit), a small FSM, and a behaviour-tree
  runtime (Sequence, Selector, Parallel, Decorator, Condition, Action, with a blackboard).
  Each is a few hundred lines with no dependencies.
- Rationale: yuka (MIT, last npm release 2022) and mistreevous (MIT) are fine references,
  but adding them costs vendoring and API drift for features we would mostly not use.
  recast-navigation (MIT, WASM ~339 KB + glue) is only justified for complex authored 3D
  levels, so keep it as a documented optional path. three-pathfinding (MIT, 3 KB gz) needs a
  pre-baked navmesh, which is a poor fit for procedurally generated levels.

### 10.4 Audio: WebAudio synthesis

- Procedural SFX (oscillators, noise buffers, envelopes, filters, FM, distortion), a small
  step-sequencer for music loops, and spatial audio via `PannerNode` or three's
  `PositionalAudio`. No asset files and no paid APIs. This replaces the ElevenLabs-dependent
  path in threejs-game-skills.
- Must unlock the `AudioContext` on the first user gesture (autoplay policy).

### 10.5 Testing: Playwright

- Node Playwright (Apache-2.0) as a **developer/CI-only** dependency. Players never install it.
- Adopt these patterns: `window.__GAME_TEST_HOOKS__` (seed, setState, pause-for-screenshot,
  step(n)), a diagnostics object, a canvas-pixel inspector (entropy, edge density, contrast,
  non-blank), renderer.info budgets, bot playtests (frames advanced, distance moved,
  softlocks, console errors), and `workers: 1`.
- Headless WebGL: prefer `channel: 'chromium'` on GPU hosts. On GPU-less CI, launch with
  `--use-gl=angle --use-angle=swiftshader-webgl --enable-unsafe-swiftshader`. Record the
  `UNMASKED_RENDERER_WEBGL` string and never cite FPS from software rendering.
- Visual scoring: adapt the 10-category scorecard idea with our own anchors (we cannot copy
  their anchor images without attribution, MIT).

### 10.6 Not adopted (default build)

Vite/TypeScript build, React/r3f, Babylon, Rapier/cannon-es/ammo bundled by default, and
paid generation APIs (Tripo, Gemini, ElevenLabs). Any of these can be added later as
optional adapters without changing the zero-install core.

---

### Unverified items (summary)

- Exact agentskills.io field limits (taken from mirrors and search results).
- Codex `openai.yaml` policy field names, and the `/etc/codex/skills` path.
- Whether the pmndrs/cannon-es repo is archived.
- BehaviorTree.js repository license. npm says MIT, GitHub reports none.
- Whether Playwright passes `--enable-unsafe-swiftshader` by default.
- The estimated in-house physics size, and the claim that agents make fewer errors with three.js.
