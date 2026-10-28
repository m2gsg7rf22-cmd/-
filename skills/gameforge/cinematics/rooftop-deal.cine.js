// Example cinematic: two characters meet on a rooftop at dusk; a tense exchange, a reveal, a walk-off.
// Film grammar: establish (wide) → two-shot → over-the-shoulder pair on ONE side of the line (180°)
// → close-up reaction → cutaway insert → wide exit. Subtitles timed at ~15 chars/s.
export const env = { timeOfDay: 18.4, sunAzimuth: 250 };
export default async function build({ K, H, humanData, THREE }) {
  const set = new THREE.Group();
  const roof = K.mesh(K.roundedBox(16, 0.4, 12, 0.05, 1), K.pbr('concrete', { repeat: 4 })); roof.position.y = -0.2; set.add(roof);
  for (const [x, z, w, d] of [[0, -6, 16, 0.3], [-8, 0, 0.3, 12], [8, 0, 0.3, 12]]) { const p = K.mesh(K.roundedBox(w, 1, d, 0.03, 1), K.pbr('concrete', { color: 0x8a8a86 })); p.position.set(x, 0.5, z); set.add(p); }
  const unit = K.mesh(K.roundedBox(2, 1.4, 1.4, 0.05, 2), K.pbr('paintedMetal', { color: 0x6a7076 })); unit.position.set(-5, 0.7, -3.5); set.add(unit);
  const vex = H.assembleHuman(humanData, { ...H.characterFromSpec('businessperson', 12), textureSize: 512 }); vex.position.set(-1.2, 0, 0.5);
  const kai = H.assembleHuman(humanData, { ...H.characterFromSpec('biker', 7), textureSize: 512 }); kai.position.set(1.4, 0, -0.4);
  vex.rotation.y = Math.atan2(kai.position.x - vex.position.x, kai.position.z - vex.position.z);
  kai.rotation.y = Math.atan2(vex.position.x - kai.position.x, vex.position.z - kai.position.z);
  const cinematic = {
    duration: 19, letterbox: true,
    shots: [
      { name: 'establish', t: 0, dur: 3.5, size: 'extremeWide', subject: 'vex', side: 1, move: 'crane', amount: 1.2 },
      { name: 'two-shot', t: 3.5, dur: 3, size: 'twoShot', subject: 'vex', other: 'kai', side: 1 },
      { name: 'ots-on-vex', t: 6.5, dur: 3.5, size: 'overShoulder', subject: 'vex', other: 'kai', side: 1 },
      { name: 'ots-on-kai', t: 10, dur: 3.5, size: 'overShoulder', subject: 'kai', other: 'vex', side: -1 },
      { name: 'kai-closeup', t: 13.5, dur: 2.5, size: 'closeup', subject: 'kai', side: 1, move: 'dollyIn', amount: 0.15 },
      { name: 'exit-wide', t: 16, dur: 3, size: 'wide', subject: 'vex', side: -1, move: 'truck', amount: 0.8 },
    ],
    events: [
      { t: 0, fade: 'in', dur: 1 }, { t: 0, music: 'tension', intensity: 0.4 },
      { t: 4, subtitle: 'You came alone. Smart.', speaker: 'Vex', dur: 2.2 },
      { t: 6.8, subtitle: 'The ledger stays with me until I see the money.', speaker: 'Kai', dur: 3.2 },
      { t: 10.2, actor: 'vex', expression: 'smile', weight: 0.6 },
      { t: 10.3, subtitle: 'There is no money. There never was.', speaker: 'Vex', dur: 2.6 },
      { t: 13.6, actor: 'kai', expression: 'angry' },
      { t: 13.8, subtitle: '…Then we have a problem.', speaker: 'Kai', dur: 2 },
      { t: 16.2, actor: 'vex', face: [-6, 0, 4] }, { t: 16.2, actor: 'vex', moveTo: [-5, 0, 3.5], dur: 2.6 },
      { t: 18, fade: 'out', dur: 1 },
    ],
  };
  return { set, actors: { vex, kai }, cinematic };
}
