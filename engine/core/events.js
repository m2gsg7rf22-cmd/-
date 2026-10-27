// Minimal synchronous event bus with wildcard listeners and once().
export class EventBus {
  constructor() { this.map = new Map(); this.history = []; this.historyLimit = 200; }
  on(type, fn) {
    if (!this.map.has(type)) this.map.set(type, new Set());
    this.map.get(type).add(fn);
    return () => this.off(type, fn);
  }
  once(type, fn) {
    const off = this.on(type, (p) => { off(); fn(p); });
    return off;
  }
  off(type, fn) { this.map.get(type)?.delete(fn); }
  emit(type, payload) {
    this.history.push({ type, t: this.history.length });
    if (this.history.length > this.historyLimit) this.history.shift();
    for (const fn of [...(this.map.get(type) || [])]) fn(payload);
    for (const fn of [...(this.map.get('*') || [])]) fn({ type, payload });
  }
  count(type) { return this.history.filter((h) => h.type === type).length; }
}
