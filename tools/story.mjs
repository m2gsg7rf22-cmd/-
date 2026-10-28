#!/usr/bin/env node
// Story review loop for agents: compile a *.story.js script, validate it, simulate playthroughs,
// draw the mission + dialogue graph and write a story bible.
//   node tools/gameforge.mjs story <file.story.js> [--out dir] [--no-render]
// A story script:  export default { premise, themes, world, items, characters, acts|missions, ending }
// See skills/gameforge/references/narrative.md. Output (in <out>, default <dir>/review):
//   <name>.graph.svg/.png  mission DAG + every conversation graph (defects in red)
//   <name>.bible.md        story bible (premise, cast, beats, branches, flag table, metrics, checks)
//   <name>.compiled.json   engine data (quests, dialogues, npcs, landmarks) — or use spec.story = script
//   <name>.story.json      metrics, checks and playthrough summaries
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clip = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

// Layered layout: column = BFS depth from the entry (or longest path for missions).
export function storyGraphSVG(analysis) {
  const g = analysis.graph; const W = 170, H = 46, GX = 40, GY = 16, PAD = 24;
  const parts = []; let y = PAD, width = 900;
  const box = (x, yy, w, h, fill, stroke, lines, dash) => parts.push(`<rect x="${x}" y="${yy}" width="${w}" height="${h}" rx="7" fill="${fill}" stroke="${stroke}" stroke-width="1.6"${dash ? ' stroke-dasharray="5 3"' : ''}/>` + lines.map((l, i) => `<text x="${x + 8}" y="${yy + 16 + i * 14}" font-size="${i ? 10.5 : 12}" fill="${i ? '#3b4252' : '#111'}"${i ? '' : ' font-weight="600"'}>${esc(l)}</text>`).join(''));
  const edge = (x1, y1, x2, y2, color, dash) => { const mx = (x1 + x2) / 2; parts.push(`<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" fill="none" stroke="${color}" stroke-width="1.4"${dash ? ' stroke-dasharray="4 3"' : ''} marker-end="url(#a)"/>`); };
  // ---- missions
  parts.push(`<text x="${PAD}" y="${y + 14}" font-size="16" font-weight="700">Missions (requires → ; dashed = started from dialogue / optional)</text>`); y += 28;
  const depth = {}; const ms = Object.fromEntries(g.missions.map((m) => [m.id, m]));
  const d = (id, seen = new Set()) => { if (depth[id] !== undefined) return depth[id]; if (seen.has(id)) return 0; seen.add(id); const m = ms[id]; return (depth[id] = m && m.requires.length ? 1 + Math.max(...m.requires.map((r) => d(r, seen))) : 0); };
  g.missions.forEach((m) => d(m.id));
  const cols = {}; for (const m of g.missions) (cols[depth[m.id]] ||= []).push(m);
  const pos = {};
  for (const [c, list] of Object.entries(cols)) list.forEach((m, i) => { pos[m.id] = { x: PAD + c * (W + GX), y: y + i * (H + GY) }; });
  const mh = Math.max(...Object.values(cols).map((l) => l.length)) * (H + GY);
  for (const m of g.missions) { for (const r of m.requires) if (pos[r]) edge(pos[r].x + W, pos[r].y + H / 2, pos[m.id].x, pos[m.id].y + H / 2, '#7a869a'); for (const s of m.starts) if (pos[s] && !m.requires.includes(s) && !ms[s]?.requires.includes(m.id)) edge(pos[m.id].x + W, pos[m.id].y + H / 2, pos[s].x, pos[s].y + H / 2, '#d08770', true); }
  for (const m of g.missions) box(pos[m.id].x, pos[m.id].y, W, H, m.optional ? '#f3efe6' : '#e6eef8', '#4c6a92', [clip(m.title, 24), clip(`${m.id}${m.act ? ' · ' + m.act : ''}${m.branches.length ? ' · ' + m.branches.length + ' branches' : ''}`, 30)], m.optional);
  width = Math.max(width, PAD * 2 + Object.keys(cols).length * (W + GX));
  y += mh + 20;
  // ---- conversations
  const CW = 150, CH = 40;
  for (const c of g.conversations) {
    const nodes = Object.fromEntries(c.nodes.map((n) => [n.id, n]));
    const lvl = {}; const q = [[c.entry, 0]];
    while (q.length) { const [k, l] = q.shift(); if (lvl[k] !== undefined || !nodes[k]) continue; lvl[k] = l; for (const e of c.edges.filter((e) => e.from === k)) q.push([e.to, l + 1]); }
    let maxL = Math.max(0, ...Object.values(lvl)); for (const n of c.nodes) if (lvl[n.id] === undefined) lvl[n.id] = ++maxL; // unreachable at the far right
    const byL = {}; for (const n of c.nodes) (byL[lvl[n.id]] ||= []).push(n);
    const rows = Math.max(...Object.values(byL).map((l) => l.length));
    const defects = c.nodes.filter((n) => n.defect).length;
    parts.push(`<text x="${PAD}" y="${y + 13}" font-size="13" font-weight="700" fill="${defects ? '#bf2c34' : '#222'}">${esc(c.id)}  <tspan font-weight="400" fill="#555">with ${esc(c.npc)} · ${esc(c.mission || 'story')} · when ${esc(Array.isArray(c.when) ? c.when.join(' & ') : c.when)}${defects ? ` · ${defects} defect(s)` : ''}</tspan></text>`);
    y += 20;
    const p = {}; const endX = PAD + (maxL + 1) * (CW + 26);
    for (const [l, list] of Object.entries(byL)) list.forEach((n, i) => { p[n.id] = { x: PAD + l * (CW + 26), y: y + i * (CH + 10) }; });
    for (const e of c.edges) {
      const a = p[e.from]; if (!a) continue;
      const b = e.to === 'end' ? { x: endX, y: a.y } : p[e.to];
      if (!b) { parts.push(`<text x="${a.x + CW + 4}" y="${a.y + 24}" font-size="10" fill="#bf2c34">→ ${esc(clip(e.to, 22))} ✗</text>`); continue; }
      edge(a.x + CW, a.y + CH / 2, b.x, b.y + CH / 2, e.kind === 'choice' ? (e.sets.length ? '#b48ead' : '#d4a72c') : e.kind === 'else' ? '#999' : '#5e81ac', e.kind === 'else');
    }
    if (c.edges.some((e) => e.to === 'end')) { const ys = c.edges.filter((e) => e.to === 'end').map((e) => p[e.from]?.y ?? y); for (const yy of new Set(ys)) parts.push(`<circle cx="${endX + 8}" cy="${yy + CH / 2}" r="7" fill="#434c5e"/><text x="${endX + 18}" y="${yy + CH / 2 + 4}" font-size="10" fill="#434c5e">end</text>`); }
    for (const n of c.nodes) {
      const fill = n.defect ? '#fbd9db' : n.kind === 'choice' ? '#fdf1cf' : n.kind === 'router' ? '#eceff4' : '#e5f0e8';
      box(p[n.id].x, p[n.id].y, CW, CH, fill, n.defect ? '#bf2c34' : '#8a94a6', [clip(n.local + (n.defect ? ` [${n.defect}]` : ''), 22), clip(n.kind === 'router' ? '(router)' : `${n.speaker ? n.speaker + ': ' : ''}${n.text}`, 26)]);
    }
    width = Math.max(width, endX + 60);
    y += rows * (CH + 10) + 18;
  }
  const legend = 'legend: green line · yellow choice · grey router · red defect · purple edge = choice sets a flag · dashed = else / dialogue start';
  parts.push(`<text x="${PAD}" y="${y + 10}" font-size="11" fill="#555">${legend}</text>`); y += 24;
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${y}" viewBox="0 0 ${width} ${y}" font-family="Helvetica, Arial, sans-serif"><defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#7a869a"/></marker></defs><rect width="100%" height="100%" fill="#fff"/>${parts.join('')}</svg>`, width, height: y };
}

export function storyBible(story, a) {
  const m = a.metrics, L = [];
  const lvl = (c) => (c.pass ? 'PASS' : c.level === 'warn' ? 'WARN' : 'FAIL');
  L.push(`# ${story.title || story.id} — Story Bible`, '', '> Generated by `gameforge story` from the story script. Design document; gameplay proof comes from playtests.', '');
  L.push(`**Premise.** ${story.premise || 'TBD'}`, '');
  if (story.logline) L.push(`**Logline.** ${story.logline}`, '');
  L.push(`**Themes.** ${[].concat(story.themes || []).join(' · ') || 'TBD'}`, '', `**Tone.** ${story.tone || 'TBD'}`, '');
  L.push('## World', '', story.world?.setting || '', '');
  for (const f of story.world?.facts || []) L.push(`- ${f}`);
  if (story.world?.locations?.length) { L.push('', '### Locations and environmental storytelling hooks (for the World Builder)', ''); for (const l of story.world.locations) L.push(`- **${l.name || l.id}** (\`${l.id}\`${l.kind ? `, ${l.kind} at ${l.at ?? `${l.x},${l.z}`}` : ''}) — ${l.desc || ''}${(l.hooks || []).length ? '\n' + l.hooks.map((h) => `  - ${h}`).join('\n') : ''}`); }
  L.push('', '## Characters', '', '| Character | Role | Want | Need | Flaw | Arc | Voice |', '|---|---|---|---|---|---|---|');
  for (const c of story.characters || []) L.push(`| **${c.name}** (\`${c.id}\`) | ${c.role || ''}${c.main ? ' (main)' : ''} | ${c.want || ''} | ${c.need || ''} | ${c.flaw || ''} | ${c.arc || ''} | ${c.voice || ''} |`);
  L.push('', '## Structure', '');
  const missions = [...(story.acts || []).flatMap((x) => (x.missions || []).filter((y) => typeof y === 'object')), ...(story.missions || [])];
  const actList = story.acts?.length ? story.acts : [{ title: 'Missions', missions }];
  for (const act of actList) {
    L.push(`### ${act.title || act.id}`, '', act.purpose ? `_${act.purpose}_\n` : '');
    for (const ms of (act.missions || []).map((x) => (typeof x === 'string' ? missions.find((y) => y.id === x) : x)).filter(Boolean)) {
      const pm = m.perMission?.[ms.id] || {};
      L.push(`#### ${ms.title} (\`${ms.id}\`)${ms.optional ? ' — optional' : ''}`, '', `${ms.summary || ''}`, '', `Giver: ${ms.giver || '—'} · requires: ${[].concat(ms.requires || []).join(', ') || '—'}${ms.requiresFlags ? ` · flags: ${[].concat(ms.requiresFlags).join(' & ')}` : ''}${ms.start === 'auto' ? ' · starts automatically' : ''} · ${pm.lines ?? 0} lines, ${pm.choices ?? 0} choice points, ${pm.wordsPerLine ?? 0} words/line`, '');
      if (ms.beats?.length) { L.push('Beats:'); ms.beats.forEach((b, i) => L.push(`${i + 1}. ${b}`)); L.push(''); }
      L.push('Objectives:'); for (const o of ms.objectives || []) L.push(`- [${o.type}${o.target ? ' ' + [].concat(o.target).join('|') : ''}${o.count > 1 ? ' ×' + o.count : ''}] ${o.text}${o.after ? ` _(after ${[].concat(o.after).join(', ')})_` : ''}`);
      if (ms.branches?.length) { L.push('', 'Branches:'); for (const b of ms.branches) L.push(`- **${b.id}** sets \`${b.flag}\` → ${b.consequence || ''} ${b.foldback ? `_(folds back at ${b.foldback})_` : b.ending ? '_(ending)_' : ''}`); }
      L.push('');
    }
  }
  L.push('## Flags (consequence tracking)', '', '| Flag | Meaning | Set by | Read by |', '|---|---|---|---|');
  for (const [k, f] of Object.entries(m.flagTable || {})) L.push(`| \`${k}\` | ${f.doc} | ${f.setBy.slice(0, 3).join('<br>')}${f.setBy.length > 3 ? '<br>…' : ''} | ${f.readBy.slice(0, 3).join('<br>')}${f.readBy.length > 3 ? '<br>…' : ''} |`);
  L.push('', '## Simulated playthroughs', '', '| Strategy | Ends | Missions completed | Choices made |', '|---|---|---|---|');
  for (const p of a.playthroughs) L.push(`| ${p.strategy} | ${p.ended ? 'yes' : '**no**'} | ${p.completed.length} | ${p.choices.map((c) => c.text).slice(0, 12).join(' / ')} |`);
  L.push('', '## Metrics', '', `${m.missions} missions · ${m.acts} acts · ${m.characters} characters (${m.mainCharacters} main) · ${m.conversations} conversations · ${m.lines} lines · ${m.choicePoints} choice points (${m.options} options) · ${m.wordsPerLine} words/line · ${m.branches} branches · ${m.flags} flags · meaningful-choice ratio ${m.meaningfulChoiceRatio}`, '');
  L.push('## Review checks', ''); for (const c of a.checks) L.push(`- ${lvl(c)} ${c.name} — ${c.detail}`);
  return L.join('\n') + '\n';
}

export async function reviewStory(file, { out, render = true, quiet = false } = {}) {
  file = path.resolve(file);
  const name = path.basename(file).replace(/\.story\.m?js$|\.m?js$/, '');
  out = path.resolve(out || path.join(path.dirname(file), 'review')); fs.mkdirSync(out, { recursive: true });
  const { analyzeStory } = await import(pathToFileURL(path.join(ROOT, 'engine/gameplay/story.js')).href);
  const story = (await import(pathToFileURL(file).href + '?t=' + Date.now())).default;
  const a = analyzeStory(story);
  const res = { name, file, ok: a.ok, metrics: a.metrics, checks: a.checks, playthroughs: a.playthroughs.map(({ transcript, ...p }) => p) };
  if (a.graph) {
    const { svg, width, height } = storyGraphSVG(a);
    res.graphSvg = path.join(out, name + '.graph.svg'); fs.writeFileSync(res.graphSvg, svg);
    if (render) {
      try {
        const { launchBrowser } = await import('./lib/playwright.mjs');
        const br = await launchBrowser(); const page = await br.newPage({ viewport: { width: Math.min(4000, Math.ceil(width)), height: Math.min(1200, Math.ceil(height)) } });
        await page.setContent(`<!doctype html><html><body style="margin:0;background:#fff">${svg}</body></html>`);
        res.graph = path.join(out, name + '.graph.png'); await page.screenshot({ path: res.graph, fullPage: true }); await br.close();
      } catch (e) { res.renderError = e.message.split('\n')[0]; a.checks.push({ name: 'graph PNG rendered (headless Chromium)', pass: false, detail: res.renderError + ' — open the .svg instead', level: 'warn' }); }
    }
  }
  if (a.compiled) { res.compiled = path.join(out, name + '.compiled.json'); fs.writeFileSync(res.compiled, JSON.stringify(a.compiled, null, 2)); }
  res.bible = path.join(out, name + '.bible.md'); fs.writeFileSync(res.bible, storyBible(story, a));
  fs.writeFileSync(path.join(out, name + '.story.json'), JSON.stringify(res, null, 2));
  if (!quiet) {
    const m = a.metrics;
    console.log(`▶ ${name}: ${m.missions ?? 0} missions · ${m.characters ?? 0} characters · ${m.conversations ?? 0} conversations · ${m.lines ?? 0} lines · ${m.choicePoints ?? 0} choice points · ${m.branches ?? 0} branches · ${m.wordsPerLine ?? 0} words/line`);
    if (m.perMission) for (const [id, p] of Object.entries(m.perMission)) console.log(`    · ${id}: ${p.lines} lines, ${p.choices} choices, ${p.wordsPerLine} w/line, ${p.objectives} objectives`);
    for (const c of a.checks) console.log(`  ${c.pass ? 'PASS' : c.level === 'warn' ? 'WARN' : 'FAIL'}  ${c.name}  (${c.detail})`);
    if (res.graph || res.graphSvg) console.log(`  graph: ${res.graph || res.graphSvg}   ← open it: mission DAG + every conversation (red = defect)`);
    console.log(`  bible: ${res.bible}`); if (res.compiled) console.log(`  compiled: ${res.compiled}`);
  }
  res.ok = a.checks.every((c) => c.pass || c.level === 'warn');
  return res;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
  const file = args.find((x, i) => !x.startsWith('--') && args[i - 1] !== '--out');
  if (!file) { console.log('usage: node tools/story.mjs <file.story.js> [--out dir] [--no-render]'); process.exit(1); }
  const r = await reviewStory(file, { out: opt('out'), render: !args.includes('--no-render') }); process.exitCode = r.ok ? 0 : 1;
}
