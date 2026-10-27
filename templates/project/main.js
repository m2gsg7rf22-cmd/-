// Integration entry (owned by the Integration Engineer). Composes the baseline game from
// the spec, then lets each specialist module extend it. Keep this file small.
import { composeGame } from './engine/index.js';
// Realistic parametric humans (MakeHuman CC0 data, ~6 MB). Set SPEC.characters = 'stylized'
// and delete this import + loadHumanData() to ship the lightweight mannequin instead.
import * as Humans from './engine/humans.js';
import { SPEC } from './game.spec.js';
import * as world from './src/world.js';
import * as assets from './src/assets.js';
import * as story from './src/story.js';
import * as gameplay from './src/gameplay.js';
import * as ai from './src/ai.js';
import * as audio from './src/audio.js';
import * as hud from './src/hud.js';
import * as animation from './src/animation.js';
import * as graphics from './src/graphics.js';
import * as physics from './src/physics.js';

const modules = [graphics, world, assets, physics, animation, story, ai, gameplay, audio, hud];
export const ready = (SPEC.characters === 'stylized' ? Promise.resolve(null) : Humans.loadHumanData())
  .then((data) => composeGame(SPEC, { modules, humans: data && { H: Humans, data } }));
