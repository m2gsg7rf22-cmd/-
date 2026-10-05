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
