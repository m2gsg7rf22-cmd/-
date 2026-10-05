/** Horizontal chunk size in blocks (X and Z). */
export const CHUNK_SIZE = 16;
/** World height in blocks (Y). Y=0 is the bottom (bedrock). */
export const WORLD_HEIGHT = 128;
export const SEA_LEVEL = 48;
export const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT;

/** Padded chunk used for meshing: 1-block border on X/Z taken from neighbors. */
export const PAD_SIZE = CHUNK_SIZE + 2;
export const PAD_VOLUME = PAD_SIZE * PAD_SIZE * WORLD_HEIGHT;

/** Length of a full day/night cycle in seconds. */
export const DAY_LENGTH = 20 * 60;

export const PLAYER_WIDTH = 0.6;
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_EYE = 1.62;
export const REACH = 5;
