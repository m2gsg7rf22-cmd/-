# Automated playtesting

`node tools/playtest.mjs <game-dir> [--quality low|medium|high] [--file dist/game.html]`
launches Chromium (software WebGL is fine), loads the game with `?test=1`, pauses the real-time
loop and drives the deterministic fixed-step simulation through `window.__GF`:

| Hook | Meaning |
|---|---|
| `__GF.state()` | `{ state, time, frame, ...app.debugState() }` |
| `__GF.step(n)` | advance n fixed 1/60 s steps (renders once) |
| `__GF.press(action, frames)` | tap + hold an input action for n frames |
| `__GF.hold(action, v)` / `release(action)` | analogue hold |
| `__GF.look(dx, dy)` | mouse-look delta |
| `__GF.startGame()` | skip the title menu |
| `__GF.cheat.*` | game-specific shortcuts (teleport, killAll, god, skipToWave…) |
| `__GF.metrics()` | fps, draw calls, triangles, audio events, particles, errors |

## Scenario file: `playtest.json`

```json
{ "name": "My Game", "serveRoot": ".", "quality": "low", "steps": [
  { "do": "step", "frames": 30 },
  { "do": "call", "fn": "startGame" },
  { "do": "hold", "action": "moveForward" }, { "do": "step", "frames": 45 }, { "do": "release", "action": "moveForward" },
  { "do": "expect", "path": "player.z", "op": "<", "value": 10, "label": "W moves the player" },
  { "do": "press", "action": "attack", "frames": 2, "every": 18, "repeat": 20 },
  { "do": "expect", "js": "window.__GF.state().kills > 0", "op": "truthy", "label": "enemies can be killed" },
  { "do": "canvas", "label": "frame is not blank" },
  { "do": "screenshot", "name": "combat" }
]}
```
Ops: `< <= > >= == != truthy falsy includes`. Steps: `step call hold release press look eval key
click expect canvas screenshot`. `serveRoot` is the directory served over HTTP (use `"../.."` for
games inside this repository that import `../../engine`). Results: `test-results.json`; screenshots:
`screenshots/`.

## Coverage checklist (one `expect` each)

- boots without errors; title menu; start; pause/resume; win; lose; retry
- every input action the GDD lists (move, jump, sprint, attack, dodge, interact, drive, steer, brake…)
- camera follows; player grounded on spawn; collisions block walls/buildings
- AI: enemies perceive, pursue, attack, can be defeated; NPCs talk
- narrative: dialogue opens/advances/branches/ends; quest starts, progresses, completes, chains
- items: pickup, inventory count, gated interaction (key/door)
- save → change state → load restores it
- canvas non-blank check + at least one screenshot per major scene
- the dist build passes the same scenario via `--file`

## Visual regression (pixel diff against a baseline)
Playtests prove behaviour; `visual-diff` proves the image did not change by accident (lighting, materials, LOD, a
missing mesh). Playtest screenshots are deterministic for a fixed seed, quality tier and machine.
```
node tools/playtest.mjs <project>                                   # writes <project>/screenshots/*.png
node tools/gameforge.mjs visual-diff <project>/screenshots --baseline <project>/baseline   # first run: stores the baseline
# … change code, re-run the playtest, then:
node tools/gameforge.mjs visual-diff <project>/screenshots --baseline <project>/baseline
```
Each PNG is box-blurred 3×3; a pixel is "changed" when its largest channel delta exceeds `--tolerance` (0.06), and a shot
FAILS when more than `--threshold` (2 %) of its pixels changed. Open `screenshots/diff/<name>.diff.png` (changed pixels red over a
dimmed frame) and decide: regression → fix; intended → `--update` to accept the new baseline. Report: `diff/visual-diff.json`.
Compare only shots taken on the same machine/GPU path (SwiftShader vs a real GPU differ everywhere).
