// Lightweight deterministic physics world tailored to action/driving/adventure games:
// static colliders (yaw-rotated boxes, vertical cylinders, spheres) in a spatial hash,
// optional heightfield ground, raycasts, overlap queries, trigger volumes, and simple
// dynamic rigid bodies (sphere proxies with tumbling rotation) for knock-able props.
import * as THREE from '../vendor/three/three.module.js';

let NEXT_ID = 1;
const _v = new THREE.Vector3();

export class PhysicsWorld {
  constructor({ heightfield = null, cellSize = 10, gravity = -24 } = {}) {
    this.hf = heightfield;
    this.cell = cellSize;
    this.gravity = gravity;
    this.grid = new Map();
    this.statics = new Map();
    this.bodies = [];
    this.triggers = [];
    this.waterLevel = heightfield ? heightfield.waterLevel : -Infinity;
    this.events = null; // optional EventBus
  }
  _key(i, j) { return i * 73856093 ^ j * 19349663; }
  _cells(minX, minZ, maxX, maxZ, fn) {
    const i0 = Math.floor(minX / this.cell), i1 = Math.floor(maxX / this.cell), j0 = Math.floor(minZ / this.cell), j1 = Math.floor(maxZ / this.cell);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) fn(this._key(i, j));
  }
  // shape: {type:'box', x,y,z (centre), hx,hy,hz, yaw} | {type:'cylinder', x,z, y (base), r, h} | {type:'sphere', x,y,z,r}
  addStatic(shape, userData = {}) {
    const s = { id: NEXT_ID++, ...shape, userData };
    if (s.type === 'box') { s.cos = Math.cos(s.yaw || 0); s.sin = Math.sin(s.yaw || 0); s.br = Math.hypot(s.hx, s.hz); s.minY = s.y - s.hy; s.maxY = s.y + s.hy; }
    if (s.type === 'cylinder') { s.br = s.r; s.minY = s.y; s.maxY = s.y + s.h; }
    if (s.type === 'sphere') { s.br = s.r; s.minY = s.y - s.r; s.maxY = s.y + s.r; }
    this.statics.set(s.id, s);
    this._cells(s.x - s.br, s.z - s.br, s.x + s.br, s.z + s.br, (k) => { if (!this.grid.has(k)) this.grid.set(k, []); this.grid.get(k).push(s); });
    return s;
  }
  removeStatic(s) {
    this.statics.delete(s.id);
    this._cells(s.x - s.br, s.z - s.br, s.x + s.br, s.z + s.br, (k) => { const a = this.grid.get(k); if (a) this.grid.set(k, a.filter((o) => o !== s)); });
  }
  // Add collider from an object's userData.collider at its transform.
  addFromObject(obj, extra = {}) {
    const c = obj.userData.collider; if (!c) return null;
    obj.updateMatrixWorld(true);
    const p = obj.getWorldPosition(new THREE.Vector3()), sc = obj.getWorldScale(new THREE.Vector3());
    const yaw = new THREE.Euler().setFromQuaternion(obj.getWorldQuaternion(new THREE.Quaternion()), 'YXZ').y;
    if (c.type === 'box') {
      const off = new THREE.Vector3(...(c.offset || [0, c.size[1] / 2, 0])).multiply(sc).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      return this.addStatic({ type: 'box', x: p.x + off.x, y: p.y + off.y, z: p.z + off.z, hx: c.size[0] / 2 * sc.x, hy: c.size[1] / 2 * sc.y, hz: c.size[2] / 2 * sc.z, yaw }, { object: obj, ...extra });
    }
    if (c.type === 'cylinder' || c.type === 'capsule') return this.addStatic({ type: 'cylinder', x: p.x, y: p.y, z: p.z, r: c.radius * sc.x, h: c.height * sc.y }, { object: obj, ...extra });
    if (c.type === 'sphere') return this.addStatic({ type: 'sphere', x: p.x, y: p.y + c.radius * 0.5 * sc.y, z: p.z, r: c.radius * sc.x }, { object: obj, ...extra });
    return null;
  }
  nearby(x, z, r) {
    const seen = new Set(), out = [];
    this._cells(x - r, z - r, x + r, z + r, (k) => { for (const s of this.grid.get(k) || []) if (!seen.has(s.id)) { seen.add(s.id); out.push(s); } });
    return out;
  }
  terrainHeight(x, z) { return this.hf ? this.hf.heightAt(x, z) : 0; }
  // Highest walkable surface under (x,z) at or below fromY + step.
  groundHeight(x, z, fromY = Infinity, step = 0.45, radius = 0) {
    let g = this.terrainHeight(x, z), surface = null;
    for (const s of this.nearby(x, z, radius + 0.1)) {
      if (s.userData.noGround) continue;
      if (s.maxY > fromY + step) continue;
      if (s.maxY <= g) continue;
      if (this._insideXZ(s, x, z, radius * 0.5)) { g = s.maxY; surface = s; }
    }
    return { y: g, surface };
  }
  _insideXZ(s, x, z, pad = 0) {
    if (s.type === 'box') { const dx = x - s.x, dz = z - s.z; const lx = dx * s.cos - dz * s.sin, lz = dx * s.sin + dz * s.cos; return Math.abs(lx) <= s.hx + pad && Math.abs(lz) <= s.hz + pad; }
    const d = Math.hypot(x - s.x, z - s.z); return d <= s.r + pad;
  }
  // Push a vertical cylinder (x,z,radius, yMin..yMax) out of static colliders. Returns {x, z, hits[]}.
  resolveCylinder(x, z, radius, yMin, yMax, ignore = null) {
    const hits = [];
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const s of this.nearby(x, z, radius + 0.5)) {
        if (s === ignore || s.userData.trigger || s.userData.noCollide) continue;
        if (s.maxY <= yMin + 0.01 || s.minY >= yMax) continue;
        if (s.type === 'box') {
          const dx = x - s.x, dz = z - s.z;
          const lx = dx * s.cos - dz * s.sin, lz = dx * s.sin + dz * s.cos;
          const cx = Math.max(-s.hx, Math.min(s.hx, lx)), cz = Math.max(-s.hz, Math.min(s.hz, lz));
          let ox = lx - cx, oz = lz - cz; let d = Math.hypot(ox, oz);
          if (d >= radius) continue;
          let nx, nz, pen;
          if (d < 1e-6) { // centre inside box: push along least-penetration axis
            const px = s.hx - Math.abs(lx), pz = s.hz - Math.abs(lz);
            if (px < pz) { nx = Math.sign(lx) || 1; nz = 0; pen = px + radius; } else { nx = 0; nz = Math.sign(lz) || 1; pen = pz + radius; }
          } else { nx = ox / d; nz = oz / d; pen = radius - d; }
          // back to world
          const wx = nx * s.cos + nz * s.sin, wz = -nx * s.sin + nz * s.cos;
          x += wx * pen; z += wz * pen; moved = true; hits.push({ shape: s, nx: wx, nz: wz, pen });
        } else {
          const dx = x - s.x, dz = z - s.z, d = Math.hypot(dx, dz), min = radius + s.r;
          if (d >= min) continue;
          const nx = d > 1e-6 ? dx / d : 1, nz = d > 1e-6 ? dz / d : 0;
          x += nx * (min - d); z += nz * (min - d); moved = true; hits.push({ shape: s, nx, nz, pen: min - d });
        }
      }
      if (!moved) break;
    }
    return { x, z, hits };
  }
  // Raycast against terrain, statics and bodies. dir must be normalized.
  raycast(origin, dir, maxDist = 100, { ignore = null, terrain = true, bodies = true, filter = null } = {}) {
    let best = null;
    const consider = (dist, normal, shape) => { if (dist >= 0 && dist <= maxDist && (!best || dist < best.distance)) best = { distance: dist, normal, shape, point: origin.clone().addScaledVector(dir, dist) }; };
    if (terrain && this.hf) { const h = this.hf.raycast(origin, dir, maxDist, 0.5); if (h) consider(h.distance, this.hf.normalAt(h.point.x, h.point.z), null); }
    else if (terrain && dir.y < 0 && !this.hf) consider((0 - origin.y) / dir.y, new THREE.Vector3(0, 1, 0), null);
    // statics along the ray (sample cells along the ray footprint)
    const end = origin.clone().addScaledVector(dir, maxDist);
    const seen = new Set();
    const steps = Math.ceil(maxDist / this.cell) + 1;
    for (let k = 0; k <= steps; k++) {
      const p = origin.clone().lerp(end, k / steps);
      for (const s of this.nearby(p.x, p.z, this.cell)) {
        if (seen.has(s.id) || s === ignore || s.userData.trigger) continue; seen.add(s.id);
        if (filter && !filter(s)) continue;
        const hit = rayShape(origin, dir, s);
        if (hit) consider(hit.t, hit.n, s);
      }
    }
    if (bodies) for (const b of this.bodies) {
      if (b === ignore || b.userData.noRaycast) continue;
      const t = raySphere(origin, dir, b.position, b.radius);
      if (t !== null) consider(t, _v.copy(origin).addScaledVector(dir, t).sub(b.position).normalize().clone(), b);
    }
    return best;
  }
  overlapSphere(center, r, { statics = true, bodies = true } = {}) {
    const out = [];
    if (statics) for (const s of this.nearby(center.x, center.z, r)) {
      if (s.type === 'box') { const cy = Math.max(s.minY, Math.min(s.maxY, center.y)); if (Math.abs(cy - center.y) < r && this._insideXZ(s, center.x, center.z, r)) out.push(s); }
      else { const cy = Math.max(s.minY, Math.min(s.maxY, center.y)); if (Math.hypot(center.x - s.x, center.z - s.z, center.y - cy) < r + s.r) out.push(s); }
    }
    if (bodies) for (const b of this.bodies) if (b.position.distanceTo(center) < r + b.radius) out.push(b);
    return out;
  }
  // ---- dynamic bodies ----
  addBody({ object = null, position, radius = 0.5, mass = 1, restitution = 0.3, friction = 0.6, sleep = true, userData = {} }) {
    const b = { id: NEXT_ID++, object, position: position.clone(), velocity: new THREE.Vector3(), angular: new THREE.Vector3(), quaternion: object ? object.quaternion.clone() : new THREE.Quaternion(), radius, mass, invMass: mass > 0 ? 1 / mass : 0, restitution, friction, sleeping: sleep, userData, grounded: false };
    this.bodies.push(b); return b;
  }
  removeBody(b) { this.bodies = this.bodies.filter((x) => x !== b); }
  applyImpulse(b, impulse, point = null) {
    b.velocity.addScaledVector(impulse, b.invMass); b.sleeping = false;
    if (point) { const r = point.clone().sub(b.position); b.angular.add(r.cross(impulse).multiplyScalar(b.invMass / (0.4 * b.radius * b.radius))); }
  }
  addTrigger({ x, y = 0, z, r = 2, h = 4, box = null, once = false, onEnter, onExit, userData = {} }) {
    const t = { id: NEXT_ID++, x, y, z, r, h, box, once, onEnter, onExit, inside: new Set(), userData, enabled: true };
    this.triggers.push(t); return t;
  }
  removeTrigger(t) { this.triggers = this.triggers.filter((x) => x !== t); }
  // actors: [{ id, position }]
  updateTriggers(actors) {
    for (const t of this.triggers) {
      if (!t.enabled) continue;
      for (const a of actors) {
        const p = a.position;
        const inside = t.box ? Math.abs(p.x - t.x) < t.box[0] / 2 && Math.abs(p.z - t.z) < t.box[1] / 2 && p.y > t.y - 1 && p.y < t.y + t.h
          : Math.hypot(p.x - t.x, p.z - t.z) < t.r && p.y > t.y - 2 && p.y < t.y + t.h;
        const was = t.inside.has(a.id);
        if (inside && !was) { t.inside.add(a.id); t.onEnter?.(a, t); if (t.once) t.enabled = false; }
        else if (!inside && was) { t.inside.delete(a.id); t.onExit?.(a, t); }
      }
    }
  }
  step(dt) {
    const g = this.gravity;
    for (const b of this.bodies) {
      if (b.sleeping || b.invMass === 0) continue;
      b.velocity.y += g * dt;
      b.position.addScaledVector(b.velocity, dt);
      // ground
      const gh = this.groundHeight(b.position.x, b.position.z, b.position.y, 0.3).y;
      b.grounded = false;
      if (b.position.y - b.radius < gh) {
        b.position.y = gh + b.radius;
        if (b.velocity.y < 0) b.velocity.y = -b.velocity.y * b.restitution;
        if (Math.abs(b.velocity.y) < 0.6) b.velocity.y = 0;
        const fr = Math.max(0, 1 - b.friction * 4 * dt);
        b.velocity.x *= fr; b.velocity.z *= fr;
        // rolling: angular from linear velocity
        b.angular.set(b.velocity.z / b.radius, 0, -b.velocity.x / b.radius).multiplyScalar(0.8).add(b.angular.multiplyScalar(0.2));
        b.grounded = true;
      }
      // statics
      const r = this.resolveCylinder(b.position.x, b.position.z, b.radius, b.position.y - b.radius, b.position.y + b.radius);
      if (r.hits.length) {
        for (const h of r.hits) { const vn = b.velocity.x * h.nx + b.velocity.z * h.nz; if (vn < 0) { b.velocity.x -= (1 + b.restitution) * vn * h.nx; b.velocity.z -= (1 + b.restitution) * vn * h.nz; } }
        b.position.x = r.x; b.position.z = r.z;
      }
      // integrate rotation
      const w = b.angular.length();
      if (w > 1e-4) { const q = new THREE.Quaternion().setFromAxisAngle(_v.copy(b.angular).divideScalar(w), w * dt); b.quaternion.premultiply(q); }
      if (b.grounded && b.velocity.lengthSq() < 0.02 && w < 0.2) { b.sleeping = true; b.velocity.set(0, 0, 0); b.angular.set(0, 0, 0); }
      if (b.position.y < this.waterLevel - 2 && b.userData.sinks !== false) b.velocity.multiplyScalar(0.9);
      if (b.object) { b.object.position.copy(b.position).y -= b.userData.centerOffset ?? b.radius; b.object.quaternion.copy(b.quaternion); }
    }
    // body-body (sphere) collisions
    for (let i = 0; i < this.bodies.length; i++) for (let j = i + 1; j < this.bodies.length; j++) {
      const a = this.bodies[i], c = this.bodies[j];
      if (a.sleeping && c.sleeping) continue;
      const d = _v.copy(c.position).sub(a.position), dist = d.length(), min = a.radius + c.radius;
      if (dist >= min || dist < 1e-6) continue;
      d.divideScalar(dist);
      const tot = a.invMass + c.invMass; if (tot === 0) continue;
      const pen = min - dist;
      a.position.addScaledVector(d, -pen * a.invMass / tot); c.position.addScaledVector(d, pen * c.invMass / tot);
      const rv = c.velocity.clone().sub(a.velocity).dot(d);
      if (rv < 0) { const jimp = -(1 + Math.min(a.restitution, c.restitution)) * rv / tot; a.velocity.addScaledVector(d, -jimp * a.invMass); c.velocity.addScaledVector(d, jimp * c.invMass); a.sleeping = c.sleeping = false; }
    }
  }
}

export function raySphere(o, d, c, r) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z, cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc; if (disc < 0) return null;
  const t = -b - Math.sqrt(disc); if (t >= 0) return t;
  const t2 = -b + Math.sqrt(disc); return t2 >= 0 ? 0 : null;
}

function rayShape(o, d, s) {
  if (s.type === 'sphere') { const t = raySphere(o, d, s, s.r); return t === null ? null : { t, n: o.clone().addScaledVector(d, t).sub(new THREE.Vector3(s.x, s.y, s.z)).normalize() }; }
  if (s.type === 'box') {
    // transform ray into box local space (yaw)
    const dx = o.x - s.x, dz = o.z - s.z;
    const lo = [dx * s.cos - dz * s.sin, o.y - s.y, dx * s.sin + dz * s.cos];
    const ld = [d.x * s.cos - d.z * s.sin, d.y, d.x * s.sin + d.z * s.cos];
    const h = [s.hx, s.hy, s.hz];
    let tmin = -Infinity, tmax = Infinity, axis = 0, sign = 1;
    for (let k = 0; k < 3; k++) {
      if (Math.abs(ld[k]) < 1e-9) { if (Math.abs(lo[k]) > h[k]) return null; continue; }
      let t1 = (-h[k] - lo[k]) / ld[k], t2 = (h[k] - lo[k]) / ld[k], sg = -1;
      if (t1 > t2) { [t1, t2] = [t2, t1]; sg = 1; }
      if (t1 > tmin) { tmin = t1; axis = k; sign = sg; }
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
    if (tmax < 0) return null;
    const t = Math.max(0, tmin);
    const ln = [0, 0, 0]; ln[axis] = sign;
    return { t, n: new THREE.Vector3(ln[0] * s.cos + ln[2] * s.sin, ln[1], -ln[0] * s.sin + ln[2] * s.cos) };
  }
  if (s.type === 'cylinder') {
    const ox = o.x - s.x, oz = o.z - s.z;
    const a = d.x * d.x + d.z * d.z, b = ox * d.x + oz * d.z, c = ox * ox + oz * oz - s.r * s.r;
    if (a < 1e-9) { if (c > 0) return null; const t = d.y < 0 ? (o.y - s.maxY) / -d.y : (s.minY - o.y) / d.y; return t >= 0 ? { t, n: new THREE.Vector3(0, -Math.sign(d.y), 0) } : null; }
    const disc = b * b - a * c; if (disc < 0) return null;
    let t = (-b - Math.sqrt(disc)) / a;
    if (t < 0) t = 0;
    const y = o.y + d.y * t;
    if (y >= s.minY && y <= s.maxY) return { t, n: new THREE.Vector3(ox + d.x * t, 0, oz + d.z * t).normalize() };
    // top cap
    if (d.y < 0 && o.y > s.maxY) { const tc = (s.maxY - o.y) / d.y; const px = ox + d.x * tc, pz = oz + d.z * tc; if (px * px + pz * pz <= s.r * s.r) return { t: tc, n: new THREE.Vector3(0, 1, 0) }; }
    return null;
  }
  return null;
}
