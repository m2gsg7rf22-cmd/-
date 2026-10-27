// Versioned save slots backed by localStorage with an in-memory fallback (private
// windows, Node tests). Systems register serializers; save() collects them all.
export class SaveSystem {
  constructor(gameId, { version = 1, storage } = {}) {
    this.gameId = gameId;
    this.version = version;
    this.providers = new Map();
    this.memory = new Map();
    this.storage = storage !== undefined ? storage : (() => { try { return globalThis.localStorage || null; } catch { return null; } })();
    this.migrations = {}; // fromVersion -> fn(data) => data
  }
  register(key, { save, load }) { this.providers.set(key, { save, load }); }
  _key(slot) { return `gameforge:${this.gameId}:${slot}`; }
  _write(k, v) { try { if (this.storage) { this.storage.setItem(k, v); return; } } catch { /* quota/blocked */ } this.memory.set(k, v); }
  _read(k) { try { if (this.storage) { const v = this.storage.getItem(k); if (v !== null) return v; } } catch { /* blocked */ } return this.memory.get(k) ?? null; }
  snapshot() {
    const data = {};
    for (const [k, p] of this.providers) data[k] = p.save();
    return { version: this.version, savedAt: Date.now(), data };
  }
  save(slot = 'auto', meta = {}) {
    const snap = { ...this.snapshot(), meta };
    this._write(this._key(slot), JSON.stringify(snap));
    return snap;
  }
  has(slot = 'auto') { return this._read(this._key(slot)) !== null; }
  peek(slot = 'auto') { const raw = this._read(this._key(slot)); return raw ? JSON.parse(raw) : null; }
  load(slot = 'auto') {
    let snap = this.peek(slot);
    if (!snap) return false;
    while (snap.version < this.version && this.migrations[snap.version]) {
      snap = { ...snap, data: this.migrations[snap.version](snap.data), version: snap.version + 1 };
    }
    for (const [k, p] of this.providers) if (k in snap.data) p.load(snap.data[k]);
    return true;
  }
  delete(slot = 'auto') {
    try { this.storage?.removeItem(this._key(slot)); } catch { /* ignore */ }
    this.memory.delete(this._key(slot));
  }
}
