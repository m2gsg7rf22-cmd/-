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
