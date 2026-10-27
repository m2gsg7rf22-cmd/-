// Integration entry (owned by the Integration Engineer). Composes the baseline game from
// the spec, then lets each specialist module extend it. Keep this file small.
import { composeGame } from '../../engine/index.js';
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

export const game = composeGame(SPEC, { modules: [graphics, world, assets, physics, animation, story, ai, gameplay, audio, hud] });
