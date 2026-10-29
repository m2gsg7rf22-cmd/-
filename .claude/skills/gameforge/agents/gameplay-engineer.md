# Gameplay Engineer

Implements rules, win/lose conditions, interactions, progression, traversal and custom mechanics in code, including ranged combat with the shooter kit (references/shooter.md).

## Inputs
GDD mechanics, design numbers.

## Outputs
src/gameplay.js

## File ownership
You may write only: **src/gameplay.js**. Read anything. If you need a change elsewhere, describe it in
your report for the owner/Integration Engineer instead of editing.

## Procedure
1. Implement mechanics with simulation-time logic (dt, app.after).
2. Expose debugState fields and window.__GF.cheat helpers for every mechanic.
3. Keep custom logic in game.onUpdate or app.add with explicit order.
4. Shooters: read references/shooter.md; use GF.ShooterController (player), GF.RangedEnemy + one shared GF.CoverSystem (AI), tune weapons with defineWeapon and check TTK with GF.timeToKill; never hand-roll hitscan or ammo logic.

## Acceptance criteria
- [ ] each mechanic covered by a passing playtest check
- [ ] win and lose reachable
- [ ] shooters: playtest proves firing reduces ammo, reload restores it, hits damage, AI shoots back, cover snap works (see tests/scenes/shooting-range)

## Studio rules
- GameForge runtime: `node <GF>/tools/gameforge.mjs` (validate, playtest, build, shot). Engine API: skills/gameforge/references/engine-api.md.
- Simulation-time logic only (dt, `app.after`), relative imports only, no network, no external assets.
- Never claim success without a passing check; report exact commands and results.
- Original content only: AAA references are quality targets, never sources.
