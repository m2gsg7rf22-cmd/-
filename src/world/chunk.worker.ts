/// <reference lib="webworker" />
import { TerrainGenerator } from './generator';
import { meshChunk } from './mesher';
import type { WorkerRequest, WorkerResponse } from './protocol';

let gen: TerrainGenerator | null = null;
const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'init') {
      gen = new TerrainGenerator(msg.seed);
    } else if (msg.type === 'gen') {
      if (!gen) throw new Error('worker not initialized');
      const data = gen.generate(msg.cx, msg.cz);
      const res: WorkerResponse = { type: 'gen', job: msg.job, cx: msg.cx, cz: msg.cz, data };
      ctx.postMessage(res, [data.buffer]);
    } else if (msg.type === 'mesh') {
      const meshes = meshChunk(msg.pad, msg.ao, msg.emitters);
      const res: WorkerResponse = { type: 'mesh', job: msg.job, meshes };
      const t = [...meshes.opaque, ...meshes.transparent].flatMap((m) => [m.positions.buffer, m.uvs.buffer, m.tiles.buffer, m.light.buffer, m.indices.buffer]);
      ctx.postMessage(res, t);
    }
  } catch (e) {
    const job = 'job' in msg ? msg.job : -1;
    const res: WorkerResponse = { type: 'error', job, message: e instanceof Error ? e.message : String(e) };
    ctx.postMessage(res);
  }
};
