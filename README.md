# BLOCKFORGE

An original voxel survival sandbox that runs in the browser on desktop and mobile.
TypeScript + Three.js (WebGL2) + Vite. Terrain is generated and meshed in Web Workers, and worlds are saved in IndexedDB.
All textures, icons, sounds and names are procedurally generated or original. No third-party game assets are used.

## Play

```bash
npm install
npm run dev          # http://localhost:5173  (also reachable from your phone on the same Wi-Fi via http://<your-LAN-IP>:5173)
```

Production build:

```bash
npm run build        # typecheck + bundle into dist/
npm run preview      # http://localhost:4173
```

`dist/` is a static site that can be hosted anywhere (it uses relative paths).

### Desktop controls

| Action | Key |
|---|---|
| Move | W A S D (or arrow keys) |
| Look | Mouse (click the game to capture the pointer; drag-to-look fallback if pointer lock is blocked) |
| Jump / swim up | Space |
| Sprint | Shift |
| Mine / attack | Left mouse (hold) |
| Place / use / eat | Right mouse |
| Hotbar | 1–9, mouse wheel |
| Inventory & crafting | E |
| Pause | Esc |
| Creative flight | F, or double-tap Space. Ctrl/C descends. |
| Discard held item | Q |
| Debug overlay | F3 |

Gamepads work too: left stick moves, right stick looks, A jumps, RT/LT mine and place, LB/RB change slot, Y opens the inventory, Start pauses.

### Mobile controls

Landscape is recommended. You'll see a rotate prompt in portrait, with an option to continue.

- **Left side:** a floating joystick appears where you touch. Push to the edge to sprint.
- **Right side:** drag to look.
- **Buttons:** ⛏ Mine (hold), ⬡ Place/Use, ⬆ Jump. Top right has Inventory and Pause. Creative also gets Fly and ⬇ Descend.
- **Hotbar:** tap a slot.
- **Inventory:** tap an item, then tap the destination slot. Dragging works too. Split and Discard buttons are included.

All controls are multitouch: you can move, look and jump at the same time.

## Game overview

- **Worlds:** seeded and infinite, built from 16×16×128 chunks. Biomes: Plains, Forest, Dense Forest, Desert, Mountains, Snowfields, Taiga, Beach, Ocean and Rivers. Terrain includes caves, ravines, lakes and cliffs. The same seed always produces the same world.
- **Resources:** Ember, Copper, Iron and Lumen Crystal ores, with depth-dependent distribution.
- **Crafting:**
  - By hand: planks, sticks, Forge Bench.
  - At a **Forge Bench**: Kiln, Slate Bricks, and tools.
  - At a **Kiln**: ingots, glass, roast meat and other smelting.
  - Stations count when they are within 4 blocks. Right-clicking a station opens crafting.
- **Tools:** Pickaxe, Hatchet, Spade and Blade in five tiers (Timber → Flint → Copper → Iron → Lumen), each with its own speed, durability and harvest level.
- **Survival:** health, hunger, sprint cost, fall damage, drowning and regeneration. On death you see "YOU FELL" with Respawn or Main Menu, and you keep your inventory.
- **Creative:** a full block library, flight, instant breaking, and no damage or hunger.
- **Creatures:**
  - Grazer and Voxel Boar are passive, flee when hit and drop meat.
  - The Shadow Crawler is hostile at night and fades away in daylight.
- **World:** a 20-minute day/night cycle with sun, moon, stars and drifting clouds; animated translucent water; and fog that blends into the sky.
- **Saving:** autosave every 30 s, plus saving on pause, tab hide and Save & Quit. Saves cover world edits, player position, inventory, health, hunger, time of day and settings.

## Settings

- **Graphics:**
  - Quality presets (Low/Medium/High/Ultra).
  - Render distance 3–16 (mobile max 8).
  - Ambient occlusion, particles, clouds, FOV, resolution scale.
  - Adaptive quality, which steps down one setting at a time if FPS stays low; it uses hysteresis and a cooldown.
  - Debug overlay.
- **Controls:** Auto/Desktop/Mobile scheme, mouse and touch sensitivity, invert Y, auto-jump.
- **Audio:** master, effects, ambient. All sound is procedural Web Audio.
- **Interface:** UI scale, reduced motion, fullscreen.

On first launch, a short capability check (about 30 ms) picks a default preset.

## Development

```bash
npm run typecheck
npm test               # unit tests (vitest)
npm run bench          # worldgen/meshing micro-benchmark
# Browser QA (needs `npm run build && npm run preview` running on :4173):
npm run qa:e2e         # desktop flow: create → move → jump → mine → place → craft → pause → save → reload
npm run qa:touch       # multitouch joystick/look/buttons, touchcancel, slide-off, orientation
npm run qa:responsive  # 11 viewports, layout checks + screenshots in qa-output/
npm run qa:failures    # no IndexedDB/workers/WebGL/audio/pointer lock, corrupted saves, focus loss
npm run qa:bughunt     # input spam, pause mid-action, death in menus, reload mid-save…
npm run qa:memory      # long flight; geometry/heap/chunk counts must plateau
npm run qa:visual      # day/sunset/night/underwater/cave/mobs screenshots
```

### Architecture

```
src/
  core/      constants, coordinates, seeded noise, ids, device detection
  world/     blocks, tiles, generator, mesher (greedy + AO + skylight), worker pool, chunk streaming
  render/    renderer (resize/DPR), procedural texture atlas, shaders, sky, particles, highlight, held item
  player/    physics (swept AABB), raycast (DDA), player controller + survival rules
  input/     input manager (keyboard/mouse/pointer lock/gamepad), touch controls
  game/      game loop, interaction, inventory, crafting, items, mobs, settings, adaptive quality
  save/      IndexedDB store (+ memory fallback), serialization (RLE chunks, validated metadata)
  audio/     procedural Web Audio engine
  ui/        HUD, menus, settings, inventory screen, icons
```

## Third-party code & research

| Source | License | Use |
|---|---|---|
| [three.js](https://github.com/mrdoob/three.js) | MIT | Rendering library (npm dependency) |
| [qonqulab/voxelcraft](https://github.com/qonqulab/voxelcraft) | MIT (verified) | License checked; no code used |
| [Vincent-P-essy/minecraft-clone](https://github.com/Vincent-P-essy/minecraft-clone) | MIT (verified) | License checked; no code used |
| [takeokunn/ts-minecraft](https://github.com/takeokunn/ts-minecraft) | MIT (verified) | License checked; no code used |
| [zimkk/mynecraft](https://github.com/zimkk/mynecraft) | MIT (verified) | License checked; no code used |
| ItsAbdujabbor/voxelcraft | No LICENSE file found | Not used (unlicensed code can't be reused) |
| Aymanbalaa/voxel-craft | No LICENSE file found | Not used (unlicensed code can't be reused) |

BlockForge was implemented independently using well-known public techniques: simplex noise, DDA voxel raycasting, swept-AABB collision, greedy meshing and vertex AO.
All game code, procedural textures, icons, sounds and the logo are original to this project.
