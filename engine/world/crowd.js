// Ambient pedestrians for generated cities: a sidewalk graph (block rings + crosswalks) for
// routing, places derived from the city lots (homes, work, shops, parks), schedule-driven
// agents (ai/schedules.js) and a visual LOD ladder per pedestrian:
//   near  -> realistic human clone (engine/humans.js crowd LOD), only if app.humans is set
//   mid   -> stylized mannequin (character/humanoid.js) with one shared material
//   far   -> hidden (simulation keeps running)
// The 6 MB human dataset stays optional: realistic pedestrians are only built when the game
// called app.useHumans(H, data) (or passes { humans }).
import * as THREE from '../vendor/three/three.module.js';
import { RNG } from '../core/rng.js';
import { createHumanoid } from '../character/humanoid.js';
import { characterFromSpec } from '../character/archetypes.js';
import { OUTFITS } from '../character/clothing.js';
import { CLIP_LIBRARY, buildClip } from '../animation/clips.js';
import { ScheduleAgent, ScheduleSystem, PlaceRegistry } from '../ai/schedules.js';
import { navMeshPlanner } from '../ai/navmesh.js';

const clampv = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * Sidewalk graph of a generateCity() result. Walk lines run along the middle of each block's
 * sidewalk band (`lane` shifts toward the curb (-) or the buildings (+)); corners connect
 * across the roads (crosswalks).
 */
export function sidewalkNetwork(city) {
  const n = city.blockCount ?? city.roadCenters.length - 1, pitch = city.pitch, half = city.half;
  const r = city.blockSize / 2 - (city.sidewalk ?? 4) / 2;
  const cOf = (i) => -half + pitch * (i + 0.5);
  const SG = [[-1, -1], [1, -1], [1, 1], [-1, 1]]; // corner k signs
  const nodes = [];
  const id = (i, j, k) => (j * n + i) * 4 + k;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) nodes.push({ id: id(i, j, k), i, j, k, x: cOf(i) + SG[k][0] * r, z: cOf(j) + SG[k][1] * r, edges: [] });
  const link = (a, b) => { nodes[a].edges.push(b); nodes[b].edges.push(a); };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    for (let k = 0; k < 4; k++) link(id(i, j, k), id(i, j, (k + 1) % 4));
    if (i + 1 < n) { link(id(i, j, 1), id(i + 1, j, 0)); link(id(i, j, 2), id(i + 1, j, 3)); }
    if (j + 1 < n) { link(id(i, j, 3), id(i, j + 1, 0)); link(id(i, j, 2), id(i, j + 1, 1)); }
  }
  const blockOf = (x, z) => [clampv(Math.floor((x + half) / pitch), 0, n - 1), clampv(Math.floor((z + half) / pitch), 0, n - 1)];
  const cornerPos = (nd, lane = 0) => { const rr = r - lane; return { x: cOf(nd.i) + SG[nd.k][0] * rr, z: cOf(nd.j) + SG[nd.k][1] * rr }; };
  // nearest point on the block ring + the two corners of that side
  function project(p, lane = 0) {
    const [i, j] = blockOf(p.x, p.z), cx = cOf(i), cz = cOf(j), lx = p.x - cx, lz = p.z - cz, rr = r - lane;
    let x, z, side;
    if (Math.abs(lx) >= Math.abs(lz)) { x = cx + Math.sign(lx || 1) * rr; z = cz + clampv(lz, -rr, rr); side = lx >= 0 ? [1, 2] : [0, 3]; }
    else { z = cz + Math.sign(lz || 1) * rr; x = cx + clampv(lx, -rr, rr); side = lz >= 0 ? [2, 3] : [0, 1]; }
    return { x, z, i, j, corners: side.map((k) => id(i, j, k)) };
  }
  // Dijkstra on ~4*n^2 nodes from a ring point to a ring point. Returns [{x,z}] incl. end.
  function path(from, to, lane = 0) {
    const a = project(from, lane), b = project(to, lane);
    const sameSide = a.i === b.i && a.j === b.j && a.corners[0] === b.corners[0] && a.corners[1] === b.corners[1];
    if (sameSide) return [{ x: b.x, z: b.z }];
    const N = nodes.length, S = N, T = N + 1, dist = new Float64Array(N + 2).fill(Infinity), prev = new Int32Array(N + 2).fill(-1), done = new Uint8Array(N + 2);
    const pos = (k) => (k === S ? a : k === T ? b : nodes[k]);
    const nbrs = (k) => { if (k === S) return a.corners; const e = k === T ? [] : nodes[k].edges.slice(); if (k !== T && b.corners.includes(k)) e.push(T); return e; };
    dist[S] = 0;
    for (;;) {
      let u = -1, best = Infinity; for (let k = 0; k < N + 2; k++) if (!done[k] && dist[k] < best) { best = dist[k]; u = k; }
      if (u < 0 || u === T) break; done[u] = 1;
      const pu = pos(u);
      for (const v of nbrs(u)) { const pv = pos(v); const d = best + Math.hypot(pv.x - pu.x, pv.z - pu.z); if (d < dist[v]) { dist[v] = d; prev[v] = u; } }
    }
    const out = []; let k = T; while (k !== -1 && k !== S) { out.push(k === T ? { x: b.x, z: b.z } : cornerPos(nodes[k], lane)); k = prev[k]; }
    return out.reverse();
  }
  function randomPoint(rng, lane = 0) {
    const i = Math.floor(rng.next() * n), j = Math.floor(rng.next() * n), t = rng.range(-r, r), s = Math.floor(rng.next() * 4);
    const cx = cOf(i), cz = cOf(j), rr = r - lane;
    return [{ x: cx + t, z: cz - rr }, { x: cx + rr, z: cz + t }, { x: cx + t, z: cz + rr }, { x: cx - rr, z: cz + t }][s];
  }
  return { nodes, ringRadius: r, blocks: n, project, path, randomPoint, blockOf, centerOf: cOf };
}

/** Places (home/work/shop/eat/park) from city lots, located at the sidewalk in front of each lot. */
export function placesFromCity(city, network = sidewalkNetwork(city)) {
  const reg = new PlaceRegistry();
  const KINDS = { house: ['home'], tower: ['home', 'work'], shop: ['shop', 'eat', 'work'] };
  for (const b of city.buildings || []) {
    const lot = b.userData.lot; if (!lot) continue;
    const p = network.project(b.position);
    reg.add({ id: `${lot.type}:${lot.block.join('-')}:${reg.list.length}`, kinds: KINDS[lot.type] || ['work'], kind: (KINDS[lot.type] || ['work'])[0], x: p.x, z: p.z, radius: 2.5, building: b });
  }
  for (const bl of city.blocks || []) if (bl.park) {
    const r = network.ringRadius;
    for (const [dx, dz] of [[0, -r], [r, 0], [0, r], [-r, 0]]) reg.add({ id: `park:${bl.bi}-${bl.bj}:${dx},${dz}`, kind: 'park', kinds: ['park'], x: bl.cx + dx, z: bl.cz + dz, radius: 6 });
  }
  if (!reg.of('park').length) for (const p of reg.list.filter((_, i) => i % 7 === 0)) reg.add({ ...p, id: p.id + ':park', kind: 'park', kinds: ['park'], radius: 6, building: null });
  return reg;
}

// Lightweight locomotion blend for crowds: idle/walk/run with shared, pre-baked clips.
export class CrowdAnimator {
  constructor(model, clips, { walk = 1.5, run = 4.2 } = {}) {
    this.mixer = new THREE.AnimationMixer(model); this.speeds = { walk, run }; this.acc = 0;
    this.actions = {}; for (const [n, c] of Object.entries(clips)) { const a = this.mixer.clipAction(c); a.play(); a.setEffectiveWeight(n === 'idle' ? 1 : 0); this.actions[n] = a; }
    this.mixer.update(Math.random() * 2); // de-synchronise
  }
  update(dt, speed, stride = 1) {
    this.acc += dt; this._n = (this._n || 0) + 1; if (this._n % stride) return; // animation LOD: tick every `stride` frames
    const step = this.acc; this.acc = 0;
    const { walk, run } = this.speeds, A = this.actions, w = { idle: 0, walk: 0, run: 0 };
    if (speed < 0.05) w.idle = 1; else if (speed < walk) { w.walk = speed / walk; w.idle = 1 - w.walk; } else { const t = clampv((speed - walk) / (run - walk), 0, 1); w.walk = 1 - t; w.run = t; }
    for (const n of Object.keys(A)) A[n].setEffectiveWeight(w[n] || 0);
    const rate = speed < walk ? Math.max(0.6, speed / walk) : speed < run ? 1 : speed / run;
    if (A.walk) A.walk.timeScale = rate; if (A.run) A.run.timeScale = rate;
    this.mixer.update(step);
  }
}

const UPPER = ['tshirt', 'longsleeve', 'shirt', 'hoodie', 'tanktop', 'bodysuit', 'robe', 'dress', 'jacket', 'coat'], LOWER = ['jeans', 'pants', 'shorts', 'skirt', 'dress', 'robe'];
const STYLIZED_HAIR = { short: 'short', crop: 'short', slick: 'short', buzz: 'buzz', long: 'long', medium: 'long', curly: 'long', bob: 'long', ponytail: 'ponytail', braid: 'ponytail', bun: 'bun', bald: 'bald', mohawk: 'mohawk' };
const TONES = { african: new THREE.Color(0x7a4b2e), asian: new THREE.Color(0xddb08c), caucasian: new THREE.Color(0xe9c3a6) };
// One civilian look shared by the realistic and the stylized representation (minimal pop on swaps).
export function pedestrianLook(seed, archetype = 'civilian') {
  const rng = new RNG(seed * 31 + 7);
  const spec = characterFromSpec(archetype, seed);
  const items = (Array.isArray(spec.outfit) ? spec.outfit : OUTFITS[spec.outfit] || OUTFITS.casual).map((x) => ({ ...x }));
  const palette = [0x2e4a72, 0x7a8a96, 0x8a3a3a, 0x3a6a4a, 0xd0c0a0, 0x2a2a2e, 0x6a4a8a, 0xb08a3a, 0x5a2a3a, 0xe0e0dc];
  for (const it of items) if (UPPER.includes(it.type) && !['jacket', 'coat'].includes(it.type)) it.color = rng.pick(palette);
  spec.outfit = items;
  const col = (types) => items.find((it) => types.includes(it.type))?.color;
  const skin = new THREE.Color(0, 0, 0); for (const [k, c] of Object.entries(TONES)) skin.add(c.clone().multiplyScalar(spec.ethnicity?.[k] ?? 1 / 3));
  const stylized = { seed, height: spec.heightCm / 100, build: clampv(spec.weight ?? 0.5, 0.3, 0.7), skin: skin.getHex(), hair: spec.hairColor, hairStyle: STYLIZED_HAIR[spec.hair] || 'short',
    outfit: 'casual', top: col(['jacket', 'coat']) ?? col(UPPER) ?? 0x556677, bottom: col(LOWER) ?? 0x2a2a2a, shoes: col(['sneakers', 'shoes', 'boots']) ?? 0x1a1a1a, beard: !!spec.beard, belt: false };
  return { spec, stylized };
}

/**
 * Crowd(app, city, opts)
 *   count, seed, templates { worker: weight, ... }, variants (realistic templates), maxNear,
 *   nearRange (realistic), midRange (mannequin; hidden beyond), hysteresis, shadows ('near' | 'all' | 'none'),
 *   humans (default app.humans), clock () => hour (default app.atmosphere.timeOfDay),
 *   navmesh (opt-in: route pedestrians over a NavMesh instead of the sidewalk graph)
 * await crowd.prepare() builds the realistic variant templates (skip if app.humans unset).
 * crowd.update(dt, viewPos) runs schedules + LOD; crowd.alarm(pos, opts) makes people flee.
 */
export class Crowd {
  constructor(app, city, { count = 40, seed = 11, templates = { worker: 4, shopper: 2.5, retiree: 1.5, student: 1, nightOwl: 1 }, variants = 3, maxNear = 6, nearRange = 14, midRange = 60,
    hysteresis = 0.12, shadows = 'near', humans, clock, animStride = 2, parent, navmesh = null } = {}) {
    this.app = app; this.city = city; this.seed = seed; this.rng = new RNG(seed);
    Object.assign(this, { count, maxNear, nearRange, midRange, hysteresis, shadows, animStride });
    this.humans = humans !== undefined ? humans : app.humans || null;
    this.clock = clock || (() => app.atmosphere?.timeOfDay ?? 12);
    this.network = sidewalkNetwork(city); this.places = placesFromCity(city, this.network);
    this.schedules = new ScheduleSystem({ clock: this.clock });
    this.group = new THREE.Group(); this.group.name = 'crowd'; (parent || app.scene).add(this.group);
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72 }); this.mat.name = 'gf:crowd-mannequin';
    this.clipCache = new Map(); this.templates = []; this.variantCount = variants; this.peds = [];
    const names = Object.keys(templates), weights = names.map((n) => templates[n]), total = weights.reduce((a, b) => a + b, 0);
    const sidewalkY = city.sidewalkY ?? 0.18;
    const groundY = (x, z) => (city.isRoad(x, z) ? 0.02 : sidewalkY);
    const navPlan = navmesh ? navMeshPlanner(navmesh) : null;
    const navWalk = navmesh ? (p) => navmesh.closestPoint({ x: p.x, z: p.z }) || p : null;
    const navY = navmesh ? (x, z) => navmesh.heightAt(x, z) ?? groundY(x, z) : null;
    for (let i = 0; i < count; i++) {
      let r = this.rng.next() * total, tpl = names[0]; for (let k = 0; k < names.length; k++) { r -= weights[k]; if (r <= 0) { tpl = names[k]; break; } }
      const lane = this.rng.range(-1.1, 1.1);
      const start = this.network.randomPoint(this.rng, lane);
      const agent = new ScheduleAgent({ id: 'ped' + i, schedule: tpl, registry: this.places, seed: seed * 1000 + i, position: new THREE.Vector3(start.x, sidewalkY, start.z),
        planner: navmesh ? navPlan : (a, b) => this.network.path(a, b, lane), walkable: navmesh ? navWalk : (p) => this.network.project(p, lane), groundY: navmesh ? navY : groundY });
      this.schedules.add(agent);
      const variant = i % Math.max(1, variants);
      this.peds.push({ i, agent, template: tpl, lane, variant, look: pedestrianLook(seed * 100 + (this.humans ? variant : i)).stylized, tier: -1, near: null, mid: null, anim: null, dist: Infinity, speed: 0 });
    }
    this.stats = { swaps: 0, nearBuilt: 0, midBuilt: 0 };
    this.ready = !this.humans;
  }
  /** Build realistic crowd templates (yields between builds so a loading screen can update). */
  async prepare({ onProgress } = {}) {
    if (!this.humans || this.templates.length) { this.ready = true; return this; }
    const { H, data } = this.humans;
    for (let v = 0; v < this.variantCount; v++) {
      await new Promise((r) => setTimeout(r, 0));
      const { spec } = pedestrianLook(this.rngSeed(v));
      const t = H.assembleHuman(data, { ...spec, lod: 'crowd' });
      const rt = t.userData.retargeter;
      t.userData.crowdClips = { idle: rt.clipFromPoseFn('idle', CLIP_LIBRARY.idle), walk: rt.clipFromPoseFn('walk', CLIP_LIBRARY.walk), run: rt.clipFromPoseFn('run', CLIP_LIBRARY.run) };
      this.templates.push(t); onProgress?.((v + 1) / this.variantCount);
    }
    // stylized looks follow the realistic variant (same clothes colours / skin / hair)
    for (const p of this.peds) p.look = pedestrianLook(this.rngSeed(p.variant)).stylized;
    this.ready = true; return this;
  }
  rngSeed(v) { return this.seed * 100 + v; }
  _mannequinClips(height) {
    const k = Math.round(height * 20) / 20;
    if (!this.clipCache.has(k)) this.clipCache.set(k, { idle: buildClip('idle', CLIP_LIBRARY.idle, { height: k }), walk: buildClip('walk', CLIP_LIBRARY.walk, { height: k }), run: buildClip('run', CLIP_LIBRARY.run, { height: k }) });
    return this.clipCache.get(k);
  }
  _makeMid(p) {
    const m = createHumanoid(p.look);
    const mesh = m.userData.mesh; mesh.geometry.clearGroups(); mesh.material = this.mat; // 1 draw call
    mesh.castShadow = this.shadows === 'all';
    m.userData.crowdAnim = new CrowdAnimator(m, this._mannequinClips(m.userData.height));
    this.stats.midBuilt++; return m;
  }
  _makeNear(p) {
    const t = this.templates[p.variant % this.templates.length]; if (!t) return null;
    const m = this.humans.H.cloneHuman(t);
    m.traverse((o) => { if (o.isMesh) o.castShadow = this.shadows !== 'none'; });
    m.userData.crowdAnim = new CrowdAnimator(m, t.userData.crowdClips);
    this.stats.nearBuilt++; return m;
  }
  _show(p, tier) {
    if (p.tier === tier) return;
    for (const [k, t] of [['near', 0], ['mid', 1]]) if (p[k] && t !== tier) p[k].visible = false;
    if (tier === 0 && !p.near) { p.near = this._makeNear(p); if (p.near) this.group.add(p.near); else tier = 1; }
    if (tier === 1 && !p.mid) { p.mid = this._makeMid(p); this.group.add(p.mid); }
    // release far-away realistic clones (they are cheap to re-clone)
    if (tier !== 0 && p.near) { this.group.remove(p.near); p.near = null; }
    const obj = tier === 0 ? p.near : tier === 1 ? p.mid : null; if (obj) obj.visible = true;
    if (p.tier >= 0 && tier >= 0) this.stats.swaps++;
    p.tier = tier;
  }
  update(dt, viewPos, hour = this.clock()) {
    this.schedules.update(dt, hour);
    // LOD: realistic for the maxNear closest within nearRange, mannequin within midRange, else hidden
    const near = this.humans && this.templates.length ? this.maxNear : 0;
    for (const p of this.peds) { const a = p.agent; p.dist = a.visible ? Math.hypot(a.position.x - viewPos.x, a.position.z - viewPos.z) : Infinity; }
    const order = this.peds.filter((p) => p.dist < Infinity).sort((a, b) => a.dist - b.dist);
    const nearSet = new Set();
    for (const p of order) { if (nearSet.size >= near) break; const lim = p.tier === 0 ? this.nearRange * (1 + this.hysteresis) : this.nearRange; if (p.dist < lim) nearSet.add(p); }
    for (const p of this.peds) {
      let tier;
      if (p.dist === Infinity) tier = -1;
      else if (nearSet.has(p)) tier = 0;
      else tier = p.dist < this.midRange * (p.tier >= 0 ? 1 + this.hysteresis : 1) ? 1 : -1; // hysteresis on the hide distance
      this._show(p, tier);
      const obj = tier === 0 ? p.near : tier === 1 ? p.mid : null;
      const a = p.agent; p.speed = a.velocity.length();
      if (!obj) continue;
      obj.position.copy(a.position); obj.rotation.y = a.heading;
      obj.userData.crowdAnim.update(dt, p.speed, tier === 0 || p.dist < 20 ? 1 : this.animStride);
    }
  }
  /** Danger at pos: people within radius flee, those a bit further watch. Returns count. */
  alarm(pos, { radius = 22, duration = 7, watchRadius = 40 } = {}) { return this.schedules.alarm(pos, { radius, duration, watchRadius }); }
  /** Visible pedestrians within radius (potential witnesses of a crime). */
  witnesses(pos, radius = 25) { return this.peds.filter((p) => p.agent.visible && Math.hypot(p.agent.position.x - pos.x, p.agent.position.z - pos.z) < radius).map((p) => p.agent); }
  info() {
    const s = this.schedules.stats(); let near = 0, mid = 0, hidden = 0;
    for (const p of this.peds) { if (p.tier === 0) near++; else if (p.tier === 1) mid++; else hidden++; }
    return { ...s, near, mid, hidden, templates: this.templates.length, swaps: this.stats.swaps, nearBuilt: this.stats.nearBuilt, midBuilt: this.stats.midBuilt };
  }
  dispose() { this.app.scene.remove(this.group); this.group.parent?.remove(this.group); }
}
