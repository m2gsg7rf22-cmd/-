import type { ChunkMeshes } from './mesher';
import type { Dim } from './dimension';

export type WorkerRequest =
  | { type: 'init'; seed: number; dim: Dim }
  | { type: 'gen'; job: number; cx: number; cz: number }
  | { type: 'mesh'; job: number; pad: Uint8Array; ao: boolean; emitters?: Int16Array };

export type WorkerResponse =
  | { type: 'gen'; job: number; cx: number; cz: number; data: Uint8Array }
  | { type: 'mesh'; job: number; meshes: ChunkMeshes }
  | { type: 'error'; job: number; message: string };
