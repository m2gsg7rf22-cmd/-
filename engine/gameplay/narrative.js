// Narrative systems: flags/variables, quest graph with typed objectives, branching
// dialogue (data or a compact text script), and a mission timeline helper.
// All state is plain JSON for saving.

export class Flags {
  constructor() { this.v = {}; this.onChange = null; }
  get(k, d = undefined) { return k in this.v ? this.v[k] : d; }
  set(k, val = true) { const prev = this.v[k]; this.v[k] = val; if (prev !== val) this.onChange?.(k, val, prev); }
  inc(k, n = 1) { this.set(k, (this.v[k] || 0) + n); return this.v[k]; }
  // Evaluate a condition: string flag name, '!flag', 'var>=3', function, or array (AND).
  test(cond) {
    if (cond === undefined || cond === null) return true;
    if (Array.isArray(cond)) return cond.every((c) => this.test(c));
    if (typeof cond === 'function') return !!cond(this);
    const m = String(cond).trim().match(/^(!?)([\w.:-]+)\s*(>=|<=|==|!=|>|<)?\s*(.*)$/);
    if (!m) return false;
    const [, neg, key, op, rhs] = m;
    let r;
    if (!op) r = !!this.get(key);
    else { const a = this.get(key, 0), b = isNaN(+rhs) ? rhs : +rhs; r = { '>=': a >= b, '<=': a <= b, '==': a == b, '!=': a != b, '>': a > b, '<': a < b }[op]; } // eslint-disable-line eqeqeq
    return neg ? !r : r;
  }
  toJSON() { return { ...this.v }; }
  load(d) { this.v = { ...d }; }
}

// Quest definition:
// { id, title, description, giver, objectives: [{ id, type: 'talk'|'reach'|'collect'|'kill'|'flag'|'custom', target, count, text, optional, hidden }],
//   requires: cond, rewards: { xp, money, items: {id: n}, flags: {k: v} }, next: 'questId', onComplete }
export class QuestSystem {
  constructor(flags, events = null) { this.flags = flags; this.events = events; this.defs = {}; this.state = {}; this.tracked = null; this.onUpdate = null; }
  define(...quests) { for (const q of quests.flat()) this.defs[q.id] = q; return this; }
  status(id) { return this.state[id]?.status || 'inactive'; }
  available(id) { const q = this.defs[id]; return q && this.status(id) === 'inactive' && this.flags.test(q.requires); }
  start(id) {
    const q = this.defs[id]; if (!q) throw new Error('unknown quest ' + id);
    if (this.status(id) !== 'inactive') return false;
    this.state[id] = { status: 'active', progress: Object.fromEntries(q.objectives.map((o) => [o.id, 0])), done: {} };
    if (!this.tracked) this.tracked = id;
    this.flags.set('quest:' + id, 'active');
    this._emit('quest:start', { id, quest: q });
    this._checkFlags(id);
    return true;
  }
  activeQuests() { return Object.keys(this.state).filter((id) => this.state[id].status === 'active').map((id) => this.defs[id]); }
  completed() { return Object.keys(this.state).filter((id) => this.state[id].status === 'complete'); }
  // Report a world event; advances matching objectives of all active quests.
  report(type, target, amount = 1) {
    let changed = false;
    for (const q of this.activeQuests()) {
      const st = this.state[q.id];
      for (const o of this.currentObjectives(q.id)) {
        if (o.type !== type || (o.target && o.target !== target && !(Array.isArray(o.target) && o.target.includes(target)))) continue;
        if (st.done[o.id]) continue;
        st.progress[o.id] = Math.min(o.count || 1, st.progress[o.id] + amount);
        if (st.progress[o.id] >= (o.count || 1)) { st.done[o.id] = true; this._emit('objective:complete', { quest: q.id, objective: o }); }
        changed = true;
      }
      if (changed) this._tryComplete(q.id);
    }
    if (changed) this.onUpdate?.();
    return changed;
  }
  _checkFlags(id) { const q = this.defs[id]; for (const o of q.objectives) if (o.type === 'flag' && this.flags.test(o.target)) this.report('flag', o.target); }
  onFlag() { for (const q of this.activeQuests()) this._checkFlags(q.id); }
  // Sequential objectives: an objective with `after: [ids]` is visible only after those complete.
  currentObjectives(id) {
    const q = this.defs[id], st = this.state[id]; if (!st) return [];
    return q.objectives.filter((o) => !o.after || o.after.every((a) => st.done[a]));
  }
  objectiveText(id) {
    const q = this.defs[id], st = this.state[id]; if (!q || !st) return [];
    return this.currentObjectives(id).filter((o) => !o.hidden).map((o) => ({ id: o.id, text: o.text + ((o.count || 1) > 1 ? ` (${st.progress[o.id]}/${o.count})` : ''), done: !!st.done[o.id], optional: !!o.optional, marker: o.marker }));
  }
  _tryComplete(id) {
    const q = this.defs[id], st = this.state[id];
    if (q.objectives.every((o) => o.optional || st.done[o.id])) this.complete(id);
  }
  complete(id) {
    const q = this.defs[id]; const st = this.state[id] || (this.state[id] = { progress: {}, done: {} });
    if (st.status === 'complete') return;
    st.status = 'complete';
    if (q.rewards?.flags) for (const [k, v] of Object.entries(q.rewards.flags)) this.flags.set(k, v);
    this.flags.set('quest:' + id + ':complete', true);
    this.flags.set('quest:' + id, 'complete');
    if (this.tracked === id) this.tracked = this.activeQuests()[0]?.id || null;
    this._emit('quest:complete', { id, quest: q, rewards: q.rewards || {} });
    q.onComplete?.();
    if (q.next && this.available(q.next)) this.start(q.next);
    this.onUpdate?.();
  }
  fail(id) { if (this.state[id]) { this.state[id].status = 'failed'; this._emit('quest:fail', { id }); this.onUpdate?.(); } }
  _emit(t, p) { this.events?.emit(t, p); }
  toJSON() { return { state: this.state, tracked: this.tracked }; }
  load(d) { this.state = JSON.parse(JSON.stringify(d.state)); this.tracked = d.tracked; }
}

// Dialogue graph: { start: 'nodeId', nodes: { id: { speaker, text, next?, choices?: [{ text, next, if?, do? }], do?, if? } } }
// `do` actions: strings like 'set flag', 'set var=3', 'inc var', 'start quest_id', 'complete quest_id', 'give item [n]', 'take item [n]', 'emit event'
export class DialogueSystem {
  constructor({ flags, quests = null, inventory = null, events = null } = {}) { this.flags = flags; this.quests = quests; this.inventory = inventory; this.events = events; this.dialogues = {}; this.active = null; this.history = []; }
  define(id, graph) { this.dialogues[id] = typeof graph === 'string' ? parseDialogue(graph) : graph; return this; }
  start(id, context = {}) {
    const d = this.dialogues[id]; if (!d) throw new Error('unknown dialogue ' + id);
    const startId = Array.isArray(d.start) ? (d.start.find((s) => this.flags.test(s.if))?.node ?? d.start[d.start.length - 1].node) : d.start;
    this.active = { id, graph: d, node: null, context };
    this.events?.emit('dialogue:start', { id });
    this.goto(startId);
    return this.current();
  }
  goto(nodeId) {
    if (!this.active) return null;
    if (!nodeId || nodeId === 'end') { return this.end(); }
    const node = this.active.graph.nodes[nodeId];
    if (!node) { console.warn('missing dialogue node', nodeId); return this.end(); }
    if (node.if && !this.flags.test(node.if)) return this.goto(node.else || node.next);
    if (!node.text && !node.choices?.length && node.next) { for (const a of [].concat(node.do || [])) this.run(a); return this.goto(node.next); } // router node
    this.active.node = nodeId;
    this.history.push({ dialogue: this.active.id, node: nodeId, speaker: node.speaker, text: node.text });
    this.flags.set(`seen:${this.active.id}:${nodeId}`, true);
    for (const a of [].concat(node.do || [])) this.run(a);
    this.events?.emit('dialogue:line', { id: this.active.id, node: nodeId, speaker: node.speaker, text: node.text });
    return this.current();
  }
  current() {
    if (!this.active || !this.active.node) return null;
    const n = this.active.graph.nodes[this.active.node];
    const interp = (t) => (t || '').replace(/\{([\w.:-]+)\}/g, (_, k) => String(this.flags.get(k, 0)));
    return { speaker: n.speaker, text: interp(n.text), choices: (n.choices || []).map((c, i) => ({ ...c, index: i })).filter((c) => this.flags.test(c.if)), node: this.active.node, mood: n.mood, anim: n.anim };
  }
  // Advance: with choice index for choice nodes, without for linear nodes.
  advance(choice = null) {
    const cur = this.current(); if (!cur) return null;
    const node = this.active.graph.nodes[this.active.node];
    if (cur.choices.length) {
      const c = choice === null ? null : cur.choices.find((x) => x.index === choice) || cur.choices[choice];
      if (!c) return cur;
      for (const a of [].concat(c.do || [])) this.run(a);
      this.events?.emit('dialogue:choice', { id: this.active.id, choice: c.text });
      return this.goto(c.next);
    }
    return this.goto(node.next);
  }
  end() { if (this.active) this.events?.emit('dialogue:end', { id: this.active.id }); this.active = null; return null; }
  run(action) {
    if (typeof action === 'function') return action(this);
    const [cmd, ...rest] = action.trim().split(/\s+/); const arg = rest.join(' ');
    switch (cmd) {
      case 'set': { const [k, v] = arg.split('='); this.flags.set(k.trim(), v === undefined ? true : isNaN(+v) ? v.trim() : +v); break; }
      case 'unset': this.flags.set(arg, false); break;
      case 'inc': this.flags.inc(arg); break;
      case 'start': this.quests?.start(arg); break;
      case 'complete': this.quests?.complete(arg); break;
      case 'report': { const [type, target] = rest; this.quests?.report(type, target); break; }
      case 'give': this.inventory?.add(rest[0], +(rest[1] || 1)); break;
      case 'take': this.inventory?.remove(rest[0], +(rest[1] || 1)); break;
      case 'money': if (this.inventory) this.inventory.money += +rest[0]; break;
      case 'emit': this.events?.emit(rest[0], rest.slice(1).join(' ')); break;
      default: console.warn('unknown dialogue action', action);
    }
    if (this.quests) this.quests.onFlag();
  }
}

// Compact dialogue script format (easy for agents to author):
//   # node_id
//   Speaker: Line of text
//   > Choice text -> target_node [if flag] {do: set x; start q1}
//   -> next_node            (linear continuation)
//   @do: give coin 5
//   @if: flag_name          (node condition; @else: other_node)
// First node is the start. 'end' terminates.
export function parseDialogue(src) {
  const nodes = {}; let cur = null, start = null;
  for (let raw of src.split('\n')) {
    const line = raw.trim(); if (!line || line.startsWith('//')) continue;
    if (line.startsWith('#')) { const id = line.slice(1).trim(); cur = nodes[id] = { choices: [] }; if (!start) start = id; continue; }
    if (!cur) throw new Error('dialogue: text before first # node');
    if (line.startsWith('>')) {
      const m = line.slice(1).match(/^(.*?)->\s*([\w-]+)\s*(?:\[if\s+([^\]]+)\])?\s*(?:\{do:\s*([^}]+)\})?\s*$/);
      if (!m) throw new Error('dialogue: bad choice line: ' + line);
      cur.choices.push({ text: m[1].trim(), next: m[2], if: m[3]?.trim(), do: m[4] ? m[4].split(';').map((s) => s.trim()).filter(Boolean) : undefined });
    } else if (line.startsWith('->')) cur.next = line.slice(2).trim();
    else if (line.startsWith('@do:')) cur.do = [...(cur.do || []), ...line.slice(4).split(';').map((s) => s.trim()).filter(Boolean)];
    else if (line.startsWith('@if:')) cur.if = line.slice(4).trim();
    else if (line.startsWith('@else:')) cur.else = line.slice(6).trim();
    else if (line.startsWith('@anim:')) cur.anim = line.slice(6).trim();
    else { const m = line.match(/^([^:]{1,40}):\s*(.*)$/); if (m) { cur.speaker = m[1].trim(); cur.text = (cur.text ? cur.text + ' ' : '') + m[2]; } else cur.text = (cur.text ? cur.text + ' ' : '') + line; }
  }
  for (const n of Object.values(nodes)) if (!n.choices.length) delete n.choices;
  return { start, nodes };
}

// Mission timeline: ordered steps with enter/update/complete conditions.
export class Mission {
  constructor(id, steps, { onComplete, onFail } = {}) { this.id = id; this.steps = steps; this.i = -1; this.t = 0; this.onComplete = onComplete; this.onFail = onFail; this.status = 'pending'; }
  start(ctx) { this.status = 'active'; this._next(ctx); }
  _next(ctx) { this.i++; this.t = 0; if (this.i >= this.steps.length) { this.status = 'complete'; this.onComplete?.(ctx); return; } this.steps[this.i].enter?.(ctx); }
  get step() { return this.steps[this.i]; }
  update(dt, ctx) {
    if (this.status !== 'active') return;
    this.t += dt; const s = this.steps[this.i];
    s.update?.(dt, ctx, this.t);
    if (s.fail?.(ctx, this.t)) { this.status = 'failed'; this.onFail?.(ctx, s); return; }
    if (s.done?.(ctx, this.t)) { s.exit?.(ctx); this._next(ctx); }
  }
}
