// NPC daily life: time-of-day schedules (sleep/home/work/eat/shop/wander/...), places,
// travel through a pluggable path planner (NavGrid, sidewalk graph, straight line) with
// Steering, interruption (flee / cower / watch a danger) and resume, and a ScheduleSystem
// that follows the app clock (atmosphere.timeOfDay) and fast-forwards agents after time jumps.
// Pure simulation (positions only): the owner renders/animates (see world/crowd.js) or feeds
// `agent.velocity` into an Actor.
import * as THREE from '../vendor/three/three.module.js';
import { RNG } from '../core/rng.js';
import { Steering } from './behavior.js';

// How each activity is performed. inside = probability of spending it indoors (hidden);
// radius = loiter radius around the place; roam = keeps travelling between random places.
export const ACTIVITIES = {
  sleep: { inside: 1, radius: 0 },
  home: { inside: 0.5, radius: 2.5, pause: [3, 9] },
  work: { inside: 0.6, radius: 3, pause: [4, 12] },
  eat: { inside: 0.35, radius: 2.5, pause: [4, 10] },
  shop: { inside: 0.3, radius: 4, pause: [2, 6] },
  wander: { inside: 0, roam: true, radius: 0, pause: [1, 4] },
  park: { inside: 0, radius: 6, pause: [3, 8] },
  idle: { inside: 0, radius: 1.5, pause: [3, 8] },
  patrol: { inside: 0, roam: true, radius: 0, pause: [0.5, 2] },
};

// Templates: [fromHour, toHour, activity, placeKind]. Hours wrap (22 -> 6 crosses midnight).
export const SCHEDULE_TEMPLATES = {
  worker: [[22.5, 6.5, 'sleep', 'home'], [6.5, 7.5, 'home', 'home'], [7.5, 8.5, 'eat', 'eat'], [8.5, 12, 'work', 'work'], [12, 13, 'eat', 'eat'], [13, 17.5, 'work', 'work'], [17.5, 19, 'shop', 'shop'], [19, 22.5, 'home', 'home']],
  shopper: [[23, 8, 'sleep', 'home'], [8, 10, 'home', 'home'], [10, 12.5, 'shop', 'shop'], [12.5, 13.5, 'eat', 'eat'], [13.5, 17, 'wander', 'any'], [17, 20, 'shop', 'shop'], [20, 23, 'home', 'home']],
  retiree: [[21, 6, 'sleep', 'home'], [6, 9, 'park', 'park'], [9, 11, 'shop', 'shop'], [11, 12.5, 'home', 'home'], [12.5, 13.5, 'eat', 'eat'], [13.5, 17, 'park', 'park'], [17, 21, 'home', 'home']],
  nightOwl: [[4, 12, 'sleep', 'home'], [12, 13, 'eat', 'eat'], [13, 18, 'home', 'home'], [18, 20, 'eat', 'eat'], [20, 4, 'wander', 'any']],
  student: [[23.5, 7, 'sleep', 'home'], [7, 8, 'home', 'home'], [8, 14, 'work', 'work'], [14, 15, 'eat', 'eat'], [15, 18, 'wander', 'any'], [18, 20.5, 'park', 'park'], [20.5, 23.5, 'home', 'home']],
  guard: [[2, 10, 'sleep', 'home'], [10, 11, 'eat', 'eat'], [11, 2, 'patrol', 'any']],
};

const wrap24 = (h) => ((h % 24) + 24) % 24;
// Is hour inside [from, to) on a 24h clock (handles midnight wrap)?
export function inSpan(hour, from, to) { hour = wrap24(hour); from = wrap24(from); to = wrap24(to); return from <= to ? hour >= from && hour < to : hour >= from || hour < to; }
// Forward distance in hours from a to b on the clock (0..24).
export const hoursBetween = (a, b) => wrap24(b - a);

/** Normalise a template / entry list into [{ from, to, activity, place }]. */
export function makeSchedule(def) {
  const list = typeof def === 'string' ? SCHEDULE_TEMPLATES[def] : def;
  if (!list) throw new Error('unknown schedule template ' + def);
  return list.map((e) => (Array.isArray(e) ? { from: e[0], to: e[1], activity: e[2], place: e[3] ?? e[2] } : { place: e.activity, ...e }));
}
/** Entry active at `hour` (first match). Falls back to an 'idle' entry. */
export function activityAt(schedule, hour) {
  for (const e of schedule) if (inSpan(hour, e.from, e.to)) return e;
  return { from: 0, to: 24, activity: 'idle', place: 'any', fallback: true };
}
/** Same schedule with every boundary shifted by up to ±amount hours (keeps entries contiguous). */
export function jitterSchedule(schedule, rng, amount = 0.5) {
  const out = schedule.map((e) => ({ ...e }));
  for (let i = 0; i < out.length; i++) {
    const next = out[(i + 1) % out.length];
    if (wrap24(out[i].to) !== wrap24(next.from)) continue; // only shared boundaries move together
    const d = rng.range(-amount, amount);
    const lenA = hoursBetween(out[i].from, out[i].to), lenB = hoursBetween(next.from, next.to);
    const dd = Math.max(-lenA * 0.45, Math.min(lenB * 0.45, d));
    out[i].to = wrap24(out[i].to + dd); next.from = out[i].to;
  }
  return out;
}

/** Places registry: { id, kind | kinds[], x, z, radius }. */
export class PlaceRegistry {
  constructor(places = []) { this.list = []; this.byKind = new Map(); for (const p of places) this.add(p); }
  add(p) {
    const place = { radius: 3, ...p, id: p.id ?? 'place' + this.list.length };
    this.list.push(place);
    for (const k of place.kinds || [place.kind]) { if (!this.byKind.has(k)) this.byKind.set(k, []); this.byKind.get(k).push(place); }
    return place;
  }
  of(kind) { return kind === 'any' ? this.list : this.byKind.get(kind) || []; }
  pick(kind, rng) { const l = this.of(kind); return l.length ? l[Math.floor(rng.next() * l.length)] : null; }
  nearest(kind, x, z) { let best = null, bd = Infinity; for (const p of this.of(kind)) { const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = p; } } return best; }
}

// Planner helpers: (from, to) -> [{x, z}, ...] waypoints ending at `to`.
export const straightPlanner = (from, to) => [new THREE.Vector3(to.x, 0, to.z)];
export function navGridPlanner(grid) { return (from, to) => grid.findPath(new THREE.Vector3(from.x, 0, from.z), new THREE.Vector3(to.x, 0, to.z)) || [new THREE.Vector3(to.x, 0, to.z)]; }

let AGENT_ID = 1;
/**
 * ScheduleAgent: one NPC's daily life.
 *   new ScheduleAgent({ schedule: 'worker' | entries, places: { home, work, eat, ... } | PlaceRegistry,
 *                       position, seed, speed, runSpeed, planner, walkable, groundY, integrate })
 * update(dt, hour) -> sets .velocity, .position (if integrate), .visible, .state, .activity
 * States: 'inside' (hidden at a place) | 'travel' | 'perform' | 'flee' | 'cower' | 'watch'
 */
export class ScheduleAgent {
  constructor({ id, schedule = 'worker', places = {}, registry = null, position = new THREE.Vector3(), seed = 1, speed = 1.35, runSpeed = 4.2, planner = straightPlanner, walkable = null, groundY = null, integrate = true, jitter = 0.5, activities = ACTIVITIES } = {}) {
    this.id = id ?? 'sa' + AGENT_ID++;
    this.rng = new RNG(seed);
    this.schedule = jitter > 0 ? jitterSchedule(makeSchedule(schedule), this.rng, jitter) : makeSchedule(schedule);
    this.registry = registry || (places instanceof PlaceRegistry ? places : null);
    this.places = places instanceof PlaceRegistry ? {} : { ...places }; // kind -> fixed place for this agent
    Object.assign(this, { speed: speed * this.rng.range(0.9, 1.1), runSpeed, planner, walkable, groundY, integrate, activities });
    this.position = position.clone ? position.clone() : new THREE.Vector3(position.x, 0, position.z);
    this.velocity = new THREE.Vector3(); this.heading = this.rng.range(-Math.PI, Math.PI);
    this.state = 'perform'; this.visible = true; this.entry = null; this.place = null; this.path = null; this.pathState = {};
    this.wait = 0; this.interruption = null; this.log = [];
    this.stats = { arrivals: 0, interruptions: 0, resumes: 0 };
  }
  get activity() { return this.entry?.activity ?? 'idle'; }
  // Resolve the agent's place for an entry (fixed per kind: the same home every night).
  placeFor(entry) {
    const kind = entry.place || entry.activity, act = this.activities[entry.activity] || ACTIVITIES.idle;
    if (act.roam || kind === 'any') return this.registry ? this.registry.pick('any', this.rng) : this.places[kind] || null;
    if (!this.places[kind] && this.registry) this.places[kind] = this.registry.pick(kind, this.rng) || this.registry.pick('any', this.rng);
    return this.places[kind] || null;
  }
  _go(target) {
    if (!target) { this.state = 'perform'; this.path = null; return; }
    const pts = this.planner(this.position, target) || [target];
    this.path = pts.map((p) => new THREE.Vector3(p.x, 0, p.z)); this.pathState = {}; this.state = 'travel'; this.visible = true;
  }
  _begin(entry) {
    const prevPlace = this.place, wasInside = this.state === 'inside';
    this.entry = entry; this.place = this.placeFor(entry);
    this.log.push({ activity: entry.activity, place: this.place?.id }); if (this.log.length > 12) this.log.shift();
    if (wasInside && prevPlace && this.place === prevPlace) { this._arrive(); return; }
    if (wasInside && prevPlace) { this.position.set(prevPlace.x, this.position.y, prevPlace.z); }
    this._go(this.place);
  }
  _arrive() {
    const act = this.activities[this.activity] || ACTIVITIES.idle;
    this.stats.arrivals++;
    if (act.roam) { this.state = 'perform'; this.visible = true; this.path = null; this.wait = this.rng.range(...(act.pause || [1, 3])); return; }
    if (this.rng.next() < (act.inside ?? 0)) { this.state = 'inside'; this.visible = false; this.velocity.set(0, 0, 0); return; }
    this.state = 'perform'; this.visible = true; this.wait = this.rng.range(...(act.pause || [2, 6])); this.loiter = null;
  }
  /** Jump straight into the current activity at its place (after a time skip / on spawn). */
  teleport(hour) {
    this.interruption = null;
    const e = activityAt(this.schedule, hour);
    this.entry = e; this.place = this.placeFor(e);
    const act = this.activities[e.activity] || ACTIVITIES.idle;
    if (this.place) {
      const a = this.rng.range(0, Math.PI * 2), r = (act.radius || 0) * this.rng.next();
      let p = { x: this.place.x + Math.cos(a) * r, z: this.place.z + Math.sin(a) * r }; if (this.walkable) p = this.walkable(p, this);
      this.position.set(p.x, this.position.y, p.z);
    }
    this.path = null; this.velocity.set(0, 0, 0);
    if (act.roam) { this.state = 'perform'; this.visible = true; this.wait = this.rng.range(0, 2); }
    else if (this.rng.next() < (act.inside ?? 0)) { this.state = 'inside'; this.visible = false; if (this.place) { let p = { x: this.place.x, z: this.place.z }; if (this.walkable) p = this.walkable(p, this); this.position.set(p.x, this.position.y, p.z); } }
    else { this.state = 'perform'; this.visible = true; this.wait = this.rng.range(0, 4); }
  }
  /**
   * React to danger: { type: 'flee' | 'cower' | 'watch', from: {x,z}, duration }.
   * Agents indoors ignore it. After `duration` the agent resumes its schedule (re-plans).
   */
  interrupt({ type = 'flee', from, duration = 6 } = {}) {
    if (this.state === 'inside') return false;
    if (this.interruption && this.interruption.type === 'flee' && type !== 'flee') return false; // keep the stronger reaction
    this.interruption = { type, from: from ? new THREE.Vector3(from.x, 0, from.z) : this.position.clone(), t: duration, resumeState: this.interruption?.resumeState ?? this.state };
    this.state = type; this.stats.interruptions++;
    return true;
  }
  resume() { this.interruption = null; this.stats.resumes++; if (this.entry) { const act = this.activities[this.activity] || ACTIVITIES.idle; this._go(act.roam ? this.placeFor(this.entry) : this.place); } else this.state = 'perform'; }
  update(dt, hour) {
    const v = this.velocity.set(0, 0, 0);
    if (this.interruption) {
      const it = this.interruption; it.t -= dt;
      if (it.type === 'flee') { const f = Steering.flee(this.position, it.from, this.runSpeed); if (f.lengthSq() < 1e-6) f.set(Math.sin(this.heading), 0, Math.cos(this.heading)).multiplyScalar(this.runSpeed); v.copy(f); }
      else if (it.type === 'watch') this.heading = Math.atan2(it.from.x - this.position.x, it.from.z - this.position.z);
      if (it.t <= 0) this.resume();
    } else {
      const e = activityAt(this.schedule, hour);
      if (e !== this.entry && !(this.entry && e.fallback && this.entry.fallback)) this._begin(e);
      if (this.state === 'travel') {
        const m = Steering.followPath(this.position, this.path, this.pathState, this.speed, 0.9);
        if (!m) { this.path = null; this._arrive(); } else v.copy(m).clampLength(0, this.speed);
      } else if (this.state === 'perform') {
        const act = this.activities[this.activity] || ACTIVITIES.idle;
        if (this.wait > 0) this.wait -= dt;
        else if (act.roam) this._go(this.placeFor(this.entry)); // roaming = travel between random places
        else if ((act.radius || 0) > 0 && this.place) {
          if (!this.loiter) {
            const a = this.rng.range(0, Math.PI * 2), r = act.radius * Math.sqrt(this.rng.next());
            let p = { x: this.place.x + Math.cos(a) * r, z: this.place.z + Math.sin(a) * r }; if (this.walkable) p = this.walkable(p, this);
            this.loiter = new THREE.Vector3(p.x, 0, p.z);
          }
          const d = Math.hypot(this.loiter.x - this.position.x, this.loiter.z - this.position.z);
          if (d < 0.35) { this.loiter = null; this.wait = this.rng.range(...(act.pause || [2, 6])); }
          else v.copy(Steering.arrive(this.position, this.loiter, this.speed * 0.6, 1)).clampLength(0, this.speed * 0.6);
        }
      }
    }
    if (v.lengthSq() > 1e-4) { const want = Math.atan2(v.x, v.z); let d = want - this.heading; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; this.heading += d * Math.min(1, dt * 8); }
    if (this.integrate) {
      this.position.x += v.x * dt; this.position.z += v.z * dt;
      if (this.groundY) this.position.y = this.groundY(this.position.x, this.position.z);
    }
    return v;
  }
}

/**
 * ScheduleSystem: updates agents from a clock (hours). Detects time jumps (setTime / sleeping /
 * fast travel): if the clock moves more than `jumpHours` in one update, every agent teleports
 * into its current activity instead of walking there in real time.
 */
export class ScheduleSystem {
  constructor({ clock = null, jumpHours = 0.75 } = {}) { this.agents = []; this.clock = clock; this.jumpHours = jumpHours; this.lastHour = null; this.jumps = 0; }
  add(agent) { this.agents.push(agent); return agent; }
  remove(agent) { const i = this.agents.indexOf(agent); if (i >= 0) this.agents.splice(i, 1); }
  update(dt, hour = this.clock ? this.clock() : 12) {
    if (this.lastHour !== null) {
      const fwd = hoursBetween(this.lastHour, hour), back = hoursBetween(hour, this.lastHour);
      if (Math.min(fwd, back) > this.jumpHours) { this.jumps++; for (const a of this.agents) a.teleport(hour); }
    } else for (const a of this.agents) a.teleport(hour);
    this.lastHour = hour;
    for (const a of this.agents) a.update(dt, hour);
  }
  /** Interrupt agents within radius of pos: { type, duration, radius }. Returns how many reacted. */
  alarm(pos, { radius = 25, type = 'flee', duration = 6, watchRadius = 0 } = {}) {
    let n = 0;
    for (const a of this.agents) {
      const d = Math.hypot(a.position.x - pos.x, a.position.z - pos.z);
      if (d < radius) n += a.interrupt({ type, from: pos, duration: duration * (0.8 + 0.4 * (1 - d / radius)) }) ? 1 : 0;
      else if (d < watchRadius) n += a.interrupt({ type: 'watch', from: pos, duration: duration * 0.5 }) ? 1 : 0;
    }
    return n;
  }
  stats() {
    const byActivity = {}, byState = {}; let visible = 0;
    for (const a of this.agents) { byActivity[a.activity] = (byActivity[a.activity] || 0) + 1; byState[a.state] = (byState[a.state] || 0) + 1; if (a.visible) visible++; }
    return { agents: this.agents.length, visible, byActivity, byState, jumps: this.jumps };
  }
}

// Drive a ScheduleSystem from the app's time of day (atmosphere.timeOfDay).
export function attachSchedules(app, system, { order = 5 } = {}) {
  system.clock = () => app.atmosphere.timeOfDay;
  return app.add((dt) => system.update(dt, app.atmosphere.timeOfDay), { order });
}
