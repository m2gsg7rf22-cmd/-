# Stealth kit (`engine/gameplay/stealth.js`)

Light-aware vision, a suspicion meter, noise, guard brains, hiding spots, takedowns and body discovery.
Guards and the player are any `{ position, facing }`; game `Actor`/`NPC`/`Enemy` objects are driven through
their controller and animation automatically (and get `?` / `!` markers over their heads).

```js
const stealth = new GF.StealthSystem({ physics: app.physics, radio: 2,
  lightLevel: GF.lightProbe(app.scene, { physics: app.physics, atmosphere: app.atmosphere }) });
const g = stealth.addGuard(npc, { route: [[-8, 0, -8], { pos: [2, 0, -2], wait: 3, look: Math.PI }], sight: 18 });
stealth.addHidingSpot({ center: bush.position, radius: 1.6, factor: 0.08 });      // or { box: Box3 }
stealth.setPlayer(player, () => ({ crouched: player.crouching, speed: player.ctrl.horizontalSpeed() }));
app.add((dt) => { stealth.update(dt); if (input.pressed('interact')) { const t = stealth.nearestTakedown(); if (t) stealth.takedown(t); } });
stealth.noise(bottle.position, 12, 'bottle');              // distractions; running and gunshots are noises too
stealth.on('alert', ({ at }) => wanted.reportCrime('trespass', at));   // escalate to combat / wanted
```

**Model.** `lightProbe` sums sun (shadow-tested), point/spot lights (falloff, cone, line of sight) and ambient →
0..1, cached per 0.5 m cell. A guard's sight of the player = cone (110° full, 160° peripheral at 35 %) × distance
falloff × light (dark ≈ 8 %, except at arm's length) × occlusion; × stance (crouch 0.55, sprint +35 %) × hiding
factor. Suspicion += sight evidence − constant decay, so faint glimpses never accumulate.

**States.** `patrol` → (suspicion > 0.3) `suspicious` (stops, stares, "?") → (> 0.6 or a noise) `investigate`
(walks to the last known point) → `search` (4 points around it, ≤ 20 s) → `patrol`. Full suspicion while seeing
the player, or finding a body → `alert` ("!"); after `radio` seconds every other guard goes to alert.
Takedown: player within 1.4 m behind the guard (≥ 110° off its facing) or guard unaware; the guard dies
(death clip / ragdoll) and leaves a body that other guards can discover in their light-weighted view.

**Movement.** Default mover walks straight lines; in real levels pass `moveTo(guard, point, speed, dt) → arrived`
backed by the navmesh — simply `addGuard(npc, { route, navmesh })` (uses `navMover(navmesh)`, re-plans when doors/obstacles change the mesh; references/navigation.md).

**Level design numbers.** Lit pools 6–10 m apart, dark gaps ≥ 4 m; patrol loops 20–40 s with 2–4 s look-waits;
every lit choke point needs an alternative (shadow route, distraction, vent); one hiding spot per 15 m of route.
Debug: `scene.add(stealth.debugGroup())` and call `.userData.update()` per frame (cones coloured by state).
Test scene: `tests/scenes/stealth` (16 checks). Save: `stealth.serialize()` / `load()`.
Limits: no vertical sight cones (guards see through floors if no collider blocks), sound uses straight-line
occlusion (walls halve the radius), no group search coordination beyond the radio alarm.
