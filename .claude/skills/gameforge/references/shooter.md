# Shooter kit: ranged combat for third- and first-person games

Use this kit for gunplay. It covers over-the-shoulder shooters in the GTA / Uncharted / Gears
style, first-person shooters, twin-mode games (press V to switch view) and ranged enemies in
action games. Everything is in `engine/index.js`, in the separate "Shooter kit" export block:

| Module | Contents |
|---|---|
| `engine/gameplay/shooter.js` | weapon data and math, `WeaponState`, hitboxes and `hitscan`, `WeaponSystem`, `ShootingTarget`, `ShooterController`; also defines the animation poses and gun sounds |
| `engine/gameplay/cover.js` | `CoverSystem`: cover faces, edges, peek points, protected spots for AI, claim registry |
| `engine/gameplay/shooter-ai.js` | `RangedEnemy`, `RANGED_TYPES`, `aiAimError` |
| `engine/gameplay/weapon-models.js` | `weaponModel(kind)`: firearms built with the Modeling Kit |
| `engine/camera/cameras.js` | `ThirdPersonCamera` aim mode and shoulder swap; `FirstPersonCamera` |
| `engine/ui/ui.js` | `ui.reticle()`, `ui.ammoCounter()`, `ui.hitIndicator()` |

Reference scene and proof that it works: `tests/scenes/shooting-range/` (42 playtest checks).
Run it with `node tools/playtest.mjs tests/scenes/shooting-range`.

## Minimal setup

```js
const player = new GF.Player(app, { combat: false, hp: 150, position });   // combat:false = no melee kit
player.targets = () => [...enemies, ...targets].filter((t) => t.alive);
const shooter = new GF.ShooterController(app, player, { weapons: ['rifle', 'pistol', 'shotgun'] });
const cover = new GF.CoverSystem(app.physics);                                // ONE per level, shared by the squad
const enemies = spawns.map((p, i) => new GF.RangedEnemy(app, { type: 'rifleman', position: p, cover, seed: i, targets: () => [player] }));
app.add((dt) => {
  shooter.control(dt);                                   // replaces player.control(dt)
  for (const e of enemies) { e.think(dt, player); e.update(dt); }
  GF.separateActors([player, ...enemies]);
});
app.debugState = () => ({ ...shooter.debug(), enemies: enemies.map((e) => e.debug()) });
```

Static colliders (`app.physics.addStatic` / `addFromObject`) are cover automatically. A box or
cylinder counts as cover when it is at least 0.85 m tall. Below 1.5 m it is **low** cover: the
agent crouches and shoots over it. From 1.5 m up it is **high** cover: the agent peeks around
an edge. To exclude a collider, set `userData.noCover`.

## Controls (`DEFAULT_BINDINGS`, existing actions unchanged)

| Action | Keys / pad | Use |
|---|---|---|
| `fire` | Mouse0 (left button), RT | fire (held for auto weapons) |
| `aim` | Mouse2 (right button), LT | aim down sights / over the shoulder; `aimToggle: true` makes it a toggle |
| `reload` | T, R, X (pad) | reload |
| `cover` | X key, B (pad) | snap to cover, or leave it |
| `shoulderSwap` | Z, R3 | swap the camera shoulder |
| `weapon1-4`, `weaponNext/Prev`, mouse wheel | 1–4, N/B, Y (pad) | switch weapon |
| `camera` | V | switch between third- and first-person |

Playtests drive the same actions: `__GF.hold('aim')`, `__GF.press('fire', 2)`,
`__GF.press('cover', 2)`.

## Weapons (data-driven)

`GF.WEAPONS` holds `rifle` (auto), `carbine` (3-round burst), `smg`, `pistol` (semi),
`shotgun` (9 pellets, shell-by-shell reload), `sniper` and `launcher` (projectile with splash).

Add or tune a weapon with `GF.defineWeapon(id, { ...fields })`. Nested objects merge with
`WEAPON_DEFAULTS`. To make a one-off variant, pass `{ base: 'rifle', damage: 30 }` anywhere a
weapon is accepted.

| Field | Meaning |
|---|---|
| `mode` `rpm` `burst` `burstDelay` | fire mode and cadence |
| `damage` `pellets` `headMult` `limbMult` | damage per bullet or pellet; zone multipliers |
| `falloff { start, end, min }` `range` | full damage up to `start`, linear down to `min × damage` at `end`, 0 beyond `range` |
| `spread { hip, ads, move, air, crouch, bloom, bloomMax, recovery, pellet }` | cone half-angles in degrees. Bloom grows per shot and recovers per second |
| `recoil { pattern, kick, jitter, recover, reset, adsMult }` | per-shot `[yaw, pitch]` pattern × `kick` in degrees; `recover` is the share of the climb that settles back after firing |
| `magazine` `reserve` `reloadTime` `reloadEmptyTime` `reloadPerShell` `autoReload` | ammo state machine |
| `equipTime` `adsTime` `adsFov` `adsSpeed` `moveSpeed` | handling |
| `hitscan` / `projectile { speed, gravity, radius, splash { radius, damage, min } }` | bullets or rockets/grenades (uses `ProjectileSystem`) |
| `sound` `tracer` `flash` `knockback` `stagger` `impulse` `model` `pose` `hold` `ai { burst, range, accuracy }` | feel and visuals; hints for the AI |

### Events

`WeaponSystem.on(name, fn)` takes these names: `shot`, `hit` (`{ target, damage, zone,
distance, kill }`), `kill`, `reloadStart`, `reload`, `empty`, `equip`, `impact`, `explode`,
`cover`. The same events go out on `app.events` as `weapon:<name>`. A player's kill of an
enemy also emits `enemy:killed`.

### Hit detection

`hitscan` returns the nearest hit across terrain, static colliders, dynamic bodies (which it
pushes) and actor hitboxes. By default an actor has a head sphere, a body cylinder and a limb
cylinder, and they shrink when `actor.crouching`. To override them for a custom creature or
vehicle, assign `target.hitboxes = () => [...]`.

In third person, the shot starts from the camera ray. That ray begins level with the player,
so nothing behind them is hit. The bullet then flies from the muzzle to the aimed point, so
cover between the muzzle and the target still blocks it.

## Design method: weapon feel

1. **Start from a role, not numbers.** Rifles are reliable at mid range, SMGs win up close,
   pistols are the sidearm, shotguns are point-blank burst, snipers are precision with a slow
   cycle, and launchers handle area denial and vehicles.
2. **Set TTK first, then derive damage.** Use `GF.timeToKill(def, hp, { distance, zone })`. With
   the defaults against 100 HP:

   | Weapon | 0 m | 20 m | 50 m | head @ 20 m |
   |---|---|---|---|---|
   | rifle | 5 shots / 0.39 s | 5 / 0.39 s | 6 / 0.48 s | 3 / 0.19 s |
   | carbine | 4 / 0.48 s | 4 / 0.48 s | 6 / 0.80 s | 2 / 0.16 s |
   | smg | 7 / 0.40 s | 9 / 0.53 s | 13 / 0.80 s | 6 / 0.33 s |
   | pistol | 4 / 0.43 s | 4 / 0.43 s | 7 / 0.86 s | 2 / 0.14 s |
   | shotgun | 1 / 0 s | 4 / 2.57 s | out of range | 3 / 1.71 s |
   | sniper | 2 / 1.33 s | 2 / 1.33 s | 2 / 1.33 s | 1 / 0 s |

   Launcher figures are direct hits only; splash does the real work. Typical targets: player
   TTK against enemies of 0.3–0.6 s with perfect aim; enemy TTK against the player of 3 s or
   more on normal difficulty. Keep TTK differences between weapons within about 2× at their
   intended range, and make range, not raw DPS, the deciding factor.
3. **Feel comes from feedback, not damage.** Each shot gets a muzzle flash, a sound with pitch
   jitter, a tracer, recoil kick plus recovery, a hit marker (a different colour for headshots
   and kills), impact particles, `damageNumber` and a directional hit indicator. Use
   `app.hitStop` sparingly, on kills only.
4. **Recoil should be learnable.** Use a fixed `pattern` with small `jitter`. First shots are
   accurate because bloom starts at 0. Aiming multiplies recoil by `adsMult`.
5. **Movement trades with accuracy.** Use `spread.move`, `spread.air` and `adsSpeed`. Crouching
   multiplies spread by `spread.crouch`.
6. **Check feel with screenshots** while aiming, firing and in first person. A playtest must
   prove that ammo decreases, reload restores it and hits deal damage.

## Encounter design

- **Cover layout.** Give each enemy group 2–4 low walls (1.0–1.3 m) and one or two high
  pillars, spaced 4–8 m apart, so both flanking routes exist. Leave the player cover 15–30 m
  from enemy cover for rifles (`RANGED_TYPES.*.stats.preferred`).
- **Mixed squads.** Put riflemen at mid range, a gunner or shotgunner who pushes, and one
  marksman far back with a slow reaction. All of them share one `CoverSystem` so they claim
  different spots.
- **AI loop.** The AI picks cover protected from the target, then hides for `hide` seconds,
  peeks (stands up, or steps past the edge of high cover), waits `reaction` before shooting
  and fires a burst. When hit, it goes back into hiding (suppression). It reloads in cover.
  If it has had no line of sight for `flankAfter` seconds, it moves to a cover spot at least
  40° around the target. Without cover it strafes at its preferred range.
- **Fairness.** AI aim error, from `aiAimError`, grows with distance, the AI's own movement,
  the target's speed and a target in cover. Accuracy warms up during the first 1.2 s of
  aiming, so the first shots are warnings. Damage is scaled with `stats.damageMult`. After each
  hit the player gets 0.45 s of invulnerability from `Player.onDamage`. For difficulty, scale
  `skill`, `damageMult`, `reaction` and the squad size, not HP.
- **Gunshots are loud.** Shots set `app.shooterNoise`, which alerts AI within 40 m.

## Cameras

- **Third person.** `ThirdPersonCamera` has `.aiming`, which blends to `aimDistance`,
  `aimShoulder`, `aimHeight` and the weapon's `adsFov`. `.shoulderSide = ±1` swaps the
  shoulder, and the pivot is pulled in so it does not clip into walls. In high cover the
  controller swaps the shoulder towards the edge it peeks from. The player strafes (faces the
  camera) while aiming, firing and for 0.8 s after firing; otherwise they face their movement.
- **First person.** `FirstPersonCamera` has the same API, so `shooter.setView('first')` swaps
  rigs. The body is hidden and a viewmodel (the same Modeling-Kit gun) is parented to the
  camera, with bob, kick and reload dip. Scoped weapons with `adsFov` < 25 show a scope overlay.

## Accessibility

- **Aim assist.** Pass `aimAssist: { strength 0–1, angle (deg), friction, magnetism (deg) }`.
  It snaps towards a visible target when ADS starts, slows sensitivity over targets (friction)
  and bends shots that miss narrowly towards the body (magnetism). Enable it by default for
  gamepad and touch, keep it off or low for mouse, and expose it in settings.
- **Other options:**
  - `aimToggle: true` for players who cannot hold a button.
  - `adsSensitivity` sets the look-speed multiplier while aiming; FOV compensation is
    automatic.
  - Hit indicators show direction without relying on audio. Hit markers use both colour and
    shape.
  - `reducedMotion` lowers screen shake. First-person head bob is small and fades out when
    aiming.
- **Subtitles for gunfire are not needed. Do label threats** with UI prompts or toasts for
  deaf players: a toast on the first enemy contact, plus the hit indicator.

## Visuals

`GF.weaponModel(kind, colours)` builds firearms with the Modeling Kit using the convention
from `models/scifi-rifle.model.js`: the grip is at the origin, the muzzle points along +Z, +Y
is up, and sockets are child objects named `socket_grip`, `socket_muzzle`, `socket_offHand` and
`socket_sight` (also listed as arrays in `userData.sockets`). `GF.attachFirearm(actor, model)`
puts it in `hand_R`. Realistic humans use the socket directly. The stylized mannequin's
sword-oriented socket is wrapped by a 180° mount.

For a hero weapon, author your own `*.model.js`, review it with `gameforge model`, then pass
the result as `st.model`, or extend `weapon-models.js`.

## Known limitations

- Aim poses are procedural upper-body clips without IK. The gun points roughly, not exactly,
  along the aim ray; bullets always follow the aim ray.
- Hitboxes are analytic (sphere/cylinder/box) per actor, not per bone. A ragdoll or
  per-limb reaction would need extra work.
- Cover detection uses static boxes and cylinders only. Spheres, heightfield ridges and
  dynamic bodies are not cover.
- AI movement steers in a straight line to cover spots, with no NavGrid path. On complex maps,
  feed `GF.NavGrid` paths into `RangedEnemy` (override `_findSpot` / the move logic).
- The first-person viewmodel can clip into walls. There is no separate viewmodel render pass.

## Shouldered long guns on characters (realistic humans and stylized rigs)
A rifle parented to `hand_R` looks wrong on a realistic body (arms stretched, support hand floating).
For third-person characters holding long guns use `ShoulderedWeapon` (engine/gameplay/weapon-pose.js):
```js
const ik = new GF.CharacterIK(model, { ground: GF.groundFromPhysics(app.physics) });
const sw = new GF.ShoulderedWeapon(model, GF.weaponModel('rifle'), ik, { mode: 'aim' }); // 'aim' | 'ready' | 'hip'
sw.setAim(targetPoint);       // optional: barrel points at it (else straight ahead)
// each frame: mixer.update(dt); ik.update(dt);  — the weapon is posed inside the IK pass
```
It places the butt in the shoulder pocket, blades the torso (support shoulder forward), leans the spine,
drops the head onto the stock (cheek weld), and solves both hands with two-bone IK onto the weapon's
`grip` / `offHand` sockets; the support hand slides back along the barrel when the arm cannot reach.
Switch `sw.mode` for low ready while moving and `aim` when the aim button is held. `sw.dispose()` releases the hands.
Preview: `sandbox/armed.html?mode=aim&weapon=rifle&az=0&cx=2.4&cy=1.5&cz=0.6`. Unit test: `tests/unit/ik.test.mjs`.
Limits: fingers keep the socket's fist pose (no per-finger wrap); no weapon–body collision.
`WeaponSystem` does this automatically when the owner is a realistic human with IK (`Actor.ik`): long guns
(everything except `pistol` / `oneHanded` defs) are shouldered — low ready when idle, `aim` while aiming,
firing or within 0.8 s of a shot, barrel on the aim point. Opt out with `{ shouldered: false }`.
Regression: `node tools/playtest.mjs tests/scenes/shooting-range --query humans=1` (realistic humans).

## With `composeGame`
Set `spec.player.weapons: ['pistol', 'rifle']` (and optional `spec.player.shooter` options): the composer creates
`game.shooter` (a ShooterController) and routes on-foot control through it. To supply your own on-foot controller from a
module, replace `game.controlOnFoot = (dt) => myShooter.control(dt)` — never call `player.control(dt)` in addition:
ShooterController already calls it (calling both moves the player twice per frame).
