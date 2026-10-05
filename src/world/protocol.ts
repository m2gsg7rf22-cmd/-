import type { ChunkMeshes } from './mesher';

export type WorkerRequest =
  | { type: 'init'; seed: number }
  | { type: 'gen'; job: number; cx: number; cz: number }
  | { type: 'mesh'; job: number; pad: Uint8Array; ao: boolean };

export type WorkerResponse =
  | { type: 'gen'; job: number; cx: number; cz: number; data: Uint8Array }
  | { type: 'mesh'; job: number; meshes: ChunkMeshes }
  | { type: 'error'; job: number; message: string };
