// Story compiler + validator. Pure (no DOM, no three.js): runs in the browser and in Node.
//
// A story script (`*.story.js`, `export default { ... }`) describes premise, themes, cast,
// world facts, acts and missions with branching dialogue in the GameForge dialogue script
// format. compileStory() turns it into the data the engine already runs:
//   quests    -> QuestSystem.define(...)        (engine/gameplay/narrative.js)
//   dialogues -> DialogueSystem.define(npcId, g) (one merged graph per NPC, conditional entry)
//   npcs / landmarks / items / autoStart / ending -> composeGame(spec) via spec.story
// analyzeStory() runs the review checks used by `gameforge story` (tools/story.mjs):
// dialogue graph defects, flag bookkeeping, quest completability, mission cycles, branch
// coverage, character consistency, pacing, originality and simulated playthroughs.
import { Flags, QuestSystem, DialogueSystem, parseDialogue } from './narrative.js';

export const STORY_FORMAT = 'gameforge.story/1';
export const OBJECTIVE_TYPES = ['talk', 'reach', 'collect', 'kill', 'flag', 'custom'];
// Keep in sync with ENEMY_TYPES in engine/gameplay/actors.js (checked by tests/unit/story.test.mjs).
export const ENEMY_TYPE_IDS = ['grunt', 'brute', 'duelist', 'thug'];
export const MAIN_ROLES = ['protagonist', 'antagonist', 'deuteragonist', 'mentor'];
export const WHEN = ['offer', 'active', 'complete', 'always'];
// Names from well-known franchises. A hit fails the originality check (original IP only).
export const FRANCHISE_BLOCKLIST = ['Grand Theft Auto', 'Los Santos', 'Liberty City', 'Vice City', 'San Andreas', 'Night City', 'Gotham', 'Batman', 'Superman', 'Spider-Man', 'Mario', 'Luigi', 'Zelda', 'Hyrule', 'Skyrim', 'Tamriel', 'Witcher', 'Geralt', 'Kratos', 'Lara Croft', 'Master Chief', 'Arthur Morgan', 'John Marston', 'Pokemon', 'Pikachu', 'Jedi', 'Sith', 'Darth', 'Hogwarts', 'Middle-earth', 'Gandalf', 'Kirby', 'Solid Snake', 'Ezio', 'Altair', 'Aloy', 'Ellie Williams', 'Nathan Drake', 'Vault-Tec', 'Agent 47', 'Max Payne', 'Niko Bellic', 'Trevor Philips', 'Kiryu', 'Kamurocho'];

export class StoryError extends Error {
  constructor(errors) { super(`story: ${errors.length} error(s)\n  - ${errors.join('\n  - ')}`); this.name = 'StoryError'; this.errors = errors; }
}

const arr = (x) => (x === undefined || x === null ? [] : Array.isArray(x) ? x : [x]);
const ID_RE = /^[A-Za-z_][\w-]*$/;
const COND_RE = /^(!?)([\w.:-]+)\s*(>=|<=|==|!=|>|<)?\s*(.*)$/;
const ENGINE_PREFIX = /^(quest|talked|seen):/;
const slug = (s) => String(s || 'story').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'story';
export const words = (t) => String(t || '').trim().split(/\s+/).filter(Boolean).length;

// Keys a condition reads ('a', '!b', 'c>=2', arrays = AND). Functions are opaque.
export function condKeys(cond) {
  if (cond === undefined || cond === null || cond === '' || typeof cond === 'function') return [];
  if (Array.isArray(cond)) return cond.flatMap(condKeys);
  const m = String(cond).trim().match(COND_RE); return m ? [m[2]] : [];
}
// Dialogue action -> { cmd, key, arg }
export function parseAction(a) {
  if (typeof a !== 'string') return { cmd: 'fn' };
  const [cmd, ...rest] = a.trim().split(/\s+/); const arg = rest.join(' ');
  if (cmd === 'set') return { cmd, key: arg.split('=')[0].trim(), value: arg.includes('=') ? arg.split('=').slice(1).join('=').trim() : true };
  if (cmd === 'unset' || cmd === 'inc') return { cmd, key: arg.trim() };
  if (cmd === 'start' || cmd === 'complete') return { cmd, quest: arg.trim() };
  if (cmd === 'give' || cmd === 'take') return { cmd, item: rest[0], n: +(rest[1] || 1) };
  if (cmd === 'report') return { cmd, type: rest[0], target: rest[1] };
  if (cmd === 'money' || cmd === 'emit') return { cmd, arg };
  return { cmd, unknown: true };
}
const setsFlag = (acts, key) => arr(acts).some((a) => { const p = parseAction(a); return (p.cmd === 'set' || p.cmd === 'inc') && p.key === key; });
const textVars = (t) => [...String(t || '').matchAll(/\{([\w.:-]+)\}/g)].map((m) => m[1]);
const nodeTargets = (n) => [n.next, n.else, ...(n.choices || []).map((c) => c.next)].filter((x) => x !== undefined && x !== null && x !== '');

// ---------------------------------------------------------------------------------------
// Compile
// ---------------------------------------------------------------------------------------
function build(story) {
  const E = [];
  const err = (where, msg) => E.push(`${where}: ${msg}`);
  if (!story || typeof story !== 'object' || Array.isArray(story)) throw new StoryError(['story script must `export default { premise, themes, characters, missions, world }`']);
  const out = { format: STORY_FORMAT, id: story.id || slug(story.title), title: story.title || story.id || 'Untitled story', premise: story.premise || '', logline: story.logline || '', themes: arr(story.themes), tone: story.tone || '',
    characters: [], npcs: [], quests: [], dialogues: {}, startQuests: [], autoStart: [], items: {}, landmarks: [], initialFlags: { ...(story.flags?.initial || {}) }, externalFlags: arr(story.flags?.external), barks: {}, ending: null, acts: [],
    meta: { conversations: {}, undefinedTargets: [], missionOrder: [], flagDocs: {} } };

  // ---- characters
  const chars = arr(story.characters), charById = {}, speakers = {};
  chars.forEach((c, i) => {
    const w = `characters[${i}]${c?.id ? ` (${c.id})` : ''}`;
    if (!c || typeof c !== 'object') return err(w, 'must be an object { id, name, role, want, need, flaw, arc, voice }');
    if (!c.id || !ID_RE.test(c.id)) return err(w, `invalid id ${JSON.stringify(c.id)} (letters, digits, _ and - only)`);
    if (charById[c.id]) return err(w, `duplicate character id "${c.id}"`);
    if (!c.name) err(w, 'missing name');
    charById[c.id] = c;
    for (const s of [c.id, c.name, ...arr(c.aliases)]) if (s) speakers[String(s).toLowerCase()] = c.id;
    out.characters.push({ id: c.id, name: c.name || c.id, role: c.role || 'supporting', main: isMain(c), want: c.want || '', need: c.need || '', flaw: c.flaw || '', arc: c.arc || '', voice: c.voice || '' });
    if (c.barks) out.barks[c.id] = arr(c.barks);
  });
  const protagonists = chars.filter((c) => c?.role === 'protagonist' || c?.player).map((c) => c.id);

  // ---- world: locations -> landmarks; items; enemies
  const locs = {};
  arr(story.world?.locations).forEach((l, i) => {
    const w = `world.locations[${i}]`;
    if (!l?.id || !ID_RE.test(l.id)) return err(w, `invalid id ${JSON.stringify(l?.id)}`);
    if (locs[l.id]) return err(w, `duplicate location id "${l.id}"`);
    locs[l.id] = l;
    if (l.kind) out.landmarks.push({ id: l.id, kind: l.kind, ...(l.at !== undefined ? { at: l.at } : {}), ...(l.x !== undefined ? { x: l.x, z: l.z } : {}), ...(l.distance !== undefined ? { distance: l.distance } : {}), ...(l.radius !== undefined ? { radius: l.radius } : {}), ...(l.houses !== undefined ? { houses: l.houses } : {}), ...(l.floors !== undefined ? { floors: l.floors } : {}) });
  });
  const items = Array.isArray(story.items) ? Object.fromEntries(story.items.map((it) => (typeof it === 'string' ? [it, { name: it }] : [it.id, it]))) : { ...(story.items || {}) };
  out.items = items;
  const enemies = new Set([...ENEMY_TYPE_IDS, ...arr(story.enemies).map((e) => (typeof e === 'string' ? e : e?.type))].filter(Boolean));

  // ---- missions (flat list or nested under acts)
  const missions = [];
  arr(story.acts).forEach((a, ai) => {
    if (!a || typeof a !== 'object') return err(`acts[${ai}]`, 'must be an object { id, title, purpose, missions }');
    const act = { id: a.id || `act${ai + 1}`, title: a.title || `Act ${ai + 1}`, purpose: a.purpose || a.beat || '', missions: [] };
    for (const m of arr(a.missions)) { if (typeof m === 'string') act.missions.push(m); else if (m) { missions.push({ ...m, act: m.act ?? act.id }); act.missions.push(m.id); } }
    out.acts.push(act);
  });
  for (const m of arr(story.missions)) missions.push(m);
  const missionById = {};
  missions.forEach((m, i) => {
    const w = `missions[${i}]${m?.id ? ` (${m.id})` : ''}`;
    if (!m || typeof m !== 'object') return err(w, 'must be an object { id, title, beats, objectives, dialogue, branches, rewards, flags }');
    if (!m.id || !ID_RE.test(m.id)) return err(w, `invalid id ${JSON.stringify(m.id)}`);
    if (missionById[m.id]) return err(w, `duplicate mission id "${m.id}"`);
    missionById[m.id] = m;
  });
  for (const a of out.acts) for (const id of a.missions) if (!missionById[id]) err(`acts (${a.id})`, `references unknown mission "${id}"`);
  for (const m of arr(story.missions)) if (m?.act !== undefined && out.acts.length && !out.acts.some((a) => a.id === m.act)) err(`missions (${m.id})`, `unknown act "${m.act}"`);
  for (const m of arr(story.missions)) { const a = out.acts.find((x) => x.id === m?.act); if (a && !a.missions.includes(m.id)) a.missions.push(m.id); }

  const convIds = {};
  const convs = []; // { id, npc, mission, when, cond, once, priority, graph, entry }
  const parseConv = (c, where, mission, mi) => {
    if (!c || typeof c !== 'object') return err(where, 'conversation must be { id, with, when, script }');
    if (!c.id || !ID_RE.test(c.id)) return err(where, `invalid conversation id ${JSON.stringify(c.id)}`);
    if (convIds[c.id]) return err(where, `duplicate conversation id "${c.id}"`);
    convIds[c.id] = true;
    const npc = c.with || mission?.giver;
    if (!npc) return err(`${where} (${c.id})`, 'missing `with` (the character you talk to)');
    if (!charById[npc]) return err(`${where} (${c.id})`, `\`with\` references unknown character "${npc}"`);
    let g;
    try { g = typeof c.script === 'string' ? parseDialogue(c.script) : c.graph || c.script; }
    catch (e) { return err(`${where} (${c.id})`, e.message); }
    if (!g || !g.nodes || !Object.keys(g.nodes).length) return err(`${where} (${c.id})`, 'empty dialogue (script needs at least one `# node`)');
    const when = c.when ?? (mission ? 'active' : 'always');
    if (!mission && ['offer', 'active', 'complete'].includes(when)) return err(`${where} (${c.id})`, `when: '${when}' needs a mission; use a condition string at story level`);
    let cond;
    if (when === 'offer') cond = [...arr(mission.requires).map((r) => `quest:${r}:complete`), ...arr(mission.requiresFlags), `!quest:${mission.id}`];
    else if (when === 'active') cond = [`quest:${mission.id}==active`];
    else if (when === 'complete') cond = [`quest:${mission.id}:complete`];
    else if (when === 'always') cond = [];
    else cond = arr(when);
    cond = [...cond, ...arr(c.if)];
    const once = c.once ?? when === 'complete';
    const base = mission ? (mi + 1) * 10 : 0;
    const priority = c.priority ?? base + ({ complete: 3, active: 2, offer: 1, always: 0 }[when] ?? 4);
    convs.push({ id: c.id, npc, mission: mission?.id || null, when, cond, once, priority, raw: g });
  };
  arr(story.conversations).forEach((c, i) => parseConv(c, `conversations[${i}]`, null, -1));

  missions.forEach((m, mi) => {
    if (!m || !missionById[m.id] || missionById[m.id] !== m) return;
    const w = `missions (${m.id})`;
    out.meta.missionOrder.push(m.id);
    if (!m.title) err(w, 'missing title');
    if (m.giver && !charById[m.giver]) err(w, `giver references unknown character "${m.giver}"`);
    for (const r of arr(m.requires)) if (!missionById[r]) err(w, `requires unknown mission "${r}"`);
    if (m.next && !missionById[m.next]) err(w, `next references unknown mission "${m.next}"`);
    if (m.start !== undefined && !['dialogue', 'auto'].includes(m.start)) err(w, `start must be 'dialogue' or 'auto', got ${JSON.stringify(m.start)}`);
    const objs = arr(m.objectives);
    if (!objs.length) err(w, 'needs at least one objective');
    const oids = {};
    objs.forEach((o, oi) => {
      const ow = `${w} objectives[${oi}]${o?.id ? ` (${o.id})` : ''}`;
      if (!o || typeof o !== 'object') return err(ow, 'must be { id, type, target, count, text }');
      if (!o.id || !ID_RE.test(o.id)) return err(ow, `invalid id ${JSON.stringify(o.id)}`);
      if (oids[o.id]) return err(ow, `duplicate objective id "${o.id}"`);
      oids[o.id] = true;
      if (!OBJECTIVE_TYPES.includes(o.type)) err(ow, `type must be one of ${OBJECTIVE_TYPES.join('|')}, got ${JSON.stringify(o.type)}`);
      if (o.type !== 'custom' && (o.target === undefined || o.target === '')) err(ow, 'missing target');
      if (!o.text) err(ow, 'missing text (what the HUD shows)');
      if (o.count !== undefined && !(Number.isInteger(o.count) && o.count >= 1)) err(ow, `count must be an integer ≥ 1, got ${JSON.stringify(o.count)}`);
    });
    for (const o of objs) for (const a of arr(o?.after)) if (!oids[a]) err(`${w} objectives (${o.id})`, `after references unknown objective "${a}"`);
    arr(m.branches).forEach((b, bi) => {
      const bw = `${w} branches[${bi}]${b?.id ? ` (${b.id})` : ''}`;
      if (!b || typeof b !== 'object') return err(bw, 'must be { id, choice, flag, consequence, foldback }');
      if (!b.id) err(bw, 'missing id');
      if (!b.flag || !ID_RE.test(String(b.flag).replace(/:/g, '_'))) err(bw, 'missing flag (the flag the choice sets, e.g. "spared_guard")');
      if (b.foldback && !missionById[b.foldback]) err(bw, `foldback references unknown mission "${b.foldback}"`);
    });
    const flagDocs = Array.isArray(m.flags) ? m.flags : m.flags && typeof m.flags === 'object' ? Object.entries(m.flags).map(([id, desc]) => ({ id, desc })) : [];
    for (const f of flagDocs) { const fd = typeof f === 'string' ? { id: f, desc: '' } : f; out.meta.flagDocs[fd.id] = { ...fd, mission: m.id }; }
    arr(m.dialogue).forEach((c, ci) => parseConv(c, `${w} dialogue[${ci}]`, m, mi));
    out.quests.push(JSON.parse(JSON.stringify({ id: m.id, title: m.title || m.id, description: m.summary || m.logline || '', giver: m.giver, act: m.act,
      objectives: objs.filter((o) => o && o.id).map((o) => ({ id: o.id, type: o.type, target: o.target, ...(o.count ? { count: o.count } : {}), text: o.text, ...(o.after ? { after: arr(o.after) } : {}), ...(o.optional ? { optional: true } : {}), ...(o.hidden ? { hidden: true } : {}), ...(o.marker ? { marker: o.marker } : {}) })),
      requires: [...arr(m.requires).map((r) => `quest:${r}:complete`), ...arr(m.requiresFlags)], rewards: m.rewards || {}, ...(m.next ? { next: m.next } : {}), ...(m.optional ? { optional: true } : {}) })));
    if (m.start === 'auto') { out.autoStart.push(m.id); if (!arr(m.requires).length && !arr(m.requiresFlags).length) out.startQuests.push(m.id); }
  });

  // ---- conversations -> one graph per NPC with a conditional entry list
  const convByMission = {};
  for (const c of convs) {
    const pre = (id) => `${c.id}__${id}`;
    const nodes = {};
    for (const [nid, n] of Object.entries(c.raw.nodes)) {
      const copy = JSON.parse(JSON.stringify(n));
      for (const k of ['next', 'else']) if (copy[k] !== undefined && copy[k] !== 'end') { if (!c.raw.nodes[copy[k]]) out.meta.undefinedTargets.push({ conv: c.id, node: nid, target: copy[k] }); copy[k] = pre(copy[k]); }
      for (const ch of copy.choices || []) if (ch.next !== undefined && ch.next !== 'end') { if (!c.raw.nodes[ch.next]) out.meta.undefinedTargets.push({ conv: c.id, node: nid, target: ch.next, choice: ch.text }); ch.next = pre(ch.next); }
      nodes[pre(nid)] = copy;
    }
    const entryLocal = Array.isArray(c.raw.start) ? c.raw.start[0]?.node : c.raw.start;
    c.entry = pre(entryLocal);
    if (nodes[c.entry]) nodes[c.entry].do = [...arr(nodes[c.entry].do), `set seen:${c.id}`]; // `seen:<convId>` is readable in conditions
    c.nodes = nodes;
    out.meta.conversations[c.id] = { npc: c.npc, mission: c.mission, when: c.when, once: c.once, priority: c.priority, entry: c.entry, nodes: Object.keys(nodes), local: Object.keys(c.raw.nodes) };
    (convByMission[c.mission || ''] ||= []).push(c.id);
  }
  out.meta.convByMission = convByMission;
  const byNpc = {};
  for (const c of convs) (byNpc[c.npc] ||= []).push(c);
  for (const [npc, list] of Object.entries(byNpc)) {
    list.sort((a, b) => b.priority - a.priority);
    const nodes = {};
    for (const c of list) Object.assign(nodes, c.nodes);
    const ch = charById[npc];
    const idle = `${npc}__idle`;
    nodes[idle] = { speaker: ch.name || npc, text: ch.idle || arr(ch.barks)[0] || 'Not now.', next: 'end' };
    const start = list.map((c) => ({ if: [...c.cond, ...(c.once ? [`!seen:${c.id}`] : [])], node: c.entry }));
    start.push({ node: idle });
    out.dialogues[npc] = { start, nodes };
  }
  out.meta.convs = convs.map((c) => ({ id: c.id, npc: c.npc, mission: c.mission, entry: c.entry }));

  // ---- npcs: every non-player character that talks or is placed in the world
  for (const c of chars) {
    if (!c || !charById[c.id] || protagonists.includes(c.id)) continue;
    if (!out.dialogues[c.id] && c.at === undefined) continue;
    out.npcs.push({ id: c.id, name: c.name || c.id, role: c.role || 'supporting', ...(c.at !== undefined ? { at: c.at } : {}), ...(c.offset ? { offset: c.offset } : {}), ...(c.look ? { look: c.look } : {}), ...(c.wander !== undefined ? { wander: c.wander } : {}), ...(out.dialogues[c.id] ? { dialogue: out.dialogues[c.id] } : {}) });
    if (c.at !== undefined && typeof c.at === 'string' && !locs[c.at]) err(`characters (${c.id})`, `at references unknown location "${c.at}"`);
  }
  // ---- ending
  const en = story.ending || {};
  const endQuests = en.missions ? arr(en.missions) : missions.filter((m) => m && missionById[m.id] === m && !m.optional).map((m) => m.id);
  for (const id of endQuests) if (!missionById[id]) err('ending', `references unknown mission "${id}"`);
  out.ending = { quests: endQuests, ...(en.if ? { if: en.if } : {}), ...(en.title ? { title: en.title } : {}), ...(en.text ? { text: en.text } : {}) };
  out.world = { setting: story.world?.setting || '', facts: arr(story.world?.facts), locations: Object.values(locs).map((l) => ({ id: l.id, name: l.name || l.id, desc: l.desc || '', hooks: arr(l.hooks) })) };
  return { out, errors: E, ctx: { story, chars, charById, speakers, protagonists, locs, items, enemies, missions, missionById, convs } };
}
function isMain(c) { return !!(c && (c.main || MAIN_ROLES.includes(c.role))); }

// Compile a story script into engine data. Throws StoryError listing every structural problem.
export function compileStory(story) {
  const { out, errors } = build(story);
  if (errors.length) throw new StoryError(errors);
  return out;
}
export const isCompiledStory = (s) => !!s && s.format === STORY_FORMAT;

// Merge a story (raw script or compiled) into a game spec: quests, npcs (dialogue), landmarks,
// items, start quests and a default 'quests' goal. Existing spec entries win on id clashes.
export function applyStoryToSpec(spec) {
  if (!spec?.story) return spec;
  const st = isCompiledStory(spec.story) ? spec.story : compileStory(spec.story);
  spec.story = st;
  spec.quests ||= []; spec.npcs ||= []; spec.landmarks ||= []; spec.items ||= {}; spec.startQuests ||= [];
  const qids = new Set(spec.quests.map((q) => q.id));
  for (const q of st.quests) if (!qids.has(q.id)) spec.quests.push(q);
  for (const n of st.npcs) {
    const ex = spec.npcs.find((x) => x.id === n.id);
    if (ex) { if (!ex.dialogue && n.dialogue) ex.dialogue = n.dialogue; ex.name ||= n.name; if (ex.at === undefined && n.at !== undefined) ex.at = n.at; }
    else spec.npcs.push(n);
  }
  const lids = new Set(spec.landmarks.map((l) => l.id || l.kind));
  for (const l of st.landmarks) if (!lids.has(l.id)) spec.landmarks.push(l);
  for (const [k, v] of Object.entries(st.items || {})) spec.items[k] ||= v;
  for (const id of st.startQuests) if (!spec.startQuests.includes(id)) spec.startQuests.push(id);
  if (!spec.goal && st.ending?.quests?.length) spec.goal = { type: 'quests', quests: st.ending.quests, label: st.ending.title || 'Finish the story', ...(st.ending.title ? { winTitle: st.ending.title } : {}), ...(st.ending.text ? { winText: st.ending.text } : {}) };
  return spec;
}

// ---------------------------------------------------------------------------------------
// Playthrough simulation (real DialogueSystem + QuestSystem, world events auto-reported)
// ---------------------------------------------------------------------------------------
// choose: 'first' | 'last' (rotates on revisits so declines are eventually accepted);
// prefer: a flag — pick any visible choice that sets it.
export function simulatePlaythrough(compiled, { choose = 'first', prefer = null, maxRounds = 80 } = {}) {
  const flags = new Flags(); const quests = new QuestSystem(flags);
  const inventory = { items: {}, money: 0, add(i, n = 1) { this.items[i] = (this.items[i] || 0) + n; }, remove(i, n = 1) { this.items[i] = Math.max(0, (this.items[i] || 0) - n); } };
  const dialogue = new DialogueSystem({ flags, quests, inventory });
  quests.define(JSON.parse(JSON.stringify(compiled.quests)));
  flags.load(compiled.initialFlags || {});
  for (const k of compiled.externalFlags || []) if (flags.get(k) === undefined) flags.set(k, true);
  flags.onChange = () => quests.onFlag();
  for (const [id, g] of Object.entries(compiled.dialogues)) dialogue.define(id, JSON.parse(JSON.stringify(g)));
  const visits = {}, choices = [], lines = [], problems = [];
  const auto = () => { for (const id of compiled.autoStart || []) if (quests.available(id)) quests.start(id); };
  const ended = () => (compiled.ending?.quests || []).every((id) => quests.status(id) === 'complete') && flags.test(compiled.ending?.if);
  const warn = console.warn; console.warn = (...a) => problems.push(a.join(' '));
  let rounds = 0, idle = 0;
  try {
    for (const id of compiled.startQuests || []) quests.start(id);
    auto();
    while (rounds++ < maxRounds && !ended()) {
      const before = JSON.stringify([flags.v, quests.state]);
      for (const npc of Object.keys(compiled.dialogues)) {
        dialogue.start(npc); // same order as the game: the talk objective completes when the conversation ends
        let guard = 0;
        while (dialogue.current() && guard++ < 300) {
          const cur = dialogue.current(); lines.push({ npc, node: cur.node, speaker: cur.speaker, text: cur.text });
          if (cur.choices.length) {
            const n = cur.choices.length, v = (visits[cur.node] = (visits[cur.node] || 0) + 1) - 1;
            const pref = arr(prefer);
            let c = pref.length ? cur.choices.find((x) => pref.some((f) => setsFlag(x.do, f) || setsFlag(compiled.dialogues[npc].nodes[x.next]?.do, f))) : null;
            c ||= cur.choices[(choose === 'last' ? n - 1 - (v % n) : v % n)];
            choices.push({ node: cur.node, text: c.text }); dialogue.advance(c.index);
          } else dialogue.advance();
        }
        if (guard >= 300) { problems.push(`dialogue loop with ${npc} at ${dialogue.current()?.node}`); dialogue.end(); }
        flags.set('talked:' + npc); quests.report('talk', npc); auto();
        if (ended()) break;
      }
      if (ended()) break;
      for (const q of quests.activeQuests()) for (const o of quests.currentObjectives(q.id)) {
        if (!['reach', 'collect', 'kill', 'custom'].includes(o.type) || quests.state[q.id]?.done[o.id]) continue;
        quests.report(o.type, Array.isArray(o.target) ? o.target[0] : o.target, o.count || 1);
      }
      auto();
      idle = JSON.stringify([flags.v, quests.state]) === before ? idle + 1 : 0;
      if (idle >= 4) break;
    }
  } finally { console.warn = warn; }
  const stuck = quests.activeQuests().map((q) => ({ mission: q.id, open: quests.currentObjectives(q.id).filter((o) => !quests.state[q.id].done[o.id] && !o.optional).map((o) => o.id) }));
  const notStarted = (compiled.ending?.quests || []).filter((id) => quests.status(id) === 'inactive');
  return { ended: ended(), rounds, strategy: prefer ? `prefer:${arr(prefer)[0]}` : choose, completed: quests.completed(), stuck, notStarted, flags: flags.toJSON(), choices, lines: lines.length, transcript: lines, problems };
}

// ---------------------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------------------
export function analyzeStory(story, { simulate = true } = {}) {
  const checks = [];
  const chk = (name, pass, detail, level = 'error') => checks.push({ name, pass: !!pass, detail: String(detail), level });
  const list = (a, n = 6) => (a.length ? a.slice(0, n).join('; ') + (a.length > n ? ` … +${a.length - n} more` : '') : 'ok');
  let built;
  try { built = build(story); }
  catch (e) { chk('story compiles (schema + references)', false, e.message); return { ok: false, checks, metrics: {}, compiled: null, graph: null, playthroughs: [] }; }
  const { out, errors, ctx } = built;
  chk('story compiles (schema + references)', !errors.length, errors.length ? `${errors.length} error(s): ${list(errors, 8)}` : 'ok');

  // ---- dialogue graph
  const graph = { conversations: [], missions: [] };
  const unreachable = [], deadEnds = [], traps = [], noOption = [];
  const allNodes = {}; // prefixed id -> { conv, local, node }
  for (const c of ctx.convs) {
    if (!c.nodes) continue;
    const pre = (id) => `${c.id}__${id}`, nodes = c.nodes;
    for (const [k, n] of Object.entries(nodes)) allNodes[k] = { conv: c.id, local: k.slice(c.id.length + 2), node: n, npc: c.npc, mission: c.mission };
    const seen = new Set(), q = [c.entry];
    while (q.length) { const k = q.shift(); if (seen.has(k) || !nodes[k]) continue; seen.add(k); for (const t of nodeTargets(nodes[k])) if (t !== 'end') q.push(t); }
    const terminal = (k) => { const n = nodes[k]; return !n.next && !n.else && !(n.choices || []).length; };
    // nodes that can reach `end`, a dead end (already reported) or a missing target (already reported)
    const ok = new Set(); let grew = true;
    while (grew) { grew = false; for (const [k, n] of Object.entries(nodes)) { if (ok.has(k)) continue; const ts = nodeTargets(n); if (terminal(k) || ts.some((t) => t === 'end' || !nodes[t] || ok.has(t))) { ok.add(k); grew = true; } } }
    const defects = {};
    for (const k of Object.keys(nodes)) {
      const n = nodes[k], local = k.slice(c.id.length + 2);
      if (!seen.has(k)) { unreachable.push(`${c.id}#${local}`); defects[k] = 'unreachable'; }
      if (terminal(k)) { deadEnds.push(`${c.id}#${local}`); defects[k] = 'dead-end'; }
      else if (!ok.has(k)) { traps.push(`${c.id}#${local}`); defects[k] = 'trap'; }
      if ((n.choices || []).length && n.choices.every((x) => x.if) && !n.next) noOption.push(`${c.id}#${local}`);
    }
    for (const u of out.meta.undefinedTargets.filter((u) => u.conv === c.id)) defects[pre(u.node)] = 'undefined-target';
    graph.conversations.push({ id: c.id, npc: c.npc, mission: c.mission, when: c.when, entry: c.entry,
      nodes: Object.entries(nodes).map(([k, n]) => ({ id: k, local: k.slice(c.id.length + 2), speaker: n.speaker || '', text: n.text || '', kind: (n.choices || []).length ? 'choice' : !n.text ? 'router' : 'line', defect: defects[k] || null })),
      edges: Object.entries(nodes).flatMap(([k, n]) => [...(n.next ? [{ from: k, to: n.next, kind: 'next' }] : []), ...(n.else ? [{ from: k, to: n.else, kind: 'else' }] : []), ...(n.choices || []).map((ch) => ({ from: k, to: ch.next, kind: 'choice', label: ch.text, sets: arr(ch.do).map(parseAction).filter((p) => p.key).map((p) => p.key), acts: arr(ch.do).length }))]) });
  }
  const undef = out.meta.undefinedTargets.map((u) => `${u.conv}#${u.node} -> ${u.target}`);
  chk('no undefined jump targets', !undef.length, list(undef));
  chk('every dialogue node reachable', !unreachable.length, list(unreachable));
  chk('no dead ends (each node has -> end, a next or choices)', !deadEnds.length, list(deadEnds));
  chk('no dialogue traps (end reachable from every node)', !traps.length, list(traps));
  chk('choice nodes always offer an option (not all conditional)', !noOption.length, list(noOption), 'warn');

  // ---- flags
  const sets = {}, reads = {}, starts = {}, engineRefs = [], badActions = [];
  const addSet = (k, w) => (sets[k] ||= []).push(w), addRead = (k, w) => (reads[k] ||= []).push(w);
  const unreach = new Set(graph.conversations.flatMap((c) => c.nodes.filter((n) => n.defect === 'unreachable').map((n) => n.id)));
  const reachableNode = (k) => !unreach.has(k);
  const scanActs = (acts, w, reachable) => {
    for (const a of arr(acts)) {
      const p = parseAction(a);
      if (p.key) { if (ENGINE_PREFIX.test(p.key)) engineRefs.push({ key: p.key, w }); else addSet(p.key, w); }
      if (p.unknown) badActions.push(`${w}: unknown action "${a}"`);
      if (p.quest) { if (!ctx.missionById[p.quest]) badActions.push(`${w}: ${p.cmd} unknown mission "${p.quest}"`); else if (p.cmd === 'start' && reachable) (starts[p.quest] ||= []).push(w); }
      if (p.item && !ctx.items[p.item]) badActions.push(`${w}: ${p.cmd} undeclared item "${p.item}" (add it to story.items)`);
    }
  };
  const scanCond = (cond, w) => { for (const k of condKeys(cond)) { if (ENGINE_PREFIX.test(k)) engineRefs.push({ key: k, w }); else addRead(k, w); } };
  for (const [k, info] of Object.entries(allNodes)) {
    const w = `${info.conv}#${info.local}`, n = info.node, r = reachableNode(k);
    scanActs(n.do, w, r); scanCond(n.if, w);
    for (const v of textVars(n.text)) addRead(v, w);
    for (const ch of n.choices || []) { scanActs(ch.do, `${w} > "${ch.text}"`, r); scanCond(ch.if, `${w} > "${ch.text}"`); for (const v of textVars(ch.text)) addRead(v, w); }
  }
  for (const c of ctx.convs) for (const cond of c.cond || []) scanCond(cond, `conversation ${c.id} (when/if)`);
  for (const m of ctx.missions) {
    if (!m?.id) continue;
    scanCond(m.requiresFlags, `mission ${m.id} requiresFlags`);
    for (const k of Object.keys(m.rewards?.flags || {})) addSet(k, `mission ${m.id} rewards`);
    for (const o of arr(m.objectives)) if (o?.type === 'flag') scanCond(o.target, `mission ${m.id} objective ${o.id}`);
    if (m.next) (starts[m.next] ||= []).push(`${m.id}.next`);
  }
  scanCond(story.ending?.if, 'ending');
  for (const k of Object.keys(out.initialFlags)) addSet(k, 'flags.initial');
  for (const k of out.externalFlags) { addSet(k, 'flags.external'); addRead(k, 'flags.external'); }
  for (const id of out.autoStart) (starts[id] ||= []).push('start: auto');
  const readNotSet = Object.keys(reads).filter((k) => !sets[k]).map((k) => `"${k}" read by ${reads[k][0]}`);
  const setNotRead = Object.keys(sets).filter((k) => !reads[k]).map((k) => `"${k}" set by ${sets[k][0]}`);
  chk('flags read are set somewhere (no dead conditions)', !readNotSet.length, list(readNotSet));
  chk('flags set are read somewhere (consequences tracked)', !setNotRead.length, list(setNotRead), 'warn');
  const declaredUnset = Object.keys(out.meta.flagDocs).filter((k) => !sets[k]).map((k) => `"${k}" (declared by ${out.meta.flagDocs[k].mission})`);
  chk('declared mission flags are set', !declaredUnset.length, list(declaredUnset));
  // engine-managed keys must name real things
  const badRefs = [];
  for (const { key, w } of engineRefs) {
    const p = key.split(':');
    if (p[0] === 'quest' && !ctx.missionById[p[1]]) badRefs.push(`${w}: "${key}" (unknown mission)`);
    if (p[0] === 'quest' && p[2] && p[2] !== 'complete' && !arr(ctx.missionById[p[1]]?.objectives).some((o) => o?.id === p[2])) badRefs.push(`${w}: "${key}" (use quest:<id>, quest:<id>:complete or quest:<id>:<objectiveId>)`);
    if (p[0] === 'talked' && !ctx.charById[p[1]]) badRefs.push(`${w}: "${key}" (unknown character)`);
    if (p[0] === 'seen' && p.length === 2 && !ctx.convs.some((c) => c.id === p[1])) badRefs.push(`${w}: "${key}" (unknown conversation)`);
    if (p[0] === 'seen' && p.length >= 3 && !out.dialogues[p[1]]?.nodes[p.slice(2).join(':')]) badRefs.push(`${w}: "${key}" (unknown node)`);
  }
  chk('conditions and actions reference existing missions, characters, nodes and items', !badRefs.length && !badActions.length, list([...badRefs, ...badActions]));

  // ---- missions
  const neverStart = ctx.missions.filter((m) => m?.id && !starts[m.id]).map((m) => m.id);
  chk('every mission can start (start action, next or start: auto)', !neverStart.length, neverStart.length ? 'never started: ' + neverStart.join(', ') : 'ok');
  const talkers = new Set(Object.keys(out.dialogues));
  const badObj = [], customObj = [];
  for (const m of ctx.missions) {
    if (!m?.id) continue;
    const objs = arr(m.objectives).filter((o) => o?.id);
    for (const o of objs) {
      const w = `${m.id}.${o.id}`, ts = arr(o.target);
      if (o.type === 'talk') for (const t of ts) { if (!ctx.charById[t]) badObj.push(`${w}: talk to unknown character "${t}"`); else if (ctx.protagonists.includes(t)) badObj.push(`${w}: cannot talk to the player character "${t}"`); else if (!talkers.has(t)) badObj.push(`${w}: "${t}" has no conversation (not interactable)`); }
      if (o.type === 'reach' && !ts.some((t) => ctx.locs[t])) badObj.push(`${w}: reach unknown location "${ts.join('|')}" (add it to world.locations)`);
      if (o.type === 'collect' && !ts.some((t) => ctx.items[t])) badObj.push(`${w}: collect undeclared item "${ts.join('|')}" (add it to story.items)`);
      if (o.type === 'kill' && !ts.some((t) => ctx.enemies.has(t))) badObj.push(`${w}: kill unknown enemy type "${ts.join('|')}" (known: ${[...ctx.enemies].join(', ')})`);
      if (o.type === 'flag') for (const k of condKeys(o.target)) if (!ENGINE_PREFIX.test(k) && !sets[k]) badObj.push(`${w}: waits for flag "${k}" that nothing sets`);
      if (o.type === 'custom') customObj.push(w);
    }
    // `after` cycles
    const after = Object.fromEntries(objs.map((o) => [o.id, arr(o.after)]));
    const state = {};
    const visit = (id, path) => { if (state[id] === 2) return; if (state[id] === 1) { badObj.push(`${m.id}: objective cycle ${[...path, id].join(' -> ')}`); return; } state[id] = 1; for (const a of after[id] || []) visit(a, [...path, id]); state[id] = 2; };
    for (const o of objs) visit(o.id, []);
    if (objs.length && objs.every((o) => o.optional)) badObj.push(`${m.id}: every objective is optional (completes instantly)`);
  }
  chk('every objective can complete', !badObj.length, list(badObj));
  if (customObj.length) chk('custom objectives need game code (report("custom", target))', false, list(customObj), 'warn');
  const cycles = [];
  { const st = {}; const visit = (id, path) => { if (st[id] === 2 || !ctx.missionById[id]) return; if (st[id] === 1) { cycles.push([...path.slice(path.indexOf(id)), id].join(' -> ')); return; } st[id] = 1; for (const r of arr(ctx.missionById[id].requires)) visit(r, [...path, id]); st[id] = 2; }; for (const m of ctx.missions) if (m?.id) visit(m.id, []); }
  chk('no mission dependency cycles', !cycles.length, list(cycles));
  if (out.acts.length) { const orphan = ctx.missions.filter((m) => m?.id && !out.acts.some((a) => a.missions.includes(m.id))).map((m) => m.id); chk('every mission belongs to an act', !orphan.length, list(orphan), 'warn'); }

  // ---- branches
  const dependsOn = (id, target, seen = new Set()) => { if (seen.has(id)) return false; seen.add(id); const m = ctx.missionById[id]; if (!m) return false; return arr(m.requires).some((r) => r === target || dependsOn(r, target, seen)); };
  const branches = ctx.missions.flatMap((m) => arr(m?.branches).filter((b) => b?.flag).map((b) => ({ ...b, mission: m.id })));
  const choiceSets = (flag) => Object.entries(allNodes).some(([k, i]) => reachableNode(k) && ((i.node.choices || []).some((ch) => setsFlag(ch.do, flag)) || setsFlag(i.node.do, flag)));
  const uncovered = branches.filter((b) => !choiceSets(b.flag)).map((b) => `${b.mission}/${b.id}: no reachable choice sets "${b.flag}"`);
  const noConseq = branches.filter((b) => !reads[b.flag]).map((b) => `${b.mission}/${b.id}: "${b.flag}" is never read`);
  const noFold = branches.filter((b) => !b.ending && (!b.foldback || (ctx.missionById[b.foldback] && !dependsOn(b.foldback, b.mission)))).map((b) => `${b.mission}/${b.id}: ${b.foldback ? `foldback "${b.foldback}" does not require ${b.mission}` : 'no foldback mission (or ending: true)'}`);
  chk('branches covered (a reachable choice sets each branch flag)', !uncovered.length, branches.length ? `${branches.length - uncovered.length}/${branches.length}${uncovered.length ? ' — ' + list(uncovered) : ''}` : 'no branches declared');
  chk('branches have consequences (flag read later)', !noConseq.length, list(noConseq), 'warn');
  chk('branches fold back (foldback mission follows the branch)', !noFold.length, list(noFold));
  if (!branches.length && ctx.missions.length > 1) chk('story declares branches (meaningful choices)', false, 'no mission declares branches', 'warn');

  // ---- characters
  const unknownSpk = [], spoke = new Set();
  for (const [, i] of Object.entries(allNodes)) {
    if (!i.node.speaker) continue;
    const id = ctx.speakers[i.node.speaker.toLowerCase()];
    if (!id) unknownSpk.push(`"${i.node.speaker}" in ${i.conv}#${i.local}`); else spoke.add(id);
  }
  chk('every speaker is a defined character', !unknownSpk.length, list([...new Set(unknownSpk)]));
  const missingArc = ctx.chars.filter((c) => isMain(c)).flatMap((c) => { const miss = ['want', 'need', 'flaw', 'arc'].filter((k) => !c[k]); return miss.length ? [`${c.id}: missing ${miss.join(', ')}`] : []; });
  chk('main characters have want / need / flaw / arc', ctx.chars.some(isMain) && !missingArc.length, ctx.chars.some(isMain) ? list(missingArc) : 'no main character (role protagonist/antagonist/mentor or main: true)');
  chk('a protagonist is defined', ctx.protagonists.length > 0, ctx.protagonists.join(', ') || 'none (role: "protagonist")', 'warn');
  const noVoice = ctx.chars.filter((c) => c?.id && spoke.has(c.id) && !c.voice).map((c) => c.id);
  chk('speaking characters have a voice note', !noVoice.length, list(noVoice), 'warn');
  const used = new Set([...spoke, ...ctx.missions.map((m) => m?.giver), ...ctx.convs.map((c) => c.npc)]);
  const unused = ctx.chars.filter((c) => c?.id && !used.has(c.id)).map((c) => c.id);
  chk('every defined character appears', !unused.length, list(unused), 'warn');

  // ---- pacing
  const perMission = {}, longLines = [];
  let totalLines = 0, totalChoices = 0, totalOptions = 0, totalWords = 0;
  for (const m of ctx.missions) if (m?.id) perMission[m.id] = { title: m.title || m.id, conversations: 0, lines: 0, choices: 0, options: 0, words: 0, wordsPerLine: 0, beats: arr(m.beats).length, objectives: arr(m.objectives).length };
  for (const c of ctx.convs) if (c.mission && perMission[c.mission]) perMission[c.mission].conversations++;
  for (const [, i] of Object.entries(allNodes)) {
    const pm = perMission[i.mission] || null, n = i.node;
    if (n.text) { const w = words(n.text); totalLines++; totalWords += w; if (pm) { pm.lines++; pm.words += w; } if (w > 30) longLines.push(`${i.conv}#${i.local} (${w} words)`); }
    if ((n.choices || []).length) { totalChoices++; totalOptions += n.choices.length; if (pm) { pm.choices++; pm.options += n.choices.length; } for (const ch of n.choices) if (words(ch.text) > 12) longLines.push(`${i.conv}#${i.local} choice "${ch.text.slice(0, 24)}…" (${words(ch.text)} words > 12)`); }
  }
  for (const pm of Object.values(perMission)) pm.wordsPerLine = pm.lines ? +(pm.words / pm.lines).toFixed(1) : 0;
  chk('lines ≤ 30 words, choices ≤ 12 words (brevity)', !longLines.length, list(longLines), 'warn');
  const noChoice = Object.entries(perMission).filter(([, p]) => !p.choices).map(([id]) => id);
  chk('every mission offers a player choice', !noChoice.length, list(noChoice), 'warn');
  const talky = Object.entries(perMission).filter(([, p]) => p.lines > 60).map(([id, p]) => `${id} (${p.lines} lines)`);
  chk('mission dialogue ≤ 60 lines (keep players playing)', !talky.length, list(talky), 'warn');
  const noBeats = Object.entries(perMission).filter(([, p]) => !p.beats).map(([id]) => id);
  chk('every mission has a beat sheet', !noBeats.length, list(noBeats), 'warn');
  const missingCore = ['premise', 'themes'].filter((k) => !arr(story[k]).length) .concat(arr(story.world?.facts).length ? [] : ['world.facts']);
  chk('premise, themes and world facts stated', !missingCore.length, missingCore.length ? 'missing ' + missingCore.join(', ') : 'ok', 'warn');

  // ---- originality
  const corpus = [];
  const walk = (v) => { if (typeof v === 'string') corpus.push(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  walk(story);
  const text = corpus.join('\n');
  const hits = FRANCHISE_BLOCKLIST.filter((n) => new RegExp(`(^|[^\\w])${n.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}($|[^\\w])`).test(text));
  chk('original IP (no known franchise names)', !hits.length, hits.length ? 'found: ' + hits.join(', ') : 'ok');

  // ---- playthroughs
  const playthroughs = [];
  if (simulate && !errors.length) {
    // flags a branch depends on (conditions on the choices/nodes that set it), so a targeted run can reach it
    const prereq = (flag, seen = new Set()) => { if (seen.has(flag)) return []; seen.add(flag); const ks = Object.values(allNodes).flatMap((i) => [...(setsFlag(i.node.do, flag) ? condKeys(i.node.if) : []), ...(i.node.choices || []).filter((ch) => setsFlag(ch.do, flag)).flatMap((ch) => condKeys(ch.if))]).filter((k) => !ENGINE_PREFIX.test(k)); return [flag, ...ks.flatMap((k) => prereq(k, seen))]; };
    const runs = [{ choose: 'first' }, { choose: 'last' }, ...[...new Set(branches.map((b) => b.flag))].map((f) => ({ prefer: prereq(f) }))];
    for (const r of runs) { try { playthroughs.push(simulatePlaythrough(out, r)); } catch (e) { playthroughs.push({ ended: false, strategy: r.prefer ? `prefer:${r.prefer[0]}` : r.choose, error: e.message, stuck: [], notStarted: [], completed: [], choices: [], lines: 0, flags: {}, problems: [] }); } }
    const failed = playthroughs.filter((p) => !p.ended).map((p) => `${p.strategy}: ${p.error || [p.stuck.length ? 'stuck in ' + p.stuck.map((s) => `${s.mission}[${s.open.join(',')}]`).join(', ') : '', p.notStarted.length ? 'never started ' + p.notStarted.join(', ') : '', p.problems[0] || ''].filter(Boolean).join('; ') || 'no progress'}`);
    chk('simulated playthroughs reach the ending (first, last, every branch)', !failed.length, failed.length ? list(failed, 4) : `${playthroughs.length}/${playthroughs.length} runs end`);
    const taken = branches.filter((b) => playthroughs.some((p) => p.ended && p.flags[b.flag] !== undefined && p.flags[b.flag] !== false));
    if (branches.length) chk('every branch is playable to the ending', taken.length === branches.length, `${taken.length}/${branches.length}${taken.length < branches.length ? ' — not reached: ' + branches.filter((b) => !taken.includes(b)).map((b) => b.flag).join(', ') : ''}`);
    const loopProblems = playthroughs.flatMap((p) => p.problems.filter((x) => /loop/.test(x)));
    if (loopProblems.length) chk('no infinite dialogue loops in playthroughs', false, list([...new Set(loopProblems)]));
  } else if (simulate) chk('simulated playthroughs reach the ending (first, last, every branch)', false, 'skipped: fix compile errors first');

  // ---- mission graph data
  graph.missions = ctx.missions.filter((m) => m?.id && ctx.missionById[m.id] === m).map((m) => ({ id: m.id, title: m.title || m.id, act: m.act ?? null, optional: !!m.optional, giver: m.giver || null, requires: arr(m.requires), starts: Object.entries(starts).filter(([, ws]) => ws.some((w) => ctx.convs.some((c) => c.mission === m.id && w.startsWith(c.id + '#')))).map(([q]) => q).filter((q) => q !== m.id), branches: arr(m.branches).map((b) => b?.id) }));
  const metrics = { title: out.title, characters: ctx.chars.length, mainCharacters: ctx.chars.filter(isMain).length, missions: ctx.missions.length, acts: out.acts.length, conversations: ctx.convs.length, nodes: Object.keys(allNodes).length,
    lines: totalLines, choicePoints: totalChoices, options: totalOptions, words: totalWords, wordsPerLine: totalLines ? +(totalWords / totalLines).toFixed(1) : 0, branches: branches.length, flags: Object.keys({ ...sets, ...reads }).length,
    meaningfulChoiceRatio: totalOptions ? +(graph.conversations.flatMap((c) => c.edges).filter((e) => e.kind === 'choice' && (e.acts > 0 || allNodes[e.to]?.node.do?.some((a) => !String(a).startsWith('set seen:')))).length / totalOptions).toFixed(2) : 0,
    perMission, flagTable: Object.fromEntries(Object.keys({ ...sets, ...reads }).sort().map((k) => [k, { setBy: sets[k] || [], readBy: reads[k] || [], doc: out.meta.flagDocs[k]?.desc || '' }])) };
  const ok = checks.every((c) => c.pass || c.level === 'warn');
  return { ok, checks, metrics, compiled: errors.length ? null : out, partial: out, errors, graph, playthroughs, branches };
}
