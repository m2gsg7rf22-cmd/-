# BlockForge — QA Report

Environment: headless Chromium 141 (Playwright 1.56) with **SwiftShader software WebGL**, on a 4-core Linux VM with no GPU.
No real phone, Safari or Firefox was available. Touch was tested via CDP touch-event emulation.

## Automated results (final run)

| Suite | Result |
|---|---|
| TypeScript typecheck | PASS |
| Unit tests (vitest) | **68 / 68** |
| Production build (`vite build`) | PASS |
| Desktop E2E flow (`qa:e2e`) | **23 / 23** |
| Multitouch / mobile (`qa:touch`) | **15 / 15** |
| Responsive layouts (`qa:responsive`) | **11 / 11 viewports, 0 layout issues** |
| Controlled failures (`qa:failures`) | **10 / 10** |
| Bug hunt (`qa:bughunt`) | **13 / 13** |
| Long-travel memory (`qa:memory`) | PASS (heap 18–29 MB, chunks bounded at 86–118) |
| Visual tour (`qa:visual`) | 0 console errors; screenshots reviewed by eye |

## QA matrix

| | Desktop Chromium | Mobile-size Chromium + touch (landscape) | Portrait (touch) | Desktop Safari |
|---|---|---|---|---|
| Boot | PASS | PASS | PASS | not available |
| Menu | PASS | PASS | PASS | — |
| World load | PASS | PASS | PASS (rotate prompt + continue) | — |
| Movement | PASS | PASS (joystick, axes verified) | PASS | — |
| Camera | PASS (mouse, inversion verified) | PASS (drag, inversion verified) | PASS | — |
| Jump | PASS (+ ceiling bump) | PASS (with move + look multitouch) | PASS | — |
| Mine | PASS | PASS | — | — |
| Place | PASS (+ not inside player) | PASS | — | — |
| Inventory / craft | PASS | PASS (tap-select/move) | layout PASS | — |
| Save | PASS | — | — | — |
| Reload / load | PASS (position, inventory, block edits, settings) | — | — | — |

## Bugs found and fixed during QA
- `mod()` returned `-0` for negative multiples of 16.
- Mesher buffer growth: uv/light capacity was smaller than position capacity, which crashed on large chunks.
- Spawn could land on treetops, or in 1×1 pits enclosed by hills/bushes.
- Bulk block edits re-meshed synchronously per block, stalling the page for seconds.
- Chunk streaming was throttled by frame rate on slow GPUs.
- **Mobile:** the hotbar couldn't be tapped because the touch layer sat above the HUD.
- **Mobile:** touch buttons stayed pressed when the finger slid off (implicit pointer capture).
- Hotbar overflowed by 3 px at 360 px portrait.
- Distant terrain showed as white "ghost" silhouettes; fog now matches the sky gradient.
- Stars appeared during sunset and looked like snow.
- Greedy-mesh T-junction cracks showed sky "sparkles" in caves.
- Fall damage was off by one (fall start was measured after the first move).
- Pointer-lock fallback was enabled permanently after a single transient denial.

## Performance notes
- **Worldgen and meshing:** about 6 ms generation and about 9 ms meshing per chunk (Node, warm), both run in Web Workers.
- **Greedy meshing:** reduced triangles by about 21% on mixed terrain (cross-plants dominate the remainder).
- **Frame cost:** under SwiftShader, JS frame cost was about 16 ms with 69 draw calls at render distance 4. The ~5–10 FPS seen was limited by software rasterization.
- **Real-GPU FPS was NOT measured:** no hardware GPU was available. Adaptive quality is implemented and unit-tested.

## Round 2 (new features) — automated results
| Suite | Result |
|---|---|
| Unit tests | **81 / 81** (adds fluids, block light, shapes, sections, shape raycast, slab step-up) |
| Feature QA (`scripts/features.mjs`) | **11 / 11** |
| Spawn quality (`scripts/spawns.mjs`) | 8 / 8 random seeds on natural ground |
| Desktop E2E | 23 / 23 |
| Touch | 15 / 15 |
| Failures | 10 / 10 |
| Bug hunt | 13 / 13 |
| Memory | PASS |
| Responsive | 11 / 11 viewports |
| Single-file build (`file://` and wrapped artifact page) | boots, generates terrain in an inline worker, saves to IndexedDB, 0 errors |

Feature QA covers:
- torch placement and night lighting
- slab placement and slab-to-full-block merge
- stairs orientation
- door placement, open/close, and breaking (both halves removed, one door dropped)
- step-up onto slabs
- water flow and receding
- item drop + pickup, and Q to throw
- minimap and compass rendering
- creature persistence across reload

Bugs found and fixed in round 2:
- Chunks with light emitters relit all neighbors on load, which multiplied meshing work during streaming.
- The compass never drew (NaN initial heading).
- Spawning into a canopy when no open ground was nearby.
- Dropped items in a freshly mined hole were just out of pickup reach.

## Round 3 (controllers + mode switch) — automated results

| Suite | Result |
|---|---|
| Unit tests | **86 / 86** (adds controller detection, glyphs, deadzone, spatial menu navigation, settings sanitizing) |
| Controller QA (`npm run qa:gamepad`) | **13 / 13** on repeated runs |
| Desktop E2E | 23 / 23 |
| Touch | 15 / 15 |
| Failures | 10 / 10 |
| Bug hunt | 13 / 13 |
| Feature QA | 11 / 11 (one earlier run missed the slab-merge check; it passed on the next two runs) |

`scripts/gamepad.mjs` drives a virtual controller by replacing `navigator.getGamepads` before the page loads. It covers:
- detection and the menu prompt bar
- D-pad navigation to New World
- picking Creative and creating the world, using only the controller
- Xbox glyph hints in the HUD
- stick movement and look direction (not inverted)
- creative flight toggle, ascend and descend
- RB/LB hotbar cycling
- RT mining
- Y inventory → RB library tab → A take → B close → LT place
- Start pause → switch to Survival → B resume
- the A press that closes a menu doesn't make the player jump
- after swapping to a DualSense, the prompts change to ✕ ○ □ △ / R2 / L2
- unplugging the controller mid-game pauses it

Limits: these tests use a simulated controller, not physical hardware. Button positions follow the W3C "standard" mapping, which Chrome, Edge, Firefox and Safari use for Xbox, DualShock/DualSense and Switch Pro controllers. Rumble uses `vibrationActuator`, which some browsers (notably Firefox) don't support; there it is silently skipped.

Bugs found in round 3:
- The detection regex classified "Xbox Wireless Controller" as PlayStation, because a DualShock 4 also reports the name "Wireless Controller". Xbox is now checked first.
- Center-to-center spatial navigation skipped the narrow mode buttons, so it now uses edge distance with a sideways penalty.
- Test harness: button presses shorter than a slow software-GL frame were sometimes missed, so presses now wait for real animation frames. Terrain-dependent aiming was replaced with a flat platform fixture.
- E2E: the mine-and-collect check now waits for the dropped item to be picked up, since drops are entities.
- Single-file build: opened by double-click (plain `file://`, no browser flags), Chrome refused the inlined *module* worker, so terrain generation silently fell back to the slower main thread. This was pre-existing; the earlier single-file test launched Chrome with `--allow-file-access-from-files`, which hid it. The single build now inlines a classic (IIFE) worker. Verified with 3 workers and no fallback from `file://`, in the wrapped artifact page, and in the full controller suite run on `release/BlockForge.html` (13 / 13).

## Round 4 (dimensions, creatures, textures, mining) — automated results

| Suite | Result |
|---|---|
| Unit tests | **105 / 105** (adds rift frames: light, refuse, collapse, build/find; Emberdeep and Voidreach generators: determinism, sealing, magma level, seams, gate/plaza, spires; dimension save validation; content; tile-flag packing; swing curve) |
| Dimension QA (`npm run qa:dimensions`) | **16 / 16** |
| Desktop E2E | 23 / 23 |
| Touch | 15 / 15 |
| Failures | 10 / 10 |
| Bug hunt | 13 / 13 |
| Feature QA | 11 / 11 |
| Controller QA | 13 / 13 |
| Responsive | 11 / 11 viewports |

`scripts/dimensions.mjs` covers:
- lighting a Duskstone frame with the Ember Striker; an open frame does not light
- rift → Emberdeep, arriving inside a linked rift, with no bounce-back
- Emberdeep terrain contents
- magma damage
- rift back to the exact overworld portal
- breaking the frame collapses the rift
- the Void Gate round trip through Voidreach
- death in Emberdeep → overworld spawn
- save and page reload while in Emberdeep
- per-dimension creature spawning
- a line-up of all 10 creatures
- projectile damage
- the mining swing producing chips, crack stages and a broken block

Bugs found and fixed in round 4:
- After reloading a save made while standing in a rift, the player was immediately pulled back through it. Any world load now starts with the rift lock set, until the player steps out.
- Lighting or collapsing a rift edits blocks from inside the block-change hook, which re-validated half-built rift sheets. The portal module now guards against re-entry.
- Creatures spawned too rarely in Emberdeep and Voidreach, because most random columns have no floor. Those dimensions now try several spots per spawn tick.

Known limits:
- Magma is a static liquid: it doesn't flow, and it doesn't interact with water.
- There is no boss in Voidreach.
- Only one Emberdeep portal is linked at a time; a new one is created when you light a rift far from the previous one.
- Tested under SwiftShader (software GL) in headless Chromium, not on physical GPUs or phones.

## Round 5 (Void Dragon, classic-style blocks, structures)

- Unit tests: **109 / 109**. New tests cover the dragon's attack choice, crystal cells matching the generated spire tops, purpur towers with Void Rods in Voidreach, and crimson turf and brick bridges in Emberdeep.
- Dimension QA: **21 / 21**. New steps:
  - the dragon spawns with a boss bar
  - its swoop damages the player
  - crystals heal it, and breaking them stops the healing
  - it perches, is killed in melee and leaves the egg
  - it stays slain after leaving and coming back

Bug found while testing: when the dragon died far from the plaza, its chunk wasn't loaded, so the egg placement failed silently. The egg now waits until the plaza chunk loads, and the placement is saved (`eggPlaced`).

## Round 6 (exit, names, classic-style travel)

- Unit tests: **113 / 113**. New tests cover: a 12-eye frame ring opens a 3×3 Void Portal (11 eyes don't), Void Sanctum generation (frame ring over a magma pool, brick hall), flint drops and the Flint and Steel / Void Eye recipes, and compass directions.
- Dimension QA: **26 / 26**. New steps:
  - the block name under the crosshair
  - the inventory name bar and the Travel group in the Block Library
  - the Rift Portal Kit
  - a Void Eye pointing to the sanctum, filling the frames through the real interaction path, the portal opening, and jumping in to Voidreach
  - ☰ → pause → Save & Exit → Exit Game → goodbye screen → back

Fixed while testing:
- The dragon sometimes overshot its perch and circled it forever, so it now slows down as it lands.
- The ☰ button can't be clicked while the mouse is locked, because the browser routes every click to the game. That's expected: Esc opens the menu then. The button is meant for touch and unlocked play, and the test covers it in that mode.
