import { validateMeta, type WorldMeta } from './serialize';

export interface ChunkRecord {
  id: string; // `${world}|${cx},${cz}`
  world: string;
  key: string;
  rle: Uint8Array;
}

export interface SaveStore {
  readonly persistent: boolean;
  listWorlds(): Promise<WorldMeta[]>;
  getWorld(id: string): Promise<WorldMeta | null>;
  putWorld(meta: WorldMeta): Promise<void>;
  deleteWorld(id: string): Promise<void>;
  listChunkKeys(world: string): Promise<string[]>;
  getChunk(world: string, key: string): Promise<Uint8Array | null>;
  putChunks(world: string, chunks: { key: string; rle: Uint8Array }[]): Promise<void>;
}

const DB_NAME = 'blockforge';
const DB_VERSION = 1;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });
}

class IdbStore implements SaveStore {
  readonly persistent = true;
  constructor(private db: IDBDatabase) {}

  async listWorlds(): Promise<WorldMeta[]> {
    const tx = this.db.transaction('worlds', 'readonly');
    const all = await req(tx.objectStore('worlds').getAll());
    const out: WorldMeta[] = [];
    for (const raw of all) {
      const m = validateMeta(raw);
      if (m) out.push(m);
      else console.warn('[BlockForge] skipping corrupted world record', raw);
    }
    return out.sort((a, b) => b.lastPlayed - a.lastPlayed);
  }

  async getWorld(id: string): Promise<WorldMeta | null> {
    const tx = this.db.transaction('worlds', 'readonly');
    return validateMeta(await req(tx.objectStore('worlds').get(id)));
  }

  async putWorld(meta: WorldMeta): Promise<void> {
    const tx = this.db.transaction('worlds', 'readwrite');
    tx.objectStore('worlds').put(meta);
    await txDone(tx);
  }

  async deleteWorld(id: string): Promise<void> {
    const tx = this.db.transaction(['worlds', 'chunks'], 'readwrite');
    tx.objectStore('worlds').delete(id);
    const idx = tx.objectStore('chunks').index('world');
    const keys = await req(idx.getAllKeys(IDBKeyRange.only(id)));
    for (const k of keys) tx.objectStore('chunks').delete(k);
    await txDone(tx);
  }

  async listChunkKeys(world: string): Promise<string[]> {
    const tx = this.db.transaction('chunks', 'readonly');
    const keys = await req(tx.objectStore('chunks').index('world').getAllKeys(IDBKeyRange.only(world)));
    return keys.map((k) => String(k).slice(world.length + 1));
  }

  async getChunk(world: string, key: string): Promise<Uint8Array | null> {
    const tx = this.db.transaction('chunks', 'readonly');
    const rec = (await req(tx.objectStore('chunks').get(`${world}|${key}`))) as ChunkRecord | undefined;
    return rec && rec.rle instanceof Uint8Array ? rec.rle : null;
  }

  async putChunks(world: string, chunks: { key: string; rle: Uint8Array }[]): Promise<void> {
    if (chunks.length === 0) return;
    const tx = this.db.transaction('chunks', 'readwrite');
    const st = tx.objectStore('chunks');
    for (const c of chunks) st.put({ id: `${world}|${c.key}`, world, key: c.key, rle: c.rle } satisfies ChunkRecord);
    await txDone(tx);
  }
}

/** Non-persistent fallback when IndexedDB is unavailable (private mode, blocked storage…). */
export class MemoryStore implements SaveStore {
  readonly persistent = false;
  private worlds = new Map<string, WorldMeta>();
  private chunks = new Map<string, Map<string, Uint8Array>>();

  async listWorlds(): Promise<WorldMeta[]> {
    return [...this.worlds.values()].sort((a, b) => b.lastPlayed - a.lastPlayed);
  }
  async getWorld(id: string): Promise<WorldMeta | null> {
    return this.worlds.get(id) ?? null;
  }
  async putWorld(meta: WorldMeta): Promise<void> {
    this.worlds.set(meta.id, structuredClone(meta));
  }
  async deleteWorld(id: string): Promise<void> {
    this.worlds.delete(id);
    this.chunks.delete(id);
  }
  async listChunkKeys(world: string): Promise<string[]> {
    return [...(this.chunks.get(world)?.keys() ?? [])];
  }
  async getChunk(world: string, key: string): Promise<Uint8Array | null> {
    return this.chunks.get(world)?.get(key) ?? null;
  }
  async putChunks(world: string, chunks: { key: string; rle: Uint8Array }[]): Promise<void> {
    let m = this.chunks.get(world);
    if (!m) this.chunks.set(world, (m = new Map()));
    for (const c of chunks) m.set(c.key, c.rle.slice());
  }
}

export async function openStore(): Promise<SaveStore> {
  try {
    if (typeof indexedDB === 'undefined') throw new Error('indexedDB missing');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('worlds')) db.createObjectStore('worlds', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('chunks')) {
          const s = db.createObjectStore('chunks', { keyPath: 'id' });
          s.createIndex('world', 'world');
        }
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error('indexedDB blocked'));
      setTimeout(() => reject(new Error('indexedDB open timeout')), 4000);
    });
    return new IdbStore(db);
  } catch (e) {
    console.warn('[BlockForge] IndexedDB unavailable, worlds will not persist:', e);
    return new MemoryStore();
  }
}
