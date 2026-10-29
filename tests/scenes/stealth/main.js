// Stealth — focused integration scene for the stealth kit (NOT a game).
// Night courtyard: two lamps (lit zones), a bush (hiding spot), walls; three guards (patrol,
// stand-watch, lamp post). Exercises lightProbe, suspicion states, noise distraction, takedown,
// body discovery and radio alarm. Driven by playtest.json through window.__GF.cheat.
import * as GF from '../../../engine/index.js';
const { THREE } = GF;

const app = new GF.GameApp({ id: 'stealth', title: 'Stealth', container: document.getElementById('game'), timeOfDay: 22.5, theme: { accent: '#7ad1ff' } });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80).rotateX(-Math.PI / 2), GF.pbr('cobble', { cells: 40, color: 0x6a6660 })); ground.receiveShadow = true; app.scene.add(ground);
const wallMat = GF.pbr('brick', { color: 0x6a3a2c });
function wall(x, z, w, h, d) {
  const m = new THREE.Mesh(GF.Geo.boxUV(new THREE.BoxGeometry(w, h, d), 0.5), wallMat); m.position.set(x, h / 2, z); m.castShadow = m.receiveShadow = true; app.scene.add(m);
  app.physics.addStatic({ type: 'box', x, y: h / 2, z, hx: w / 2, hy: h / 2, hz: d / 2 }, { kind: 'wall' });
}
wall(0, -12, 30, 4, 0.6); wall(-15, 0, 0.6, 4, 24); wall(15, 0, 0.6, 4, 24); wall(-5, 2, 6, 3, 0.6); wall(8, -4, 0.6, 3, 7);
// lamps: lit zones
function lamp(x, z) {
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 3.6, 8), GF.solid(0x222428, { metalness: 0.7 })); post.position.set(x, 1.8, z); app.scene.add(post);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), GF.emissive(0xffd29a, 4)); bulb.position.set(x, 3.6, z); app.scene.add(bulb);
  const l = new THREE.PointLight(0xffc98a, 16, 14, 1.6); l.position.set(x, 3.4, z); l.castShadow = false; app.scene.add(l);
}
lamp(-8, -6); lamp(9, -6);
// bush = hiding spot
const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 1), GF.solid(0x24401e, { roughness: 1 })); bush.scale.set(1.3, 0.8, 1.1); bush.position.set(-10, 0.7, 6); bush.castShadow = true; app.scene.add(bush);

const player = new GF.Player(app, { combat: false, position: new THREE.Vector3(0, 0.1, 9), facing: Math.PI, look: { seed: 4, outfit: 'street', top: 0x1a1c22, bottom: 0x16181c, hairStyle: 'short' } });
const mk = (x, z, f, seed) => new GF.NPC(app, { position: new THREE.Vector3(x, 0.1, z), facing: f, seed, lookRange: 0, look: { seed, outfit: 'soldier' } });
const gPatrol = mk(-8, -8, 0, 21), gWatch = mk(10, -9, 0, 22), gLamp = mk(6, 2, 0, 23);
const stealth = new GF.StealthSystem({ physics: app.physics, lightLevel: GF.lightProbe(app.scene, { physics: app.physics, atmosphere: app.atmosphere }), radio: 2 });
const P = stealth.addGuard(gPatrol, { route: [[-8, 0, -8], [-8, 0, -2], [2, 0, -2], [2, 0, -8]] });
const W = stealth.addGuard(gWatch, { route: [{ pos: [10, 0, -9], wait: 999, look: -0.6 }] });
const L = stealth.addGuard(gLamp, { route: [{ pos: [6, 0, 2], wait: 999, look: Math.PI }] });
stealth.addHidingSpot({ center: bush.position.clone().setY(0), radius: 1.6, factor: 0.08 });
stealth.setPlayer(player, () => ({ crouched: player.crouching, speed: player.ctrl.horizontalSpeed?.() ?? 0 }));
const debug = stealth.debugGroup(); app.scene.add(debug);
const events = { states: [], takedowns: 0, bodies: 0, alerts: 0 };
stealth.on('state', (e) => events.states.push(`${stealth.guards.indexOf(e.guard)}:${e.to}`)).on('takedown', () => events.takedowns++).on('bodyFound', () => events.bodies++).on('alert', () => events.alerts++);
app.ui.stars?.(0);
app.add((dt) => {
  if (app.state !== 'playing') return;
  player.crouching = app.input.held('crouch') || forceCrouch;
  player.control(dt);
  if (app.input.pressed('interact')) { const g = stealth.nearestTakedown(); if (g) stealth.takedown(g); }
  stealth.update(dt); debug.userData.update();
  GF.separateActors([player, gPatrol, gWatch, gLamp]);
});
let forceCrouch = false;
window.__GF.cheat = {
  teleport: (x, z, facing = 0) => { player.ctrl.teleport(new THREE.Vector3(x, 0.1, z)); player.ctrl.facing = facing; },
  crouch: (on) => { forceCrouch = on; },
  noise: (x, z, r = 12) => stealth.noise(new THREE.Vector3(x, 0, z), r, 'bottle'),
  behind: (i) => { const g = stealth.guards[i], f = g.actor.facing; player.ctrl.teleport(g.actor.position.clone().add(new THREE.Vector3(-Math.sin(f), 0.1, -Math.cos(f)))); player.ctrl.facing = f; },
  takedown: (i) => stealth.takedown(stealth.guards[i]),
};
app.debugState = () => ({
  guards: stealth.guards.map((g) => ({ state: g.state, susp: +g.suspicion.toFixed(2), x: +g.actor.position.x.toFixed(1), z: +g.actor.position.z.toFixed(1) })),
  visibility: +stealth.playerVisibility.toFixed(2), light: +stealth._light.toFixed(2), events, player: { x: +player.position.x.toFixed(1), z: +player.position.z.toFixed(1) },
});
app.start();
app.setState('playing');
app.ui.toast('Stealth', { sub: 'stealth kit test scene' });
