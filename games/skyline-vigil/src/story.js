// Owned by: Narrative Director — extra dialogue, quests, cutscenes.
// install(game) runs after the baseline is composed and before the game starts.
// game = { app, spec, player, enemies, npcs, collectibles, vehicle, flags, quests, inventory, dialogue, progression, hf, city, groundAt, spawnEnemy, checkWin, onUpdate }
// Engine API: import * as GF from '../../../engine/index.js'
import * as GF from '../../../engine/index.js';

const { THREE } = GF;

// Dispatcher Rae: the hero's voice on the radio. First talk briefs the hero and starts
// both quests on every path; later talks route on quest flags to progress lines.
export const RAE_DIALOGUE = `
# start
@if: briefed
@else: intro
-> check_streets
# check_streets
@if: quest:streets:complete
@else: check_relays
-> check_both
# check_both
@if: quest:beacons:complete
@else: streets_done
-> thanks
# check_relays
@if: quest:beacons:complete
@else: status
-> relays_done
# intro
Dispatcher Rae: Vigil. Finally. You're on my channel and the night shift just went sideways — I'm starting you on two calls, both live.
@do: start streets; start beacons; set briefed
> Who's causing trouble? -> brief
> Skip the speech, Rae. -> sendoff
# brief
Dispatcher Rae: Three crews — the Static Kings, the Hollow Saints and some outfit calling itself Low Tide — are squatting on intersections downtown. Nine heads, give or take. Meanwhile someone cut the rooftop relays, so half the city can't call for help. Four relays, all on rooftops — get up high and wake them up.
-> sendoff
# sendoff
Dispatcher Rae: Streets and skyline, Vigil. I'll keep the coffee hot and the channel open. Go.
-> end
# status
Dispatcher Rae: Board's still red. The gangs are rattled but not done, and the relays are still dark in places.
> Any advice? -> advice
> Back to it. -> end
# advice
Dispatcher Rae: Crews fight in packs, so don't let them box you in on the asphalt. Relays sit on the tallest roofs. If you can see the whole avenue from where you're standing, you're close.
-> end
# streets_done
Dispatcher Rae: Street cams are clean — not one crew left on the corners. Nice work. Now get those last relays lit so people can actually call us.
-> end
# relays_done
Dispatcher Rae: Every relay is singing on my board. The city can hear us again. Only thing left is the gangs still holding corners — go remind them whose night this is.
-> end
# thanks
Dispatcher Rae: Streets quiet, relays green, no new calls in the queue. I've worked this desk eleven years and I've never seen the board this calm. Thank you, Vigil. Get some sleep — on a rooftop, probably.
-> end
`;

export function install(game) {
  const { app, player, dialogue, quests, flags } = game;
  const rae = game.npcs?.rae;

  // ---------- Dialogue ----------
  dialogue.define('rae', RAE_DIALOGUE);

  // ---------- Place Rae ~4 m in front of the spawn, facing the hero ----------
  if (rae && player) {
    const p = player.position, yaw = player.ctrl?.facing ?? Math.PI;
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), right = new THREE.Vector3(fwd.z, 0, -fwd.x);
    // slightly off-axis so walking straight ahead from spawn doesn't bump into her
    const pos = p.clone().addScaledVector(fwd, 4).addScaledVector(right, 1.5);
    pos.y = (game.groundAt ? game.groundAt(pos.x, pos.z) : p.y) + 0.3;
    rae.ctrl.teleport(pos);
    rae.home = pos.clone();
    const face = Math.atan2(p.x - pos.x, p.z - pos.z);
    rae.ctrl.facing = face; rae.model.rotation.y = face;
    rae.setMarker?.('!');
  }
  app.events.on('dialogue:end', ({ id }) => { if (id === 'rae' && flags.test('briefed')) rae?.setMarker?.(null); });

  // ---------- Radio lines + epilogue ----------
  const ids = ['streets', 'beacons'];
  app.events.on('quest:complete', ({ id }) => {
    if (!ids.includes(id)) return;
    if (ids.every((q) => quests.status(q) === 'complete')) {
      app.ui.subtitle('That\'s everything, Vigil. Downtown is ours again — the whole city can breathe tonight.', 4500, 'Dispatcher Rae');
      app.ui.toast('Downtown is quiet', { big: true, sub: 'Epilogue' });
    } else if (id === 'streets') {
      app.ui.subtitle('Corners are clear. Now light up those relays.', 3500, 'Dispatcher Rae');
    } else {
      app.ui.subtitle('Relays are green across the board. Go break up those crews.', 3500, 'Dispatcher Rae');
    }
  });

  // ---------- Intro cinematic ----------
  const isTest = typeof location !== 'undefined' && String(location.search || '').includes('test=1');
  if (isTest) return;
  const cine = new GF.CinematicCamera(app.camera);
  let introPlayed = false, introDone = true;
  const finishIntro = () => {
    if (introDone) return;
    introDone = true; cine.stop();
    app.ui.letterbox(false);
    if (app.state === 'cutscene') app.setState('playing');
    app.ui.toast('Skyline Vigil', { big: true, sub: 'Night One' });
  };
  const playIntro = () => {
    if (app.state !== 'playing') return;
    introDone = false;
    app.setState('cutscene'); app.ui.letterbox(true);
    const p = player.position.clone(), yaw = player.ctrl?.facing ?? Math.PI;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const ahead = [p.x + fx * 4, p.y + 1.4, p.z + fz * 4];
    cine.play([
      { t: 0, pos: [p.x + 70, 95, p.z + 90], look: [p.x, 20, p.z], fov: 55 },
      { t: 3.5, pos: [p.x + 35, 55, p.z + 40], look: [p.x, 8, p.z], fov: 52 },
      { t: 6.5, pos: [p.x - fx * 12 + 6, p.y + 9, p.z - fz * 12 + 6], look: [p.x, p.y + 1.5, p.z], fov: 55 },
      { t: 9, pos: [p.x - fx * 5, p.y + 2.6, p.z - fz * 5], look: ahead, fov: 60 },
    ], finishIntro);
    const line = (t, text, ms, who = '') => app.after(t, () => { if (!introDone) app.ui.subtitle(text, ms, who); });
    line(0.6, 'Midnight over downtown. The neon never sleeps — and tonight, neither do the gangs.', 3200);
    line(4.0, 'Vigil, you\'re live. Three crews on the streets, relays dark on the rooftops.', 2800, 'Dispatcher Rae');
    line(7.0, 'I\'m right below you. Come find me for the brief.', 2200, 'Dispatcher Rae');
  };
  app.events.on('state', ({ from, to }) => {
    if (introPlayed || from !== 'menu' || to !== 'playing') return;
    introPlayed = true;
    app.after(0, playIntro); // defer: let start() and other 'state' listeners finish first
  });
  app.add((dt) => {
    if (introDone) return;
    cine.update(dt);
    if (app.input.pressed('confirm') || app.input.pressed('interact')) finishIntro();
  }, { states: ['cutscene'] });
}
