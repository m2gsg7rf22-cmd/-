// Game AI building blocks: behavior trees (with blackboard and decorators), a finite
// state machine, steering behaviors, grid navigation with A* + path smoothing, and
// perception (vision cone + line of sight, hearing).
import * as THREE from '../vendor/three/three.module.js';

export const SUCCESS = 'success', FAILURE = 'failure', RUNNING = 'running';

// ---------- Behavior tree ----------
class Node { constructor(name) { this.name = name; } reset() {} }
export class Sequence extends Node {
  constructor(children, name = 'Sequence') { super(name); this.children = children; this.i = 0; }
  tick(ctx, dt) {
    while (this.i < this.children.length) {
      const r = this.children[this.i].tick(ctx, dt);
      if (r === RUNNING) return RUNNING;
      if (r === FAILURE) { this.reset(); return FAILURE; }
      this.i++;
    }
    this.reset(); return SUCCESS;
  }
  reset() { this.i = 0; for (const c of this.children) c.reset(); }
}
// Selector re-evaluates from the first child every tick (reactive priorities).
export class Selector extends Node {
  constructor(children, name = 'Selector') { super(name); this.children = children; this.running = -1; }
  tick(ctx, dt) {
    for (let i = 0; i < this.children.length; i++) {
      const r = this.children[i].tick(ctx, dt);
      if (r !== FAILURE) { if (this.running !== -1 && this.running !== i) this.children[this.running].reset(); this.running = r === RUNNING ? i : -1; return r; }
    }
    this.running = -1; return FAILURE;
  }
  reset() { this.running = -1; for (const c of this.children) c.reset(); }
}
export class Parallel extends Node {
  constructor(children, { succeedOn = 'all' } = {}, name = 'Parallel') { super(name); this.children = children; this.succeedOn = succeedOn; }
  tick(ctx, dt) {
    const rs = this.children.map((c) => c.tick(ctx, dt));
    if (rs.includes(FAILURE)) return FAILURE;
    if (this.succeedOn === 'any' ? rs.includes(SUCCESS) : rs.every((r) => r === SUCCESS)) return SUCCESS;
    return RUNNING;
  }
  reset() { for (const c of this.children) c.reset(); }
}
export class Condition extends Node { constructor(fn, name = 'Condition') { super(name); this.fn = fn; } tick(ctx) { return this.fn(ctx) ? SUCCESS : FAILURE; } }
export class Action extends Node {
  constructor(fn, name = 'Action', { onReset } = {}) { super(name); this.fn = fn; this.state = {}; this.onReset = onReset; }
  tick(ctx, dt) { let r = this.fn(ctx, dt, this.state); r = r === undefined || r === true ? SUCCESS : r === false ? FAILURE : r; if (r !== RUNNING) this.reset(); return r; }
  reset() { this.onReset?.(this.state); this.state = {}; }
}
export class Inverter extends Node { constructor(child) { super('Inverter'); this.child = child; } tick(c, dt) { const r = this.child.tick(c, dt); return r === SUCCESS ? FAILURE : r === FAILURE ? SUCCESS : r; } reset() { this.child.reset(); } }
export class Wait extends Node { constructor(seconds) { super('Wait'); this.seconds = seconds; this.t = 0; } tick(c, dt) { this.t += dt; if (this.t >= (typeof this.seconds === 'function' ? this.seconds(c) : this.seconds)) { this.t = 0; return SUCCESS; } return RUNNING; } reset() { this.t = 0; } }
export class Cooldown extends Node {
  constructor(seconds, child) { super('Cooldown'); this.seconds = seconds; this.child = child; this.ready = 0; }
  tick(c, dt) { if (c.time < this.ready) return FAILURE; const r = this.child.tick(c, dt); if (r === SUCCESS) this.ready = c.time + this.seconds; return r; }
  reset() { this.child.reset(); }
}
export class Repeat extends Node { constructor(child, times = Infinity) { super('Repeat'); this.child = child; this.times = times; this.n = 0; } tick(c, dt) { const r = this.child.tick(c, dt); if (r === SUCCESS) { this.n++; if (this.n >= this.times) { this.n = 0; return SUCCESS; } } return r === FAILURE ? FAILURE : RUNNING; } reset() { this.n = 0; this.child.reset(); } }
export class Timeout extends Node { constructor(seconds, child) { super('Timeout'); this.seconds = seconds; this.child = child; this.t = 0; } tick(c, dt) { this.t += dt; if (this.t > this.seconds) { this.reset(); return FAILURE; } const r = this.child.tick(c, dt); if (r !== RUNNING) this.t = 0; return r; } reset() { this.t = 0; this.child.reset(); } }

export class BehaviorTree {
  constructor(root, blackboard = {}) { this.root = root; this.bb = blackboard; this.time = 0; this.lastStatus = null; }
  tick(dt, extra = {}) { this.time += dt; const ctx = Object.assign(this.bb, extra, { time: this.time }); this.lastStatus = this.root.tick(ctx, dt); return this.lastStatus; }
}
// Compact builder: bt.sel(...), bt.seq(...), bt.cond(fn), bt.act(fn)
export const bt = {
  sel: (...c) => new Selector(c), seq: (...c) => new Sequence(c), par: (...c) => new Parallel(c), cond: (fn, n) => new Condition(fn, n),
  act: (fn, n) => new Action(fn, n), wait: (s) => new Wait(s), not: (c) => new Inverter(c), cooldown: (s, c) => new Cooldown(s, c), repeat: (c, n) => new Repeat(c, n), timeout: (s, c) => new Timeout(s, c),
};

// ---------- FSM ----------
export class StateMachine {
  constructor(owner, states, initial) { this.owner = owner; this.states = states; this.state = null; this.time = 0; this.history = []; if (initial) this.go(initial); }
  go(name, data) {
    if (!this.states[name]) throw new Error('unknown state ' + name);
    if (this.state) this.states[this.state].exit?.(this.owner, name);
    this.history.push(name); if (this.history.length > 20) this.history.shift();
    const prev = this.state; this.state = name; this.time = 0;
    this.states[name].enter?.(this.owner, prev, data);
  }
  update(dt) { this.time += dt; const s = this.states[this.state]; const next = s?.update?.(this.owner, dt, this.time); if (next && next !== this.state) this.go(next); }
  is(name) { return this.state === name; }
}

// ---------- Steering ----------
export const Steering = {
  seek(pos, target, maxSpeed) { return new THREE.Vector3().subVectors(target, pos).setY(0).normalize().multiplyScalar(maxSpeed); },
  flee(pos, threat, maxSpeed) { return new THREE.Vector3().subVectors(pos, threat).setY(0).normalize().multiplyScalar(maxSpeed); },
  arrive(pos, target, maxSpeed, slowRadius = 3) {
    const d = new THREE.Vector3().subVectors(target, pos).setY(0); const dist = d.length();
    if (dist < 0.05) return new THREE.Vector3();
    return d.multiplyScalar((maxSpeed * Math.min(1, dist / slowRadius)) / dist);
  },
  wander(state, maxSpeed, rng = Math.random) {
    state.angle = (state.angle ?? rng() * Math.PI * 2) + (rng() - 0.5) * 0.6;
    return new THREE.Vector3(Math.sin(state.angle), 0, Math.cos(state.angle)).multiplyScalar(maxSpeed * 0.5);
  },
  separation(pos, neighbors, radius = 1.5) {
    const f = new THREE.Vector3();
    for (const n of neighbors) { const d = new THREE.Vector3().subVectors(pos, n).setY(0); const l = d.length(); if (l > 1e-4 && l < radius) f.addScaledVector(d.normalize(), (radius - l) / radius); }
    return f;
  },
  // Circle a target at a given radius (enemies surrounding the player).
  orbit(pos, target, radius, maxSpeed, dir = 1) {
    const to = new THREE.Vector3().subVectors(pos, target).setY(0); const l = to.length() || 1;
    const tangent = new THREE.Vector3(-to.z, 0, to.x).multiplyScalar(dir / l);
    const radial = to.multiplyScalar((radius - l) / l);
    return tangent.multiplyScalar(maxSpeed * 0.6).add(radial.multiplyScalar(2)).clampLength(0, maxSpeed);
  },
  followPath(pos, path, state, maxSpeed, reach = 1.2) {
    if (!path || !path.length) return null;
    state.i = state.i ?? 0;
    while (state.i < path.length && Math.hypot(path[state.i].x - pos.x, path[state.i].z - pos.z) < reach) state.i++;
    if (state.i >= path.length) return null;
    return Steering.arrive(pos, path[state.i], maxSpeed, state.i === path.length - 1 ? 2 : 0.1);
  },
};

// ---------- Grid navigation ----------
export class NavGrid {
  constructor({ minX = -100, minZ = -100, size = 200, cell = 1, blocked = null } = {}) {
    this.minX = minX; this.minZ = minZ; this.cell = cell; this.n = Math.ceil(size / cell);
    this.cost = new Float32Array(this.n * this.n).fill(1);
    if (blocked) this.bake(blocked);
  }
  // blocked(x, z) -> true | false | cost multiplier (number > 1)
  bake(blocked) {
    for (let j = 0; j < this.n; j++) for (let i = 0; i < this.n; i++) {
      const r = blocked(this.minX + (i + 0.5) * this.cell, this.minZ + (j + 0.5) * this.cell);
      this.cost[j * this.n + i] = r === true ? Infinity : typeof r === 'number' ? r : 1;
    }
  }
  static fromWorld(world, opts = {}) {
    const { agentRadius = 0.4, maxSlope = 0.45, avoidWater = true } = opts;
    const g = new NavGrid(opts);
    g.bake((x, z) => {
      if (world.hf) { if (avoidWater && world.terrainHeight(x, z) < world.waterLevel + 0.2) return true; if (world.hf.slopeAt(x, z) > maxSlope) return true; }
      const y = world.terrainHeight(x, z);
      for (const s of world.nearby(x, z, agentRadius + g.cell)) {
        if (s.userData.trigger || s.userData.noNav) continue;
        if (s.maxY < y + 0.5 || s.minY > y + 1.8) continue;
        if (world._insideXZ(s, x, z, agentRadius)) return true;
      }
      return false;
    });
    return g;
  }
  toCell(x, z) { return [Math.floor((x - this.minX) / this.cell), Math.floor((z - this.minZ) / this.cell)]; }
  toWorld(i, j) { return new THREE.Vector3(this.minX + (i + 0.5) * this.cell, 0, this.minZ + (j + 0.5) * this.cell); }
  walkable(i, j) { return i >= 0 && j >= 0 && i < this.n && j < this.n && this.cost[j * this.n + i] !== Infinity; }
  nearestWalkable(i, j, maxR = 6) {
    if (this.walkable(i, j)) return [i, j];
    for (let r = 1; r <= maxR; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) if (Math.max(Math.abs(di), Math.abs(dj)) === r && this.walkable(i + di, j + dj)) return [i + di, j + dj];
    return null;
  }
  // A* with octile heuristic and corner-cutting prevention. Returns world points or null.
  findPath(from, to, { maxNodes = 20000 } = {}) {
    const s = this.nearestWalkable(...this.toCell(from.x, from.z)), t = this.nearestWalkable(...this.toCell(to.x, to.z));
    if (!s || !t) return null;
    const n = this.n, start = s[1] * n + s[0], goal = t[1] * n + t[0];
    const g = new Map([[start, 0]]), came = new Map();
    const h = (k) => { const dx = Math.abs((k % n) - t[0]), dz = Math.abs(Math.floor(k / n) - t[1]); return (dx + dz) + (Math.SQRT2 - 2) * Math.min(dx, dz); };
    const open = new MinHeap(); open.push(start, h(start));
    const closed = new Set(); let expanded = 0;
    while (open.size) {
      const cur = open.pop();
      if (cur === goal) break;
      if (closed.has(cur)) continue; closed.add(cur);
      if (++expanded > maxNodes) return null;
      const ci = cur % n, cj = Math.floor(cur / n);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = ci + di, nj = cj + dj; if (!this.walkable(ni, nj)) continue;
        if (di && dj && (!this.walkable(ci + di, cj) || !this.walkable(ci, cj + dj))) continue;
        const k = nj * n + ni, step = (di && dj ? Math.SQRT2 : 1) * this.cost[k];
        const ng = g.get(cur) + step;
        if (ng < (g.get(k) ?? Infinity)) { g.set(k, ng); came.set(k, cur); open.push(k, ng + h(k)); }
      }
    }
    if (!came.has(goal) && goal !== start) return null;
    const cells = [goal]; let c = goal; while (c !== start) { c = came.get(c); cells.push(c); }
    cells.reverse();
    return this.smooth(cells.map((k) => this.toWorld(k % n, Math.floor(k / n))));
  }
  lineWalkable(a, b) {
    const d = a.distanceTo(b), steps = Math.ceil(d / (this.cell * 0.5));
    for (let i = 0; i <= steps; i++) { const p = a.clone().lerp(b, i / steps); const [ci, cj] = this.toCell(p.x, p.z); if (!this.walkable(ci, cj)) return false; }
    return true;
  }
  smooth(path) {
    if (path.length < 3) return path;
    const out = [path[0]]; let anchor = 0;
    for (let i = 2; i < path.length; i++) if (!this.lineWalkable(path[anchor], path[i])) { out.push(path[i - 1]); anchor = i - 1; }
    out.push(path[path.length - 1]);
    return out;
  }
}

class MinHeap {
  constructor() { this.k = []; this.p = []; }
  get size() { return this.k.length; }
  push(key, pri) { const k = this.k, p = this.p; k.push(key); p.push(pri); let i = k.length - 1; while (i > 0) { const pa = (i - 1) >> 1; if (p[pa] <= p[i]) break; [k[pa], k[i]] = [k[i], k[pa]]; [p[pa], p[i]] = [p[i], p[pa]]; i = pa; } }
  pop() {
    const k = this.k, p = this.p, top = k[0], lk = k.pop(), lp = p.pop();
    if (k.length) { k[0] = lk; p[0] = lp; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < k.length && p[l] < p[m]) m = l; if (r < k.length && p[r] < p[m]) m = r; if (m === i) break; [k[m], k[i]] = [k[i], k[m]]; [p[m], p[i]] = [p[i], p[m]]; i = m; } }
    return top;
  }
}

// ---------- Perception ----------
export class Perception {
  constructor({ sightRange = 18, fov = Math.PI * 0.65, hearingRange = 8, memory = 4 } = {}) { Object.assign(this, { sightRange, fov, hearingRange, memory }); this.lastSeen = null; this.lastSeenTime = -Infinity; this.aware = 0; }
  // Returns { visible, heard, distance } and updates awareness.
  sense(time, selfPos, facing, targetPos, world = null, { noise = 0, dt = 0.016 } = {}) {
    const to = new THREE.Vector3().subVectors(targetPos, selfPos); const dist = to.length();
    let visible = false;
    if (dist < this.sightRange) {
      const ang = Math.abs(Math.atan2(Math.sin(Math.atan2(to.x, to.z) - facing), Math.cos(Math.atan2(to.x, to.z) - facing)));
      if (ang < this.fov / 2 || dist < 2.5) {
        visible = true;
        if (world) {
          const eye = selfPos.clone().setY(selfPos.y + 1.6), tgt = targetPos.clone().setY(targetPos.y + 1.2), dir = tgt.clone().sub(eye); const len = dir.length(); dir.normalize();
          const hit = world.raycast(eye, dir, len, { bodies: false });
          if (hit && hit.distance < len - 0.5) visible = false;
        }
      }
    }
    const heard = dist < this.hearingRange * (0.5 + noise);
    if (visible || heard) { this.lastSeen = targetPos.clone(); this.lastSeenTime = time; }
    this.aware = Math.max(0, Math.min(1, this.aware + (visible ? dt * (2.5 - dist / this.sightRange * 2) : heard ? dt * 0.8 : -dt * 0.25)));
    return { visible, heard, distance: dist, remembered: time - this.lastSeenTime < this.memory };
  }
}
