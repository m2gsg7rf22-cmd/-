import type { ChunkGenerator, Dim } from './dimension';
import { EmberdeepGenerator } from './emberdeep';
import { TerrainGenerator } from './generator';
import { VoidreachGenerator } from './voidreach';

export function createGenerator(dim: Dim, seed: number): ChunkGenerator {
  if (dim === 'emberdeep') return new EmberdeepGenerator(seed);
  if (dim === 'voidreach') return new VoidreachGenerator(seed);
  return new TerrainGenerator(seed);
}
