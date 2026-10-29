// Racing kit: racing line (iterative minimum-curvature smoothing inside the track limits)
// with a curvature speed profile and braking points, AI racers (pure-pursuit steering on
// the racing line, braking from the speed profile, overtaking offsets, stuck recovery,
// rubber-banding), and a race manager (countdown, start grid, ordered checkpoints, laps,
// split / lap / best times, live positions, wrong-way detection, respawn on track).
// Works with engine/physics/vehicle.js (any object with position/velocity/yaw/setInput/resetOnRoad).
//
//   const track = generateTrack({ seed }); const line = computeRacingLine(track);
//   const race = new RaceManager(track, { laps: 3 });
//   race.add(playerCar, { name: 'You', isPlayer: true }); race.add(aiCar, { ai: new RaceAI(aiCar, track, line) });
//   race.placeOnGrid(); race.start();  each step: ai.update -> vehicle.update -> race.update(dt)
import * as THREE from '../vendor/three/three.module.js';
import { clamp, lerp, wrapAngle } from '../core/rng.js';

// ---------------------------------------------------------------------------------------
export function computeRacingLine(track, { margin = 1.8, iterations = 60, aLat = 17, aBrake = 15, aAccel = 7, vMax = 58 } = {}) {
  const S = track.samples, N = S.length, sp = track.opts.spacing;
  const off = new Float64Array(N), px = new Float64Array(N), pz = new Float64Array(N), lim = new Float64Array(N);
  for (let i = 0; i < N; i++) { lim[i] = Math.max(0, S[i].halfWidth - margin); px[i] = S[i].x; pz[i] = S[i].z; }
  const w = (i) => ((i % N) + N) % N;
  // Gauss-Seidel: pull each point toward the midpoint of its neighbours (coarse -> fine),
  // projected on the sample's lateral axis and clamped to the usable width.
  for (const k of [24, 12, 6, 3, 1]) for (let it = 0; it < iterations; it++) for (let i = 0; i < N; i++) {
    const a = w(i - k), b = w(i + k), mx = (px[a] + px[b]) / 2, mz = (pz[a] + pz[b]) / 2, s = S[i];
    const o = clamp((mx - s.x) * s.rx + (mz - s.z) * s.rz, -lim[i], lim[i]);
    off[i] = o; px[i] = s.x + s.rx * o; pz[i] = s.z + s.rz * o;
  }
  // the clamp leaves small kinks where the line touches the limits: low-pass the offsets
  for (let pass = 0; pass < 8; pass++) {
    const o0 = Float64Array.from(off);
    for (let i = 0; i < N; i++) { let a = 0, ws = 0; for (let k = -4; k <= 4; k++) { const wk = 5 - Math.abs(k); a += o0[w(i + k)] * wk; ws += wk; } off[i] = clamp(a / ws, -lim[i], lim[i]); }
  }
  for (let i = 0; i < N; i++) { px[i] = S[i].x + S[i].rx * off[i]; pz[i] = S[i].z + S[i].rz * off[i]; }
  // curvature of the line (circumcircle of i-2, i, i+2)
  const curv = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = w(i - 2), b = w(i + 2);
    const ax = px[a] - px[i], az = pz[a] - pz[i], bx = px[b] - px[i], bz = pz[b] - pz[i];
    const cross = ax * bz - az * bx, la = Math.hypot(ax, az), lb = Math.hypot(bx, bz), lc = Math.hypot(px[b] - px[a], pz[b] - pz[a]);
    curv[i] = (2 * cross) / Math.max(1e-6, la * lb * lc);
  }
  for (let pass = 0; pass < 3; pass++) { const c = Float64Array.from(curv); for (let i = 0; i < N; i++) curv[i] = (c[w(i - 1)] + 2 * c[i] + c[w(i + 1)]) / 4; }
  // speed profile: lateral grip limit, then braking (backward) and traction (forward) passes
  const speed = new Float64Array(N);
  for (let i = 0; i < N; i++) speed[i] = Math.min(vMax, Math.sqrt(aLat / Math.max(1e-5, Math.abs(curv[i]))));
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 2 * N - 1; i >= 0; i--) { const a = w(i), b = w(i + 1); speed[a] = Math.min(speed[a], Math.sqrt(speed[b] ** 2 + 2 * aBrake * sp)); }
    for (let i = 0; i < 2 * N; i++) { const a = w(i), b = w(i - 1); speed[a] = Math.min(speed[a], Math.sqrt(speed[b] ** 2 + 2 * aAccel * sp)); }
  }
  // braking points: where the target speed starts to drop
  const brakingPoints = [];
  for (let i = 0; i < N; i++) {
    const dropping = speed[w(i + 1)] < speed[i] - 0.05, before = speed[i] < speed[w(i - 1)] - 0.05;
    if (dropping && !before) { let j = i, min = speed[i]; while (speed[w(j + 1)] < speed[w(j)] + 1e-6 && j - i < N) { j++; min = Math.min(min, speed[w(j)]); } if (speed[i] - min > 2) brakingPoints.push({ index: i, s: i * sp, entrySpeed: speed[i], apexSpeed: min, apexIndex: w(j) }); }
  }
  // estimated lap time along the line with this speed profile (the quantity the line optimises)
  let lapTime = 0, lineLength = 0;
  for (let i = 0; i < N; i++) { const b = w(i + 1), d = Math.hypot(px[b] - px[i], pz[b] - pz[i]); lineLength += d; lapTime += d / Math.max(1, (speed[i] + speed[b]) / 2); }
  const at = (arr, s) => { const f = track.wrapS(s) / sp, i = Math.floor(f), t = f - i; return lerp(arr[w(i)], arr[w(i + 1)], t); };
  return {
    offsets: off, curvature: curv, speed, brakingPoints, lapTime, lineLength, spacing: sp, length: track.length, margin,
    points: Array.from({ length: N }, (_, i) => new THREE.Vector3(px[i], S[i].y - off[i] * Math.tan(S[i].bank), pz[i])),
    offsetAt: (s) => at(off, s), speedAt: (s) => at(speed, s),
    pointAt: (s, extraLateral = 0, out = new THREE.Vector3()) => { const f = track.sampleAt(s); const o = clamp(at(off, s) + extraLateral, -(f.halfWidth - 1), f.halfWidth - 1); return out.set(f.x + f.rx * o, f.y - o * Math.tan(f.bank), f.z + f.rz * o); },
    // racing line offsets stay inside the track limits (minus margin)
    withinBounds: () => S.every((s, i) => Math.abs(off[i]) <= s.halfWidth - margin + 1e-6),
  };
}

// ---------------------------------------------------------------------------------------
export class RaceAI {
  constructor(vehicle, track, line, { skill = 1, laneOffset = 0, aggression = 0.5, rubberBand = { behind: 0.12, ahead: 0.08, range: 150 }, name = 'AI' } = {}) {
    Object.assign(this, { vehicle, track, line, skill, laneOffset, aggression, rubberBand, name });
    this.hint = -1; this.rubber = 1; this.stuckTime = 0; this.needsRespawn = false; this.avoid = 0; this.enabled = true;
    this.base = { enginePower: vehicle.enginePower, maxSpeed: vehicle.maxSpeed };
    this.target = new THREE.Vector3(); this.targetSpeed = 0;
  }
  setRubber(f) { this.rubber = f; this.vehicle.enginePower = this.base.enginePower * f; this.vehicle.maxSpeed = this.base.maxSpeed * (0.5 + 0.5 * f); }
  update(dt, others = []) {
    const v = this.vehicle;
    if (!this.enabled) { v.setInput({ brake: 1 }); return; }
    const pr = this.track.project(v.position.x, v.position.z, this.hint); this.hint = pr.index;
    const speed = v.speed, vAbs = Math.abs(speed);
    // traffic: steer around the nearest car ahead in our lane
    let want = this.laneOffset;
    for (const o of others) {
      if (o === v) continue;
      const dx = o.position.x - v.position.x, dz = o.position.z - v.position.z, ahead = dx * v.forward.x + dz * v.forward.z, side = dx * v.right.x + dz * v.right.z;
      if (ahead > 0 && ahead < 14 + vAbs * 0.3 && Math.abs(side) < 2.4) want += (side > 0 ? -1 : 1) * 2.8 * (1 - ahead / (14 + vAbs * 0.3));
    }
    this.avoid += (want - this.avoid) * (1 - Math.exp(-3 * dt));
    // pure pursuit on the racing line
    const Ld = 6 + vAbs * 0.42;
    this.line.pointAt(pr.s + Ld, this.avoid, this.target);
    const dx = this.target.x - v.position.x, dz = this.target.z - v.position.z;
    const alpha = wrapAngle(Math.atan2(dx, dz) - v.yaw);
    const wb = Math.abs(v.wheels[0].z - v.wheels[2].z) || 2.6;
    const delta = Math.atan2(2 * wb * Math.sin(alpha), Math.max(3, Math.hypot(dx, dz)));
    const steerLimit = v.steerMax * (1 - clamp(vAbs / v.maxSpeed, 0, 1) * 0.65);
    const steer = clamp(delta / Math.max(0.05, steerLimit), -1, 1);
    // speed: profile a little ahead (reaction), scaled by skill and rubber-banding
    const look = Math.min(this.line.speedAt(pr.s + 3 + vAbs * 0.25), this.line.speedAt(pr.s + 3));
    const vt = look * this.skill * (0.85 + 0.15 * this.rubber) * (Math.abs(this.avoid - this.laneOffset) > 1 ? 0.97 : 1);
    this.targetSpeed = vt;
    let throttle = 0, brake = 0;
    if (Math.abs(alpha) > 1.6) { throttle = 0.4; } // facing badly: crawl round
    else if (speed < vt - 0.5) throttle = 1;
    else if (speed > vt + 1.2) brake = clamp((speed - vt) / 6, 0.25, 1);
    else throttle = 0.45;
    v.setInput({ throttle, brake, steer, handbrake: false, boost: false });
    // stuck detection -> manager respawns
    if (vAbs < 1.5 && throttle > 0) this.stuckTime += dt; else this.stuckTime = Math.max(0, this.stuckTime - dt * 2);
    this.needsRespawn = this.stuckTime > 2.5;
  }
}

// ---------------------------------------------------------------------------------------
export function formatTime(t) { if (t == null || !isFinite(t)) return '--:--.---'; const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s < 10 ? '0' : ''}${s.toFixed(3)}`; }

export class RaceManager {
  constructor(track, { laps = 3, countdown = 3, autoRespawn = true, offTrackTime = 2.5, gateSlack = 3 } = {}) {
    Object.assign(this, { track, laps, countdownTime: countdown, autoRespawn, offTrackTime, gateSlack });
    this.entrants = []; this.state = 'grid'; this.countdown = 0; this.raceTime = 0; this.finishOrder = [];
    this.onCheckpoint = null; this.onLap = null; this.onFinish = null; this.onWrongWay = null; this.onRespawn = null; this.onStart = null; this.onCountdown = null;
  }
  add(vehicle, { name = 'Car ' + (this.entrants.length + 1), isPlayer = false, ai = null } = {}) {
    const e = { id: this.entrants.length, name, vehicle, isPlayer, ai, lap: 0, cpCount: 0, progress: 0, lastS: 0, hint: -1, lapStart: 0, lapTimes: [], splits: [[]], bestLap: null,
      position: this.entrants.length + 1, finished: false, finishTime: null, wrongWay: false, wrongTimer: 0, offTimer: 0, respawns: 0, lateral: 0, s: 0, lastLap: null };
    this.entrants.push(e); return e;
  }
  get player() { return this.entrants.find((e) => e.isPlayer) || null; }
  placeOnGrid(order = this.entrants) {
    const L = this.track.length;
    order.forEach((e, i) => {
      const slot = this.track.startGrid[i % this.track.startGrid.length];
      e.vehicle.resetOnRoad(slot.position, slot.yaw);
      e.lastS = slot.s; e.s = slot.s; e.progress = slot.s - (slot.s > L / 2 ? L : 0); e.hint = -1;
    });
    this.state = 'grid';
  }
  start() { this.state = 'countdown'; this.countdown = this.countdownTime; this._lastCount = Math.ceil(this.countdown) + 1; }
  // Absolute progress (metres) at which entrant must pass its next checkpoint.
  nextGateProgress(e) { const K = this.track.checkpoints.length, k = e.cpCount % K; return Math.floor(e.cpCount / K) * this.track.length + this.track.checkpoints[k].s; }
  update(dt) {
    const T = this.track, L = T.length, K = T.checkpoints.length;
    if (this.state === 'countdown') {
      this.countdown -= dt;
      const c = Math.ceil(this.countdown); if (c !== this._lastCount && c > 0) { this._lastCount = c; this.onCountdown?.(c); }
      for (const e of this.entrants) { e.vehicle.velocity.set(0, 0, 0); e.vehicle.yawRate = 0; }
      if (this.countdown <= 0) { this.state = 'racing'; this.raceTime = 0; for (const e of this.entrants) e.lapStart = 0; this.onStart?.(); }
      return;
    }
    if (this.state !== 'racing' && this.state !== 'finished') return;
    this.raceTime += dt;
    for (const e of this.entrants) {
      const v = e.vehicle, pr = T.project(v.position.x, v.position.z, e.hint);
      e.hint = pr.index; e.s = pr.s; e.lateral = pr.lateral;
      let ds = pr.s - e.lastS; if (ds < -L / 2) ds += L; if (ds > L / 2) ds -= L;
      e.progress += ds; e.lastS = pr.s;
      if (e.finished) continue;
      // ordered checkpoints (gate width = road + runoff + slack)
      const gate = this.nextGateProgress(e);
      if (e.progress >= gate) {
        const cp = T.checkpoints[e.cpCount % K];
        if (Math.abs(pr.lateral) <= cp.halfWidth + T.runoff + this.gateSlack) {
          const k = e.cpCount % K;
          if (k === 0 && e.cpCount > 0) {
            const lt = this.raceTime - e.lapStart; e.lapTimes.push(lt); e.lastLap = lt; e.bestLap = e.bestLap == null ? lt : Math.min(e.bestLap, lt);
            e.lap++; e.lapStart = this.raceTime; e.splits.push([]);
            this.onLap?.(e, lt);
            if (e.lap >= this.laps) { e.finished = true; e.finishTime = this.raceTime; this.finishOrder.push(e); this.onFinish?.(e); }
          } else if (k > 0) { e.splits[e.lap][k] = this.raceTime - e.lapStart; }
          e.cpCount++;
          this.onCheckpoint?.(e, k, this.raceTime - e.lapStart);
        } else this.respawn(e, 'missed-checkpoint');
      }
      // wrong way: moving against the track direction
      const f = pr.frame, along = v.velocity.x * f.tx + v.velocity.z * f.tz;
      if (along < -2) e.wrongTimer += dt; else if (along > 1) e.wrongTimer = 0;
      const ww = e.wrongTimer > 0.8; if (ww !== e.wrongWay) { e.wrongWay = ww; this.onWrongWay?.(e, ww); }
      // off track / fallen / stuck -> respawn on the centreline
      const off = Math.abs(pr.lateral) > f.halfWidth + T.runoff + 4 || v.position.y < f.y - 6;
      e.offTimer = off ? e.offTimer + dt : 0;
      if (this.autoRespawn && (e.offTimer > this.offTrackTime || (e.ai && (e.ai.needsRespawn || e.wrongTimer > 4)))) this.respawn(e, off ? 'off-track' : 'stuck');
      // rubber-banding relative to the player
      const pl = this.player;
      if (e.ai && pl && e.ai.rubberBand) { const rb = e.ai.rubberBand, d = e.progress - pl.progress; e.ai.setRubber(1 + (d < 0 ? rb.behind : -rb.ahead) * clamp(Math.abs(d) / rb.range, 0, 1)); }
    }
    // positions: finished first (by time), then by progress
    const ranked = [...this.entrants].sort((a, b) => (a.finished !== b.finished ? (a.finished ? -1 : 1) : a.finished ? a.finishTime - b.finishTime : b.progress - a.progress));
    ranked.forEach((e, i) => { e.position = i + 1; });
    if (this.entrants.every((e) => e.finished) || (this.player && this.player.finished)) this.state = 'finished';
  }
  // Put the car back on the centreline near where it left (never past its next checkpoint).
  respawn(e, reason = 'manual') {
    const T = this.track, gate = this.nextGateProgress(e);
    const prog = Math.min(e.progress, gate - 3) - 4;
    const s = T.wrapS(prog), lat = (e.id % 2 ? 1 : -1) * 1.5, pose = T.pose(s, lat);
    e.vehicle.resetOnRoad(pose.position, pose.yaw);
    e.progress = prog; e.lastS = s; e.hint = -1; e.offTimer = 0; e.wrongTimer = 0; e.wrongWay = false; e.respawns++;
    if (e.ai) { e.ai.stuckTime = 0; e.ai.needsRespawn = false; e.ai.hint = -1; }
    this.onRespawn?.(e, reason);
  }
  leaderboard() { return [...this.entrants].sort((a, b) => a.position - b.position).map((e) => ({ name: e.name, position: e.position, lap: Math.min(this.laps, e.lap + 1), finished: e.finished, gap: e.finished ? formatTime(e.finishTime) : null })); }
  debugState() {
    const pl = this.player;
    return { state: this.state, raceTime: +this.raceTime.toFixed(3), countdown: +this.countdown.toFixed(2), laps: this.laps,
      player: pl ? { position: pl.position, lap: pl.lap, cpCount: pl.cpCount, nextCp: pl.cpCount % this.track.checkpoints.length, progress: +pl.progress.toFixed(1), wrongWay: pl.wrongWay, lapTimes: pl.lapTimes, bestLap: pl.bestLap, finished: pl.finished, lateral: +pl.lateral.toFixed(2), respawns: pl.respawns } : null,
      entrants: this.entrants.map((e) => ({ name: e.name, position: e.position, lap: e.lap, cpCount: e.cpCount, progress: +e.progress.toFixed(1), lapTimes: e.lapTimes.map((t) => +t.toFixed(3)), finished: e.finished, respawns: e.respawns, kmh: Math.round(e.vehicle.kmh || 0) })) };
  }
}
