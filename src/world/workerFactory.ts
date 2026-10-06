/** Creates the chunk worker as a separate file (normal build: cacheable, CSP-friendly). */
export function createChunkWorker(): Worker {
  return new Worker(new URL('./chunk.worker.ts', import.meta.url), { type: 'module' });
}
