// Character archetypes: structured specs -> believable original humanoids.
// Each archetype is a distribution (ranges + choices) sampled by seed, so a game can create
// crowds of distinct civilians, soldiers, knights, heroes, etc. from one line.
import { RNG } from '../core/rng.js';

const R = (a, b) => ({ range: [a, b] });
export const ARCHETYPES = {
  civilian: { sex: [0, 1], age: R(19, 70), muscle: R(0.3, 0.6), weight: R(0.25, 0.75), outfit: ['casual', 'street', 'business', 'dress'], hair: ['short', 'medium', 'bob', 'long', 'ponytail', 'bun', 'crop', 'curly'] },
  businessperson: { sex: [0, 1], age: R(26, 60), muscle: R(0.35, 0.55), weight: R(0.3, 0.6), outfit: ['business'], hair: ['short', 'slick', 'bob', 'bun'] },
  soldier: { sex: [0, 1, 1], age: R(20, 40), muscle: R(0.6, 0.9), weight: R(0.4, 0.6), outfit: ['soldier'], hair: ['buzz', 'crop'] },
  knight: { sex: [0, 1, 1], age: R(22, 50), muscle: R(0.65, 0.95), weight: R(0.45, 0.65), outfit: ['knight'], hair: ['short', 'medium', 'crop'], beard: [null, 'beard', 'stubble'] },
  superhero: { sex: [0, 1], age: R(22, 38), muscle: R(0.75, 1), weight: R(0.35, 0.5), height: true, proportions: R(0.9, 1), outfit: ['superhero'], hair: ['short', 'slick', 'ponytail', 'crop'] },
  villager: { sex: [0, 1], age: R(18, 75), muscle: R(0.4, 0.7), weight: R(0.3, 0.7), outfit: ['villager'], hair: ['short', 'medium', 'bun', 'long', 'braid'], beard: [null, null, 'beard'] },
  wizard: { sex: [0, 1], age: R(45, 85), muscle: R(0.2, 0.45), weight: R(0.3, 0.6), outfit: ['wizard'], hair: ['long', 'medium', 'bald'], beard: [null, 'full', 'beard'] },
  athlete: { sex: [0, 1], age: R(18, 30), muscle: R(0.7, 0.95), weight: R(0.3, 0.45), outfit: ['athlete'], hair: ['ponytail', 'buzz', 'crop', 'bun'] },
  biker: { sex: [0, 1, 1], age: R(25, 55), muscle: R(0.55, 0.85), weight: R(0.45, 0.8), outfit: ['biker'], hair: ['short', 'mohawk', 'long', 'buzz'], beard: [null, 'beard', 'goatee'] },
};
const HAIR_COLORS = [0x1a1210, 0x2a1a10, 0x4a2a16, 0x6a4022, 0x9a6a3a, 0xc8a060, 0xd8c090, 0x8a3a1a];
const EYE_COLORS = [0x3a2a1a, 0x5a3a20, 0x2a5a8a, 0x3a6a4a, 0x6a6a5a];

export function characterFromSpec(archetype = 'civilian', seed = 1, overrides = {}) {
  const a = ARCHETYPES[archetype] || ARCHETYPES.civilian, rng = new RNG(seed * 9973 + archetype.length);
  const pick = (v) => (Array.isArray(v) ? rng.pick(v) : v && v.range ? rng.range(...v.range) : v);
  const sexRaw = pick(a.sex); const sex = typeof sexRaw === 'number' ? (sexRaw > 0.5 ? rng.range(0.8, 1) : rng.range(0, 0.2)) : 0.5;
  const eth = [rng.next(), rng.next(), rng.next()].map((x) => x * x); const t = eth[0] + eth[1] + eth[2];
  const age = pick(a.age);
  const hairColor = age > 60 && rng.chance(0.7) ? rng.pick([0x9a9a9a, 0xc8c8c8, 0x6a6a6a]) : rng.pick(HAIR_COLORS);
  let outfit = pick(a.outfit); if (outfit === 'dress' && sex > 0.5) outfit = 'casual';
  const hair = pick(a.hair);
  return {
    seed, sex, age, muscle: pick(a.muscle), weight: pick(a.weight), heightCm: (sex > 0.5 ? 176 : 163) + rng.gaussian(0, 6.5) + (a.height ? 6 : 0) - Math.max(0, age - 60) * 0.15, proportions: a.proportions ? pick(a.proportions) : rng.range(0.55, 0.95),
    ethnicity: { african: eth[0] / t, asian: eth[1] / t, caucasian: eth[2] / t },
    face: { 'nose/nose-scale-horiz': rng.range(-0.4, 0.4), 'nose/nose-scale-vert': rng.range(-0.3, 0.3), 'chin/chin-prominent': rng.range(-0.4, 0.5), 'mouth/mouth-scale-horiz': rng.range(-0.3, 0.3), 'eyes/r-eye-size': 0, 'head/head-oval': rng.range(-0.3, 0.3), 'cheek/l-cheek-bones': 0 },
    outfit, hair: sex > 0.5 && ['bob', 'bun', 'long', 'ponytail', 'braid'].includes(hair) && rng.chance(0.6) ? 'short' : hair, hairColor,
    beard: sex > 0.5 && a.beard ? pick(a.beard) : null, eyes: { color: rng.pick(EYE_COLORS) },
    ...overrides,
  };
}
// createCharacter(Humans, 'knight', seed, overrides) -> THREE.Group (requires loaded data)
export function createCharacter(assemble, data, archetype, seed, overrides) { return assemble(data, characterFromSpec(archetype, seed, overrides)); }
