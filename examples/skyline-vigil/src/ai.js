// Owned by: AI Engineer — enemy/NPC behaviours beyond the defaults.
// install(game) runs after the baseline is composed and before the game starts.
// Spawns three neon street gangs at city intersections. Gangs idle on their corner until
// the player comes close (or one of them is hit), then the whole gang turns on the player.
// Exposes game.gangs = [{ name, center, members, alerted }] and __GF.cheat.goToGang/killGang.
import * as GF from '../../../engine/index.js';

const { Vector3 } = GF.THREE;

const ALERT_RADIUS = 25;   // player within this of the gang centre -> gang engages
const LEASH_RADIUS = 70;   // player further than this -> gang gives up and returns home
const MIN_SPAWN_DIST = 70; // gang corners at least this far from the player spawn

// Neon gang colour schemes (look params for createHumanoid).
const GANGS = [
  { name: 'Volt Saints', look: { top: 0x10e0ff, bottom: 0x0a1a2a, accent: 0xfff23a, hairStyle: 'mohawk', hair: 0x10e0ff } },
  { name: 'Magenta Kings', look: { top: 0xff2a9a, bottom: 0x1a0a1a, accent: 0xffffff, hairStyle: 'buzz', hair: 0x2a0a1a } },
  { name: 'Toxic Lime', look: { top: 0x7aff2a, bottom: 0x101a10, accent: 0xff6a00, hairStyle: 'mohawk', hair: 0x7aff2a } },
];

function pickIntersections(city, spawn, count) {
  const rc = city.roadCenters, all = [];
  for (const x of rc) for (const z of rc) {
    const d = Math.hypot(x - spawn.x, z - spawn.z);
    if (d >= MIN_SPAWN_DIST) all.push({ x, z, d });
  }
  // nearest-first, but keep gangs at least one block apart from each other
  all.sort((a, b) => a.d - b.d);
  const picked = [], minSep = (city.pitch || 70) * 0.99;
  for (const p of all) {
    if (picked.length >= count) break;
    if (picked.every((q) => Math.hypot(p.x - q.x, p.z - q.z) >= minSep)) picked.push(p);
  }
  for (const p of all) { if (picked.length >= count) break; if (!picked.includes(p)) picked.push(p); }
  return picked;
}

export function install(game) {
  const { player, city } = game;
  if (!city || !player) return;
  const groundAt = game.groundAt || (() => 0.2);
  const spawn = player.position.clone();
  const spots = pickIntersections(city, spawn, GANGS.length);
  game.gangs = [];

  spots.forEach((spot, gi) => {
    const def = GANGS[gi];
    const center = new Vector3(spot.x, groundAt(spot.x, spot.z), spot.z);
    const gang = { name: def.name, center, members: [], alerted: false };
    const roster = ['thug', 'thug', 'grunt'];
    if (gi === GANGS.length - 1) roster.push('brute');
    roster.forEach((type, mi) => {
      const a = (mi / roster.length) * Math.PI * 2 + gi * 0.7, r = type === 'brute' ? 1.5 : 4;
      const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
      const pos = new Vector3(x, groundAt(x, z) + 0.5, z);
      const isLeader = type === 'brute';
      const look = { ...def.look, ...(type === 'grunt' ? { outfit: 'casual', armor: false, coat: true, beard: false } : {}), ...(isLeader ? { helmet: false, hairStyle: 'bald', capeColor: def.look.accent } : {}) };
      const extra = { look, name: `${def.name} ${type}`, facing: Math.atan2(center.x - x, center.z - z) };
      if (isLeader) Object.assign(extra, { hp: 420, scale: 1.4 });
      const e = game.spawnEnemy(type, pos, extra);
      e.gang = gang;
      if (isLeader) { e.isBoss = true; e.name = 'Gang Boss'; game.boss = e; }
      // passive until the gang is alerted
      const think = e.think.bind(e);
      e.think = (dt, target) => {
        if (!gang.alerted && target && target.alive && horiz(target.position, center) < ALERT_RADIUS) alertGang(gang);
        if (gang.alerted && target && horiz(target.position, center) > LEASH_RADIUS && e.perception.aware < 0.9) calmGang(gang);
        if (!gang.alerted) { e.perception.aware = 0; return think(dt, null); }
        return think(dt, target);
      };
      e.on('damage', () => alertGang(gang));
      gang.members.push(e);
    });
    game.gangs.push(gang);
  });

  const cheat = (window.__GF ||= {}).cheat ||= {};
  cheat.goToGang = (i = 0) => {
    const g = game.gangs[i]; if (!g) return false;
    const dir = spawn.clone().sub(g.center).setY(0); if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0);
    const p = g.center.clone().add(dir.normalize().multiplyScalar(6)); p.y = groundAt(p.x, p.z) + 0.3;
    player.ctrl.teleport(p); if (game.vehicle) game.vehicle.resetOnRoad(p, 0);
    return true;
  };
  cheat.killGang = (i = 0) => {
    const g = game.gangs[i]; if (!g) return 0; let n = 0;
    for (const e of g.members) if (e.alive) { e.health.damage(1e9, {}); n++; }
    return n;
  };
}

function horiz(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }

function alertGang(gang) {
  if (gang.alerted) { for (const m of gang.members) if (m.alive) m.perception.aware = Math.max(m.perception.aware, 1); return; }
  gang.alerted = true;
  for (const m of gang.members) if (m.alive) m.perception.aware = 1;
}

function calmGang(gang) {
  // only give up when nobody in the gang has been hit recently / is fully aware
  if (gang.members.some((m) => m.alive && m.perception.aware >= 0.9)) return;
  gang.alerted = false;
}
