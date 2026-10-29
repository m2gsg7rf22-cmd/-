// Borrowed Shine — GTA-like vertical slice (ORIGINAL IP) built only from the GameForge skill docs.
// Blind test of the skill: see docs/benchmarks/skill-blind-tests/gta-slice.md
export const SPEC = {
  id: 'gta-slice',
  title: 'Borrowed Shine',
  genre: 'action',
  pitch: 'Steal a councilman\'s gold coupe in broad daylight, shake the Port Solana police and decide what a favour is worth.',
  references: ['Open-world crime games (systems and feel only: on foot + driving + gunplay + wanted level)'],
  seed: 11,
  world: { type: 'city', style: 'modern', blocks: 4, maxFloors: 14, traffic: 6, timeOfDay: 12.2, dayLength: 0 },
  player: { mode: 'onfoot', combat: false, hp: 150,
    look: { archetype: 'civilian', seed: 5, sex: 1, age: 29, heightCm: 180, hair: 'short', hairColor: 0x1d140e, skin: 'olive',
      outfit: [{ type: 'tshirt', color: 0xe8e2d4 }, { type: 'jacket', color: 0x5a2a22, material: 'canvas' }, { type: 'jeans', color: 0x2c3a52 }, { type: 'sneakers', color: 0xdedede }] } },
  goal: { type: 'quests', label: 'Borrowed Shine', winTitle: 'Even', winText: 'The coupe is primer grey by sunset.' },
  music: 'tension',
  theme: { accent: '#f2b33d', accent2: '#e0603a' },
};
