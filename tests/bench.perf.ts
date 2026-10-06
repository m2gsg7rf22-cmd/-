import { TerrainGenerator } from '../src/world/generator';
import { meshChunk, mergeSections } from '../src/world/mesher';
import { PAD_SIZE, WORLD_HEIGHT, CHUNK_SIZE } from '../src/core/constants';
const g = new TerrainGenerator(42);
let t = performance.now();
const chunks = new Map<string, Uint8Array>();
for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) chunks.set(x+','+z, g.generate(x, z));
console.log('gen per chunk ms', ((performance.now() - t) / 25).toFixed(2));
let tris = 0;
for (let rep = 0; rep < 4; rep++) { t = performance.now(); tris = 0;
for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) {
  const pad = new Uint8Array(PAD_SIZE*PAD_SIZE*WORLD_HEIGHT);
  for (let px = -1; px <= CHUNK_SIZE; px++) for (let pz = -1; pz <= CHUNK_SIZE; pz++) {
    const wx = x*16+px, wz = z*16+pz;
    const cx = Math.floor(wx/16), cz = Math.floor(wz/16);
    const d = chunks.get(cx+','+cz)!;
    const lx = wx - cx*16, lz = wz - cz*16;
    pad.set(d.subarray((lx*16+lz)*WORLD_HEIGHT, (lx*16+lz+1)*WORLD_HEIGHT), ((px+1)*PAD_SIZE+(pz+1))*WORLD_HEIGHT);
  }
  const m = meshChunk(pad);
  tris += mergeSections(m.opaque).indices.length/3 + mergeSections(m.transparent).indices.length/3;
}
console.log('mesh per chunk ms', ((performance.now() - t) / 9).toFixed(2), 'tris/chunk', (tris/9)|0);
}
