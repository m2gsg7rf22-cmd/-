// Police force for the wanted system: ready-made spawn / despawn / update callbacks for WantedSystem.
// Low wanted levels send unarmed officers who chase and ARREST a player that stops resisting;
// from `armedFrom` stars officers are RangedEnemy shooters that use cover and pursuit assignments.
//
//   const police = policeForce(app, { player, cover, armedFrom: 2 });
//   const wanted = new WantedSystem({ ...police.callbacks, events: app.events });
//   app.add((dt) => { wanted.update(dt, player); police.update(dt, wanted); });
//   app.events.on('police:arrest', () => respawnAtStation());   // you decide the penalty
import * as THREE from '../vendor/three/three.module.js';
import { Enemy } from './actors.js';
import { RangedEnemy } from './shooter-ai.js';

export const POLICE_LOOK = { outfit: 'casual', top: 0x1f2c4a, bottom: 0x1a2236, accent: 0xd8c060, hairStyle: 'short', helmet: false };

/**
 * opts: player (Actor), cover (CoverSystem, optional), armedFrom 2, armedType 'rifleman' | 'gunner' | …,
 * arrest: { maxLevel 1, radius 1.6, time 2.0, maxSpeed 1.2 } (player must stand still near an officer),
 * look (outfit overrides), hp, onSpawn(unit), events (defaults to app.events).
 */
export function policeForce(app, { player, cover = null, armedFrom = 2, armedType = 'rifleman', arrest = {}, look = {}, hp = null, onSpawn = null, events = app.events } = {}) {
  const A = { maxLevel: 1, radius: 1.6, time: 2.0, maxSpeed: 1.2, ...arrest };
  let wantedRef = null; const state = { arrestT: 0, arrests: 0, armedSpawned: 0, officersSpawned: 0 };
  const spawn = (pos) => {
    const lvl = wantedRef?.level ?? 1, armed = lvl >= armedFrom;
    const opts = { position: new THREE.Vector3(pos.x, (pos.y ?? 0) + 0.1, pos.z), facing: 0, look: { ...POLICE_LOOK, ...look }, tags: ['police'] };
    const u = armed ? new RangedEnemy(app, { ...opts, type: armedType, cover, targets: () => [player], ...(hp ? { hp } : {}) })
      : new Enemy(app, { ...opts, type: 'thug', hp: hp ?? 70, stats: { flee: false, damage: 4, moveSpeed: 4.4 } });
    u.police = true; u.armed = armed; armed ? state.armedSpawned++ : state.officersSpawned++;
    if (!armed && app.__enemies) app.__enemies.push(u);
    onSpawn?.(u); return u;
  };
  const despawn = (u) => { u.model?.removeFromParent(); u.alive = false; if (app.__enemies) { const i = app.__enemies.indexOf(u); if (i >= 0) app.__enemies.splice(i, 1); } };
  const unitUpdate = (u, dt, a) => {
    if (u.armed) { u.think(dt, player); u.update(dt); return; }
    // unarmed officer: run to the pursuit goal, melee only if the player fights back
    const dp = u.position.distanceTo(player.position);
    if (dp < 2.5) { // close in to cuffing distance and hold; fight back only if attacked (Enemy melee tree)
      if (u.health.value < u.health.max) { u.think(dt, player); u.update(dt); return; }
      u.move = dp > 1.0 ? player.position.clone().sub(u.position).setY(0).setLength(Math.min(2.5, dp * 2)) : new THREE.Vector3();
      u.state = 'arrest'; u.faceTowards(player.position, dt, 8); u.update(dt); return;
    }
    u.move = a.goal.clone().sub(u.position).setY(0); const d = u.move.length(); u.move.setLength(Math.min(d * 2, u.stats.moveSpeed)); u.state = 'chase'; u.update(dt);
  };
  const api = {
    state,
    callbacks: { spawn, despawn, update: unitUpdate, canSee: null },
    /** Call every frame after wanted.update: handles arrests. */
    update(dt, wanted) {
      wantedRef = wanted;
      // escalation: unarmed officers withdraw once the response is armed (the quota respawns armed units)
      if (wanted.level >= armedFrom) for (const u of wanted.units) if (u.alive !== false && !u.armed && u.position.distanceTo(player.position) > 0) { despawn(u); }
      if (!player?.alive || wanted.level === 0 || wanted.level > A.maxLevel) { state.arrestT = 0; return; }
      const still = (player.ctrl?.horizontalSpeed?.() ?? 0) <= A.maxSpeed;
      const near = wanted.units.some((u) => u.alive !== false && !u.armed && u.position.distanceTo(player.position) <= A.radius);
      state.arrestT = near && still ? state.arrestT + dt : Math.max(0, state.arrestT - dt * 2);
      if (state.arrestT >= A.time) { state.arrestT = 0; state.arrests++; wanted.clear(); events?.emit?.('police:arrest', { player }); }
    },
    /** 0..1 progress of an arrest in progress (for a HUD ring). */
    get arrestProgress() { return Math.min(1, state.arrestT / A.time); },
  };
  return api;
}
