// GameForge realistic human system (separate entry so games that don't use humans don't
// ship the 6 MB dataset). import * as Humans from './engine/humans.js'
import * as THREE from './vendor/three/three.module.js';
import { loadHumanData } from './character/human-data.js';
import { buildHuman, defaultHumanParams, EXPRESSIONS, VISEMES, listModifiers, SKIN_TONES } from './character/human.js';
import { applySkin, computeSkinMasks } from './character/skin.js';
import { addHair, addBeard, HAIR_STYLES } from './character/hair.js';
import { dress, OUTFITS, GARMENTS } from './character/clothing.js';
import { Retargeter, clipFromBVH, parseBVH, fingerCurl } from './animation/retarget.js';
export { loadHumanData, buildHuman, defaultHumanParams, EXPRESSIONS, VISEMES, listModifiers, SKIN_TONES, applySkin, addHair, addBeard, HAIR_STYLES, dress, OUTFITS, GARMENTS, Retargeter, clipFromBVH, parseBVH, fingerCurl };
export { ARCHETYPES, createCharacter, characterFromSpec } from './character/archetypes.js';

/** One call: data + body + skin + hair + clothes + retargeter. */
export async function createRealisticHuman(spec = {}) {
  const data = await loadHumanData();
  return assembleHuman(data, spec);
}
export function assembleHuman(data, spec = {}) {
  const h = buildHuman(data, spec);
  const api = h.userData;
  api.skinMasks = computeSkinMasks(api.mesh.geometry, api.bones, api.params);
  applySkin(h, { size: spec.textureSize ?? 1024, seed: spec.seed ?? 1 });
  if (spec.outfit !== null) dress(h, Array.isArray(spec.outfit) ? spec.outfit : OUTFITS[spec.outfit ?? 'casual'] || OUTFITS.casual);
  if (spec.hair !== null) addHair(h, typeof spec.hair === 'string' ? { style: spec.hair, color: spec.hairColor } : { color: spec.hairColor, ...(spec.hair || {}) });
  if (spec.beard) addBeard(h, typeof spec.beard === 'string' ? { style: spec.beard, color: spec.hairColor } : spec.beard);
  api.retargeter = new Retargeter(api.bones);
  return h;
}
export { THREE };
