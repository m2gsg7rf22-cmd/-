// Owned by: Gameplay Engineer — rules, mechanics, win/lose, progression.
// install(game) runs after the baseline is composed and before the game starts.
// game = { app, spec, player, enemies, npcs, collectibles, vehicle, flags, quests, inventory, dialogue, progression, hf, city, groundAt, spawnEnemy, checkWin, onUpdate }
// Skyline Vigil: superhero traversal (swing / glide / double jump / air dash), four rooftop
// relays on the tallest towers, hard-landing feedback (no fall damage), HUD and test cheats.
import * as GF from '../../../engine/index.js';

const THREE = GF.THREE;
const RELAY_COLOR = 0x3ae0ff, RELAY_DONE = 0x5dff9a, RELAY_COUNT = 4;

// Roof top (world Y) of a city building: building origin sits on the sidewalk slab.
const roofY = (b) => b.position.y + (b.userData.height ?? b.userData.collider?.size?.[1] ?? 0);
// Footprint half-extents from the building collider (falls back to a small square).
const halfSize = (b) => { const s = b.userData.collider?.size; return s ? [s[0] / 2, s[2] / 2] : [4, 4]; };
// Local (building-space) XZ offset -> world XZ, respecting the building yaw.
function roofPoint(b, lx, lz) {
  const c = Math.cos(b.rotation.y), s = Math.sin(b.rotation.y);
  return new THREE.Vector3(b.position.x + lx * c + lz * s, roofY(b), b.position.z - lx * s + lz * c);
}

export function install(game) {
  const { app, player } = game;
  if (!player || game.vehicle) return;

  // ---------- Traversal ----------
  const trav = new GF.Traversal(player, { skyAnchors: false });
  game.traversal = trav;
  let wasAir = false;
  // order -1: before the composer's main update (order 0) that calls player.control(dt)
  app.add((dt) => {
    const c = player.ctrl;
    wasAir = !c.grounded; trav.update(dt);
    // Traversal clamps glide sink to -3.2 m/s, but the controller then adds one step of
    // gravity in move(), so the hero really sinks at ~-3.6 m/s. Pre-compensate so the
    // integrated sink rate is the intended -3.2 m/s.
    if (trav.gliding) c.velocity.y = Math.max(c.velocity.y, -3.2 - app.physics.gravity * c.gravityScale * dt);
  }, { order: -1 });

  // ---------- Rooftop relays ----------
  const buildings = (game.city?.buildings || []).filter((b) => b.userData?.height > 0);
  const tallest = [...buildings].sort((a, b) => roofY(b) - roofY(a));
  // spread them out: skip towers within 30 m of an already chosen one when possible
  const roofs = [];
  for (const b of tallest) { if (roofs.length >= RELAY_COUNT) break; if (roofs.every((r) => Math.hypot(r.position.x - b.position.x, r.position.z - b.position.z) > 30)) roofs.push(b); }
  for (const b of tallest) { if (roofs.length >= RELAY_COUNT) break; if (!roofs.includes(b)) roofs.push(b); }
  game.relayRoofs = roofs;
  const relays = [];
  roofs.forEach((b, i) => {
    const [hx, hz] = halfSize(b);
    // off-centre (the neon antenna sits at the roof centre), inside any setback footprint
    const spot = roofPoint(b, -hx * 0.18, hz * 0.18);
    const group = new THREE.Group(); group.name = 'relay:' + i; group.position.copy(spot);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x1a2630, emissive: RELAY_COLOR, emissiveIntensity: 2.2, roughness: 0.4, metalness: 0.6 });
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x2a3038, roughness: 0.6, metalness: 0.8 });
    const beamMat = new THREE.MeshBasicMaterial({ color: RELAY_COLOR, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.85, 0.35, 12), baseMat); plinth.position.y = 0.175; group.add(plinth);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 3.2, 8), poleMat); pole.position.set(0.55, 1.6, 0); group.add(pole);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.05, 6, 24), poleMat); ring.rotation.x = Math.PI / 2; ring.position.y = 0.4; group.add(ring);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 70, 10, 1, true), beamMat); beam.position.y = 35; beam.frustumCulled = false; group.add(beam);
    app.scene.add(group);
    const obj = GF.PROPS.pickup({ type: 'gem', color: RELAY_COLOR }); obj.scale.setScalar(2);
    const base = spot.y + 1.3; obj.position.set(spot.x, base, spot.z); app.scene.add(obj);
    const item = { id: 'relay:' + i, item: 'relay', obj, base, taken: false, roof: b, spot, beacon: { group, poleMat, beamMat }, lit: false };
    game.collectibles.push(item); relays.push(item);
    player.interactables.push({ id: item.id, position: obj.position, radius: 3, label: 'Activate relay', enabled: () => !item.taken, action: () => game.collect(item) });
  });
  game.relays = relays;
  const relayCounter = app.ui.counter('relays', { icon: '◆', label: 'Relays', corner: 'tl', value: `0/${relays.length}` });

  // ---------- Per-frame: beacon state, HUD, hard landings ----------
  app.add((dt) => {
    let done = 0;
    for (const r of relays) {
      if (r.taken) done++;
      if (r.taken && !r.lit) { // relay switched on: beacon turns green and flares
        r.lit = true; r.beacon.poleMat.emissive.setHex(RELAY_DONE); r.beacon.beamMat.color.setHex(RELAY_DONE); r.beacon.beamMat.opacity = 0.32;
        app.vfx.emit('confetti', r.spot.clone().setY(r.spot.y + 2), { count: 24, color: RELAY_DONE }); app.audio.play('powerup', { pos: r.spot });
      }
      r.beacon.beamMat.opacity = (r.lit ? 0.3 : 0.16) + Math.sin(app.loop.time * 3 + r.spot.x) * 0.04;
    }
    relayCounter.set(`${done}/${relays.length}`);
    // superhero landing: no fall damage, just a heavier impact on big drops
    const c = player.ctrl;
    if (wasAir && c.grounded && player.alive && ((c.fallDistance || 0) > 25 || (c.landSpeed || 0) > 18)) {
      if (!(player.anim.isPlaying() && player.anim.current?.name === 'land')) player.anim.play('land');
      app.vfx.emit('dust', player.position.clone(), { count: 30, scale: 2 }); app.shake(0.3);
      app.audio.play('land', { pitch: 0.8 });
    }
    wasAir = false;
  }, { order: 1 });

  // ---------- Traversal hint at game start ----------
  let hinted = false;
  app.events.on('state', ({ from, to }) => {
    if (to === 'playing' && from === 'menu' && !hinted) { hinted = true; app.ui.toast('R: swing · Space (hold, airborne): glide · Alt: air dash', { ms: 6000, sub: 'Traversal' }); }
  });

  // ---------- Test helpers ----------
  const cheat = window.__GF.cheat || (window.__GF.cheat = {});
  const face = (dir) => { const yaw = Math.atan2(-dir.x, -dir.z); player.cam.yaw = yaw; player.ctrl.facing = Math.atan2(dir.x, dir.z); };
  cheat.toRoof = (i = 0) => {
    const r = relays[i]; if (!r) return null;
    const [hx, hz] = halfSize(r.roof);
    const p = roofPoint(r.roof, -hx * 0.18 + 1.4, hz * 0.18); p.y += 0.05;
    trav.release(); player.ctrl.enabled = true; player.ctrl.teleport(p); player.ctrl.grounded = true;
    face(r.spot.clone().sub(p).setY(0).normalize());
    return p.toArray();
  };
  cheat.launch = () => {
    // hover 30 m up over the road next to the tallest tower (towers line both sides of the
    // avenue, so the swing ray search has facades to hit up-and-ahead), facing that tower
    const city = game.city, A = tallest[0];
    if (!A || !city) { const p = player.position.clone().setY(30.2); player.ctrl.teleport(p); player.ctrl.grounded = false; return p.toArray(); }
    let best = null;
    for (const rc of city.roadCenters) {
      const dx = Math.abs(A.position.x - rc), dz = Math.abs(A.position.z - rc);
      if (!best || dx < best.d) best = { d: dx, pos: new THREE.Vector3(rc, 0, A.position.z) };
      if (dz < best.d) best = { d: dz, pos: new THREE.Vector3(A.position.x, 0, rc) };
    }
    const pos = best.pos, look = A.position.clone().sub(pos).setY(0).normalize();
    pos.y = 0.2 + 30;
    trav.release(); player.ctrl.enabled = true; player.ctrl.teleport(pos); player.ctrl.grounded = false; player.ctrl.lastGroundY = pos.y;
    face(look);
    return pos.toArray();
  };

  const baseState = app.debugState;
  app.debugState = () => ({ ...baseState(), traversal: { swinging: trav.swinging, gliding: trav.gliding, swings: trav.stats.swings, dashes: trav.stats.dashes, glideTime: +trav.stats.glideTime.toFixed(2), maxHeight: +trav.stats.maxHeight.toFixed(1), vy: +player.ctrl.velocity.y.toFixed(2) }, relays: relays.filter((r) => r.taken).length });
}
