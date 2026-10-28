// Cinematics: shot-based camera grammar + an event timeline for cutscenes and in-engine story
// moments. A cinematic definition is plain data (authorable by agents, reviewable as a storyboard
// with `gameforge cinematic`):
//
// { duration, letterbox: true,
//   shots: [{ name, t, dur, size: 'extremeWide'|'wide'|'full'|'medium'|'closeup'|'extremeCloseup'|'overShoulder'|'twoShot',
//             subject: 'actorId', other: 'actorId', side: 1|-1, height, move: 'static'|'dollyIn'|'dollyOut'|'orbit'|'truck'|'crane',
//             amount, fov, pos:[x,y,z], look:[x,y,z] /* explicit override */, shake }],
//   events: [{ t, subtitle, speaker, dur } | { t, actor, play: 'clip', upperOnly } | { t, actor, expression, weight } |
//            { t, actor, moveTo: [x,y,z], dur } | { t, actor, face: 'actorId'|[x,y,z] } | { t, sfx, pos } | { t, music, intensity } |
//            { t, fade: 'in'|'out', dur } | { t, event: 'name' }] }
import * as THREE from '../vendor/three/three.module.js';

// shot sizes: camera distance as multiples of subject height + framing height (fraction of height)
export const SHOT_SIZES = {
  extremeWide: { dist: 9, h: 0.6, fov: 50 }, wide: { dist: 4.2, h: 0.6, fov: 45 }, full: { dist: 2.3, h: 0.55, fov: 40 },
  medium: { dist: 1.15, h: 0.78, fov: 35 }, closeup: { dist: 0.55, h: 0.92, fov: 30 }, extremeCloseup: { dist: 0.28, h: 0.94, fov: 25 },
  overShoulder: { dist: 0.75, h: 0.88, fov: 35 }, twoShot: { dist: 1.9, h: 0.7, fov: 40 },
};

const tmp = new THREE.Vector3();
function actorInfo(a) {
  a.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(a), h = Math.max(0.3, box.max.y - box.min.y), base = a.getWorldPosition(new THREE.Vector3());
  base.y = box.min.y;
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(a.getWorldQuaternion(new THREE.Quaternion())); fwd.y = 0; fwd.normalize();
  return { base, h, fwd, head: base.clone().add(new THREE.Vector3(0, h * 0.93, 0)) };
}

/** Camera pose for a shot at normalised time u (0..1). actors: { id: Object3D }. Returns { pos, look, fov }. */
export function shotCamera(shot, actors, u = 0) {
  if (shot.pos && shot.look) { const p = new THREE.Vector3(...shot.pos), l = new THREE.Vector3(...shot.look); applyMove(shot, p, l, u); return { pos: p, look: l, fov: shot.fov ?? 40 }; }
  const S = SHOT_SIZES[shot.size || 'medium'] || SHOT_SIZES.medium, A = actors[shot.subject];
  if (!A) throw new Error(`cinematic: unknown subject '${shot.subject}'`);
  const a = actorInfo(A), side = shot.side ?? 1, B = shot.other ? actorInfo(actors[shot.other]) : null;
  let look = a.base.clone().add(new THREE.Vector3(0, a.h * S.h, 0)), pos;
  const right = new THREE.Vector3(a.fwd.z, 0, -a.fwd.x); // subject's right (character faces +Z)
  if ((shot.size === 'overShoulder' || shot.size === 'twoShot') && B) {
    const axis = B.base.clone().sub(a.base); axis.y = 0; const d = axis.length(); axis.normalize();
    const perp = new THREE.Vector3(axis.z, 0, -axis.x).multiplyScalar(side); // stays on one side of the A–B line (180° rule)
    if (shot.size === 'overShoulder') { // just behind and beside B's shoulder (B's shoulder/head frames one edge), looking at A's face
      pos = B.base.clone().addScaledVector(axis, 0.55).addScaledVector(perp, 0.32); pos.y = B.base.y + B.h * 0.93;
      look = a.head.clone().lerp(B.head, 0.12); look.y -= a.h * 0.04;
    } else { // both actors fill ~65 % of the horizontal field of view
      const mid = a.base.clone().lerp(B.base, 0.5), hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(shot.fov ?? S.fov) / 2) * (shot.aspect ?? 16 / 9));
      const dist = Math.max(S.dist * a.h, (d / 2 + 0.35) / Math.tan(hfov / 2) / 0.65);
      pos = mid.clone().addScaledVector(perp, dist); pos.y = mid.y + a.h * 0.72;
      look = mid.clone(); look.y += a.h * 0.62;
    }
  } else {
    const dir = a.fwd.clone().multiplyScalar(Math.cos(0.45 * side)).addScaledVector(right, Math.sin(0.45 * side)).normalize(); // 3/4 front
    pos = a.base.clone().addScaledVector(dir, S.dist * a.h + 0.3); pos.y = a.base.y + a.h * (shot.height ?? S.h * 0.95);
  }
  applyMove(shot, pos, look, u, a);
  if (shot.shake) { const s = shot.shake * 0.02; pos.x += Math.sin(u * 37) * s; pos.y += Math.sin(u * 53 + 1) * s; }
  return { pos, look, fov: shot.fov ?? S.fov };
}
function applyMove(shot, pos, look, u, a) {
  const m = shot.move || 'static', k = (shot.amount ?? 0.3), e = u * u * (3 - 2 * u);
  const toLook = look.clone().sub(pos);
  if (m === 'dollyIn') pos.addScaledVector(toLook, k * e);
  else if (m === 'dollyOut') pos.addScaledVector(toLook, -k * e);
  else if (m === 'truck') { const r = new THREE.Vector3(toLook.z, 0, -toLook.x).normalize(); pos.addScaledVector(r, (e - 0.5) * k * 2); look.addScaledVector(r, (e - 0.5) * k * 2); }
  else if (m === 'crane') pos.y += (e - 0.5) * k * 2;
  else if (m === 'orbit') { const ang = (e - 0.5) * k * 2, off = pos.clone().sub(look); off.applyAxisAngle(new THREE.Vector3(0, 1, 0), ang); pos.copy(look).add(off); }
  void a;
}

/**
 * Character lighting for cinematics (key / fill / rim relative to camera and subject), the way film
 * and AAA cutscenes light faces regardless of the world lighting. Returns { group, update(shotCam, subject) }.
 * def.lighting: { key = 2.2, fill = 0.6, rim = 1.6, color = 0xfff1e0, rimColor = 0xbcd4ff } | false
 */
export function cinematicLights(opts = {}) {
  const o = { key: 2.2, fill: 0.6, rim: 1.6, color: 0xfff1e0, rimColor: 0xbcd4ff, ...opts }, g = new THREE.Group(); g.name = 'cinematic-lights';
  const key = new THREE.SpotLight(o.color, o.key * 6, 12, 0.6, 0.6, 1.5), fill = new THREE.PointLight(0xdfe6ff, o.fill * 3, 8, 1.5), rim = new THREE.SpotLight(o.rimColor, o.rim * 6, 12, 0.5, 0.7, 1.5);
  key.castShadow = false; g.add(key, key.target, fill, rim, rim.target);
  const update = (cam, subject) => {
    if (!subject) return; const a = actorInfo(subject), head = a.head, toCam = cam.pos.clone().sub(head); toCam.y = 0; toCam.normalize();
    const side = new THREE.Vector3(toCam.z, 0, -toCam.x);
    key.position.copy(head).addScaledVector(toCam, 1.6).addScaledVector(side, 1.2).add(new THREE.Vector3(0, 0.7, 0)); key.target.position.copy(head);
    fill.position.copy(head).addScaledVector(toCam, 1.4).addScaledVector(side, -1.3);
    rim.position.copy(head).addScaledVector(toCam, -1.6).addScaledVector(side, -0.6).add(new THREE.Vector3(0, 0.6, 0)); rim.target.position.copy(head);
  };
  return { group: g, update };
}

/** Validate a cinematic definition (structure + film-grammar checks that need no rendering). */
export function lintCinematic(def, actors = {}) {
  const issues = [], warn = (msg) => issues.push({ level: 'warn', msg }), err = (msg) => issues.push({ level: 'error', msg });
  if (!(def.duration > 0)) err('duration must be > 0');
  const shots = [...(def.shots || [])].sort((a, b) => a.t - b.t);
  if (!shots.length) err('no shots');
  let end = 0;
  shots.forEach((s, i) => {
    if (s.t > end + 1e-3) warn(`gap before shot ${s.name || i} (${end.toFixed(2)}–${s.t.toFixed(2)} s): camera holds the previous frame`);
    end = Math.max(end, s.t + s.dur);
    if (s.dur < 0.8) warn(`shot ${s.name || i} is ${s.dur}s (< 0.8 s reads as a flash)`); if (s.dur > 12) warn(`shot ${s.name || i} is ${s.dur}s (> 12 s drags; cut or move)`);
    if (!s.pos && s.subject && !actors[s.subject] && Object.keys(actors).length) err(`shot ${s.name || i}: unknown subject ${s.subject}`);
    const prev = shots[i - 1];
    if (prev && prev.subject === s.subject && prev.size === s.size && (prev.move || 'static') === (s.move || 'static') && !s.pos) warn(`jump cut: shots ${prev.name || i - 1} → ${s.name || i} have the same subject and size`);
    if (prev && prev.other && s.other && new Set([prev.subject, prev.other]).has(s.subject) && new Set([prev.subject, prev.other]).has(s.other)) {
      const sideOf = (sh) => (sh.side ?? 1) * (sh.subject === [prev.subject, prev.other].sort()[0] ? 1 : -1);
      if (sideOf(prev) !== sideOf(s)) warn(`180° rule: shots ${prev.name || i - 1} → ${s.name || i} cross the line between ${s.subject} and ${s.other}`);
    }
  });
  if (end < def.duration - 0.05) warn(`shots end at ${end.toFixed(2)}s but duration is ${def.duration}s`);
  for (const e of def.events || []) {
    if (e.t < 0 || e.t > def.duration) err(`event at ${e.t}s outside 0..${def.duration}`);
    if (e.subtitle) { const need = Math.max(1.2, e.subtitle.length / 15); const d = e.dur ?? need; if (d < need * 0.85) warn(`subtitle "${e.subtitle.slice(0, 30)}…" shows ${d}s, needs ≈${need.toFixed(1)}s (15 chars/s)`); if (e.subtitle.length > 90) warn(`subtitle longer than 90 chars: split it`); }
    if (e.actor && Object.keys(actors).length && !actors[e.actor]) err(`event for unknown actor ${e.actor}`);
  }
  return { ok: !issues.some((x) => x.level === 'error'), issues, shots: shots.length };
}

/**
 * playCinematic(app, def, { actors: { id: Actor|Object3D }, onEnd, skippable = true }) — plays it in a GameApp:
 * drives app.camera, letterbox, subtitles (app.ui), animations (Actor.anim.play), expressions, moves, fades,
 * sfx/music, and emits app events. Returns a controller { stop(), time }.
 */
export function playCinematic(app, def, { actors = {}, onEnd, skippable = true } = {}) {
  const objOf = (id) => { const a = actors[id]; return a?.model || a?.object || a; };
  const objs = Object.fromEntries(Object.keys(actors).map((k) => [k, objOf(k)]));
  const shots = [...def.shots].sort((a, b) => a.t - b.t), events = [...(def.events || [])].sort((a, b) => a.t - b.t);
  let t = 0, ei = 0, done = false; const moves = [];
  const rig = def.lighting === false ? null : cinematicLights(def.lighting || {}); if (rig) app.scene.add(rig.group);
  if (def.letterbox !== false) app.ui?.letterbox?.(true);
  app.cinematic = true;
  const ctl = { get time() { return t; }, stop: () => finish() };
  const finish = () => { if (done) return; done = true; app.cinematic = false; app.ui?.letterbox?.(false); remove?.(); if (rig) app.scene.remove(rig.group); onEnd?.(); app.events?.emit?.('cinematicEnd', def); };
  const step = (dt) => {
    if (done) return; t += dt;
    if (skippable && app.input?.pressed?.('pause')) return finish();
    while (ei < events.length && events[ei].t <= t) { fire(events[ei++]); }
    for (const m of moves) { const u = Math.min(1, (t - m.t0) / m.dur); m.obj.position.lerpVectors(m.from, m.to, u * u * (3 - 2 * u)); }
    const sh = shots.filter((s) => s.t <= t).pop() || shots[0];
    if (sh) { const c = shotCamera(sh, objs, Math.min(1, (t - sh.t) / sh.dur)); rig?.update(c, objs[sh.subject]); app.camera.position.copy(c.pos); app.camera.lookAt(c.look); if (app.camera.fov !== c.fov) { app.camera.fov = c.fov; app.camera.updateProjectionMatrix(); } }
    if (t >= def.duration) finish();
  };
  const fire = (e) => {
    const a = e.actor ? actors[e.actor] : null, o = e.actor ? objs[e.actor] : null;
    if (e.subtitle) app.ui?.subtitle?.(e.subtitle, (e.dur ?? Math.max(1.2, e.subtitle.length / 15)) * 1000, e.speaker || '');
    if (e.play && a) (a.anim || a.animator)?.play?.(e.play, { upperOnly: !!e.upperOnly });
    if (e.expression && o) o.userData?.setExpression?.(e.expression, e.weight ?? 1);
    if (e.moveTo && o) moves.push({ obj: o, from: o.position.clone(), to: new THREE.Vector3(...e.moveTo), t0: e.t, dur: e.dur ?? 1 });
    if (e.face && o) { const tgt = Array.isArray(e.face) ? new THREE.Vector3(...e.face) : objs[e.face]?.position; if (tgt) o.rotation.y = Math.atan2(tgt.x - o.position.x, tgt.z - o.position.z); }
    if (e.sfx) app.audio?.play?.(e.sfx, { pos: e.pos ? new THREE.Vector3(...e.pos) : undefined });
    if (e.music) app.audio?.playMusic?.(e.music, { intensity: e.intensity ?? 0.5 });
    if (e.fade) app.ui?.fade?.(e.fade === 'out' ? 1 : 0, (e.dur ?? 0.6) * 1000);
    if (e.event) app.events?.emit?.(e.event, e);
  };
  const remove = app.add ? app.add(step, { order: 900, states: 'all' }) : null; // after gameplay, before render
  return ctl;
}
void tmp;
