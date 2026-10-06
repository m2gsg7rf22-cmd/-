// Single-file build: the worker is inlined as a blob so the whole game is one HTML file.
import ChunkWorker from './chunk.worker.ts?worker&inline';

export function createChunkWorker(): Worker {
  return new ChunkWorker();
}
