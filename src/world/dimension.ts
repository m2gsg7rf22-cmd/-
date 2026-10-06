/** The three dimensions of a BlockForge world. */
export type Dim = 'overworld' | 'emberdeep' | 'voidreach';
export const DIMS: readonly Dim[] = ['overworld', 'emberdeep', 'voidreach'];

export const DIM_NAMES: Record<Dim, string> = {
  overworld: 'Overworld',
  emberdeep: 'Emberdeep',
  voidreach: 'Voidreach',
};

export function isDim(v: unknown): v is Dim {
  return v === 'overworld' || v === 'emberdeep' || v === 'voidreach';
}

/** Chunk storage id for a dimension of a world (the overworld keeps the plain world id for old saves). */
export function dimWorldId(worldId: string, dim: Dim): string {
  return dim === 'overworld' ? worldId : `${worldId}#${dim}`;
}

/** Overworld ↔ Emberdeep coordinate scale (one Emberdeep block spans 8 overworld blocks). */
export const EMBER_SCALE = 8;

/** Emberdeep layout. */
export const EMBER_MAGMA_LEVEL = 32;
export const EMBER_ROOF = 116;

/** Common interface of the per-dimension terrain generators (pure functions of the seed). */
export interface ChunkGenerator {
  readonly seed: number;
  generate(cx: number, cz: number): Uint8Array;
  /** A spawn column for a fresh arrival with no other information. */
  findSpawn(): { x: number; y: number; z: number };
  /** Short location description for the debug overlay. */
  describe(x: number, z: number): string;
}
