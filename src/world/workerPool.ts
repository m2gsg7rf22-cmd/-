import type { ChunkGenerator, Dim } from './dimension';
import { createGenerator } from './generators';
import { meshChunk, type ChunkMeshes } from './mesher';
import type { WorkerRequest, WorkerResponse } from './protocol';
import { createChunkWorker } from './workerFactory';

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  req: WorkerRequest;
  worker: number;
}

/**
 * Pool of chunk workers (generation + meshing). If workers can't be created or crash,
 * it transparently falls back to running the same code on the main thread.
 */
export class WorkerPool {
  private workers: Worker[] = [];
  private load: number[] = [];
  private pending = new Map<number, Pending>();
  private nextJob = 1;
  private fallbackGen: ChunkGenerator | null = null;
  private seed: number;
  fallback = false;
  readonly size: number;

  constructor(seed: number, private dim: Dim, size: number) {
    this.seed = seed;
    this.size = size;
    try {
      for (let i = 0; i < size; i++) {
        const w = createChunkWorker();
        w.onmessage = (ev: MessageEvent<WorkerResponse>) => this.onMessage(i, ev.data);
        w.onerror = (ev) => {
          console.error('[BlockForge] chunk worker crashed; switching to main-thread fallback', ev.message);
          ev.preventDefault();
          this.enterFallback();
        };
        w.postMessage({ type: 'init', seed, dim } satisfies WorkerRequest);
        this.workers.push(w);
        this.load.push(0);
      }
    } catch (e) {
      console.warn('[BlockForge] Web Workers unavailable, using main-thread generation', e);
      this.enterFallback();
    }
  }

  /** Number of jobs currently in flight. */
  get inFlight(): number {
    return this.pending.size;
  }

  /** Max jobs to keep in flight. */
  get capacity(): number {
    return this.fallback ? 1 : this.workers.length * 4;
  }

  private enterFallback(): void {
    if (this.fallback) return;
    this.fallback = true;
    for (const w of this.workers) w.terminate();
    this.workers = [];
    const jobs = [...this.pending.entries()];
    this.pending.clear();
    for (const [, p] of jobs) {
      try {
        p.resolve(this.runSync(p.req));
      } catch (e) {
        p.reject(e as Error);
      }
    }
  }

  private runSync(req: WorkerRequest): unknown {
    if (req.type === 'gen') {
      if (!this.fallbackGen) this.fallbackGen = createGenerator(this.dim, this.seed);
      return this.fallbackGen.generate(req.cx, req.cz);
    }
    if (req.type === 'mesh') return meshChunk(req.pad, req.ao, req.emitters);
    return null;
  }

  private onMessage(worker: number, msg: WorkerResponse): void {
    const p = this.pending.get(msg.job);
    if (!p) return;
    this.pending.delete(msg.job);
    this.load[worker] = Math.max(0, this.load[worker] - 1);
    if (msg.type === 'error') p.reject(new Error(`worker job failed: ${msg.message}`));
    else if (msg.type === 'gen') p.resolve(msg.data);
    else p.resolve(msg.meshes);
  }

  private submit<T>(req: WorkerRequest, transfer: Transferable[] = []): Promise<T> {
    if (this.fallback) {
      return new Promise<T>((resolve, reject) => {
        // Defer so the caller's frame isn't blocked by a burst of jobs.
        setTimeout(() => {
          try {
            resolve(this.runSync(req) as T);
          } catch (e) {
            reject(e as Error);
          }
        }, 0);
      });
    }
    let best = 0;
    for (let i = 1; i < this.load.length; i++) if (this.load[i] < this.load[best]) best = i;
    this.load[best]++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set((req as { job: number }).job, { resolve: resolve as (v: unknown) => void, reject, req, worker: best });
      this.workers[best].postMessage(req, transfer);
    });
  }

  generate(cx: number, cz: number): Promise<Uint8Array> {
    return this.submit<Uint8Array>({ type: 'gen', job: this.nextJob++, cx, cz });
  }

  mesh(pad: Uint8Array, ao: boolean, emitters?: Int16Array): Promise<ChunkMeshes> {
    // In fallback mode the pad must stay valid; otherwise transfer it.
    const transfer = this.fallback ? [] : [pad.buffer];
    return this.submit<ChunkMeshes>({ type: 'mesh', job: this.nextJob++, pad, ao, emitters }, transfer);
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    for (const p of this.pending.values()) p.reject(new Error('pool disposed'));
    this.pending.clear();
  }
}
