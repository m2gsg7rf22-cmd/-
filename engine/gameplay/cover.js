// Cover system for shooters: finds cover faces and edges on static colliders (yaw-rotated
// boxes and vertical cylinders in PhysicsWorld), classifies low (shoot over) vs high (peek
// around an edge) cover, generates protected cover points against a threat for AI, and
// keeps a claim registry so squads do not stack on the same spot. Pure physics queries:
// no rendering, usable by the player controller and by AI alike.
import * as THREE from '../vendor/three/three.module.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

export class CoverSystem {
  constructor(world, { minHeight = 0.85, highHeight = 1.5, agentRadius = 0.36, peekOut = 0.5 } = {}) {
    this.world = world;
    Object.assign(this, { minHeight, highHeight, agentRadius, peekOut });
    this.claims = new Map(); // key -> owner
  }
  _ground(x, z) { return this.world.groundHeight(x, z, Infinity, 0.45).y; }
  _usable(s, groundY) {
    if (s.userData?.trigger || s.userData?.noCover || s.userData?.noCollide) return false;
    if (s.type === 'sphere') return false;
    if (s.minY > groundY + 0.5) return false; // overhead geometry
    return s.maxY - groundY >= this.minHeight;
  }
  // Describe the face of shape `s` nearest to (x, z). Returns null if the point is inside it.
  face(s, x, z, groundY = this._ground(x, z)) {
    const height = s.maxY - groundY;
    if (s.type === 'box') {
      const dx = x - s.x, dz = z - s.z;
      const lx = dx * s.cos - dz * s.sin, lz = dx * s.sin + dz * s.cos;
      const cx = Math.max(-s.hx, Math.min(s.hx, lx)), cz = Math.max(-s.hz, Math.min(s.hz, lz));
      const ox = lx - cx, oz = lz - cz;
      let nl, tl, fc, half, along;
      if (Math.abs(ox) >= Math.abs(oz) && Math.abs(ox) > 1e-6) { const sg = Math.sign(ox); nl = [sg, 0]; tl = [0, sg]; fc = [sg * s.hx, 0]; half = s.hz; along = lz * sg; }
      else if (Math.abs(oz) > 1e-6) { const sg = Math.sign(oz); nl = [0, sg]; tl = [-sg, 0]; fc = [0, sg * s.hz]; half = s.hx; along = -lx * sg; }
      else return null;
      const toW = (a, b) => [a * s.cos + b * s.sin, -a * s.sin + b * s.cos];
      const n = toW(...nl), t = toW(...tl), c = toW(...fc), p = toW(cx, cz);
      return {
        shape: s, height, low: height < this.highHeight, top: s.maxY,
        normal: V(n[0], 0, n[1]), tangent: V(t[0], 0, t[1]),
        point: V(s.x + p[0], groundY, s.z + p[1]), center: V(s.x + c[0], groundY, s.z + c[1]),
        halfLength: half, along, distance: Math.hypot(ox, oz),
      };
    }
    if (s.type === 'cylinder') {
      const dx = x - s.x, dz = z - s.z, d = Math.hypot(dx, dz);
      if (d <= s.r) return null;
      const n = V(dx / d, 0, dz / d), t = V(-n.z, 0, n.x);
      const pt = V(s.x + n.x * s.r, groundY, s.z + n.z * s.r);
      return { shape: s, height, low: height < this.highHeight, top: s.maxY, normal: n, tangent: t, point: pt, center: pt.clone(), halfLength: s.r * 0.7, along: 0, distance: d - s.r };
    }
    return null;
  }
  // Best cover face near `position` (player snap-to-cover). preferDir (ground vector) biases
  // towards cover in front of the camera/stick. Returns a cover descriptor or null.
  find(position, { radius = 2, preferDir = null } = {}) {
    let best = null, bestScore = Infinity;
    const gy = this._ground(position.x, position.z);
    for (const s of this.world.nearby(position.x, position.z, radius + 4)) {
      if (!this._usable(s, gy)) continue;
      const f = this.face(s, position.x, position.z, gy);
      if (!f || f.distance > radius) continue;
      let score = f.distance;
      if (preferDir) score -= -f.normal.dot(preferDir) * 0.6; // walls we move/look towards win
      if (score < bestScore) { bestScore = score; best = f; }
    }
    if (best) this.decorate(best);
    return best;
  }
  // Adds snap point (where the agent stands) and edge information.
  decorate(f, along = f.along) {
    const r = this.agentRadius + 0.06;
    const a = Math.max(-f.halfLength, Math.min(f.halfLength, along));
    f.along = a;
    f.snap = f.center.clone().addScaledVector(f.tangent, f.shape.type === 'cylinder' ? 0 : a).addScaledVector(f.normal, r);
    if (f.shape.type === 'cylinder') f.snap = f.point.clone().addScaledVector(f.normal, r);
    f.edgeRight = f.center.clone().addScaledVector(f.tangent, f.halfLength);
    f.edgeLeft = f.center.clone().addScaledVector(f.tangent, -f.halfLength);
    f.distRight = f.halfLength - a; f.distLeft = f.halfLength + a;
    return f;
  }
  // Nearest edge within `range` of the agent's coordinate along the face: { side: ±1, point, distance }.
  nearEdge(f, range = 0.9) {
    const side = f.distRight <= f.distLeft ? 1 : -1, d = side > 0 ? f.distRight : f.distLeft;
    return d <= range ? { side, distance: d, point: side > 0 ? f.edgeRight : f.edgeLeft } : null;
  }
  // Where to stand to shoot from this cover: low cover -> same spot (stand up); high cover ->
  // step around the nearest edge. Returns null when high cover has no usable edge nearby.
  peekPosition(f, range = 0.9) {
    if (f.low) return f.snap.clone();
    const e = this.nearEdge(f, range); if (!e) return null;
    return e.point.clone().addScaledVector(f.tangent, e.side * (this.agentRadius + this.peekOut)).addScaledVector(f.normal, this.agentRadius * 0.6);
  }
  // Is `pos` (feet) protected from a shooter at `threat` (feet)? Tests a chest-height ray.
  isProtected(pos, threat, { height = 1.0, threatHeight = 1.5 } = {}) {
    const from = V(threat.x, threat.y + threatHeight, threat.z), to = V(pos.x, pos.y + height, pos.z);
    const dir = to.clone().sub(from), len = dir.length(); if (len < 1e-3) return false; dir.divideScalar(len);
    const hit = this.world.raycast(from, dir, len, { bodies: false, terrain: true });
    return !!hit && hit.distance < len - 0.15;
  }
  // Candidate cover points around `center` that protect against `threat` (AI). Each point:
  // { position, peek, normal, tangent, low, shape, threatDistance, distance }.
  points(center, threat, { radius = 14, spacing = 1.1, crouchHeight = 0.85, standHeight = 1.3 } = {}) {
    const out = [];
    const r = this.agentRadius + 0.12;
    for (const s of this.world.nearby(center.x, center.z, radius)) {
      const gy0 = this.world.groundHeight(s.x, s.z, s.minY, 0.3).y; // floor under the collider (not its own top)
      if (!this._usable(s, gy0)) continue;
      const faces = [];
      if (s.type === 'box') {
        for (const [lx, lz, nx, nz, half] of [[s.hx, 0, 1, 0, s.hz], [-s.hx, 0, -1, 0, s.hz], [0, s.hz, 0, 1, s.hx], [0, -s.hz, 0, -1, s.hx]]) {
          // sample a point just outside the face and let face() describe it
          const ox = lx + nx * 0.3, oz = lz + nz * 0.3;
          const wx = s.x + ox * s.cos + oz * s.sin, wz = s.z - ox * s.sin + oz * s.cos;
          const f = this.face(s, wx, wz, gy0); if (f) faces.push([f, half]);
        }
      } else if (s.type === 'cylinder') {
        const away = V(s.x - threat.x, 0, s.z - threat.z).normalize();
        const f = this.face(s, s.x + away.x * (s.r + 0.3), s.z + away.z * (s.r + 0.3), gy0); if (f) faces.push([f, 0]);
      }
      for (const [f, half] of faces) {
        const toThreat = V(threat.x - f.center.x, 0, threat.z - f.center.z);
        if (f.normal.dot(toThreat) > -0.2 * toThreat.length()) continue; // threat must be behind the wall
        const samples = [];
        if (s.type === 'cylinder') samples.push(0);
        else if (f.low) { const n = Math.max(1, Math.floor((2 * half) / spacing)); for (let i = 0; i < n; i++) samples.push(-half + (i + 0.5) * (2 * half / n)); }
        else { const e = Math.max(0, half - (this.agentRadius + 0.15)); samples.push(e, -e); } // high cover: only edges can peek
        for (const a of samples) {
          const g = this.decorate({ ...f, normal: f.normal.clone(), tangent: f.tangent.clone(), center: f.center.clone(), point: f.point.clone() }, a);
          const pos = s.type === 'cylinder' ? f.point.clone().addScaledVector(f.normal, r) : g.snap.clone();
          pos.y = this._ground(pos.x, pos.z);
          if (pos.distanceTo(center) > radius) continue;
          const block = this.world.resolveCylinder(pos.x, pos.z, this.agentRadius * 0.9, pos.y + 0.3, pos.y + 1.6);
          if (block.hits.some((h) => h.shape !== s)) continue;
          if (!this.isProtected(pos, threat, { height: f.low ? crouchHeight : standHeight })) continue;
          let peek = f.low ? pos.clone() : this.peekPosition(g, half + 1);
          if (s.type === 'cylinder') { const side = g.tangent.clone().multiplyScalar(s.r + this.agentRadius + this.peekOut); peek = pos.clone().add(side); }
          out.push({ position: pos, peek, normal: g.normal, tangent: g.tangent, low: f.low, shape: s, cover: g, threatDistance: pos.distanceTo(threat), distance: pos.distanceTo(center) });
        }
      }
    }
    return out;
  }
  // claim registry (squad coordination)
  _key(p) { return Math.round(p.x * 2) + ',' + Math.round(p.z * 2); }
  claim(p, owner) { const k = this._key(p); const o = this.claims.get(k); if (o && o !== owner) return false; this.release(owner); this.claims.set(k, owner); return true; }
  claimedBy(p) { return this.claims.get(this._key(p)) || null; }
  release(owner) { for (const [k, o] of this.claims) if (o === owner) this.claims.delete(k); }
}
