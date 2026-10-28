import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compileStory, analyzeStory, simulatePlaythrough, applyStoryToSpec, StoryError, STORY_FORMAT, ENEMY_TYPE_IDS } from '../../engine/gameplay/story.js';
import { Flags, QuestSystem, DialogueSystem } from '../../engine/gameplay/narrative.js';
import { ENEMY_TYPES } from '../../engine/gameplay/actors.js';
import heist from '../../skills/gameforge/stories/heist.story.js';

// A minimal, clean story; each defect test mutates a fresh copy.
const base = () => ({
  id: 'mini', title: 'Mini', premise: 'A courier must deliver a letter.', themes: ['duty'], world: { facts: ['It rains.'], locations: [{ id: 'dock', kind: 'camp', at: 'east' }] },
  items: { letter: { name: 'Letter' } },
  characters: [
    { id: 'hero', name: 'Hero', role: 'protagonist', want: 'w', need: 'n', flaw: 'f', arc: 'a', voice: 'v' },
    { id: 'ana', name: 'Ana', role: 'mentor', want: 'w', need: 'n', flaw: 'f', arc: 'a', voice: 'v' },
  ],
  missions: [
    { id: 'm1', title: 'Letter', giver: 'ana', beats: ['b'], objectives: [{ id: 'get', type: 'collect', target: 'letter', text: 'Get the letter' }, { id: 'go', type: 'reach', target: 'dock', text: 'Go to the dock', after: ['get'] }],
      branches: [{ id: 'kind', flag: 'kind', foldback: 'm2' }, { id: 'rude', flag: 'rude', foldback: 'm2' }],
      dialogue: [{ id: 'ana_offer', with: 'ana', when: 'offer', script: '# start\nAna: Take this letter.\n> Gladly. -> ok {do: set kind; start m1}\n> Fine. -> ok {do: set rude; start m1}\n# ok\nAna: Go.\n-> end' }] },
    { id: 'm2', title: 'Reply', giver: 'ana', requires: ['m1'], start: 'auto', beats: ['b'], objectives: [{ id: 'talk', type: 'talk', target: 'ana', text: 'Report back' }],
      dialogue: [{ id: 'ana_end', with: 'ana', when: 'complete', script: '# start\n@if: kind\n@else: cold\n-> warm\n# warm\nHero: Delivered.\n-> thanks\n# thanks\nAna: Thank you.\n> You are welcome. -> end\n# cold\nAna: Hm.\n> Bye. -> end\n> Sorry I was rude. -> end [if rude]' }] },
  ],
});
const fails = (r) => r.checks.filter((c) => !c.pass && c.level !== 'warn').map((c) => c.name);
const warns = (r) => r.checks.filter((c) => !c.pass && c.level === 'warn').map((c) => c.name);
const failsWith = (story, re) => { const r = analyzeStory(story); assert.ok(fails(r).some((n) => re.test(n)), `expected FAIL ${re}, got FAIL [${fails(r).join(' | ')}]`); return r; };

test('compiler output shape: quests, merged per-NPC dialogue graphs, npcs, landmarks, ending', () => {
  const c = compileStory(base());
  assert.equal(c.format, STORY_FORMAT);
  assert.deepEqual(c.quests.map((q) => q.id), ['m1', 'm2']);
  assert.deepEqual(c.quests[1].requires, ['quest:m1:complete']);
  assert.deepEqual(c.autoStart, ['m2']);
  assert.ok(c.dialogues.ana.nodes['ana_offer__start'] && c.dialogues.ana.nodes['ana_end__warm'] && c.dialogues.ana.nodes['ana__idle']);
  assert.ok(Array.isArray(c.dialogues.ana.start) && c.dialogues.ana.start.at(-1).node === 'ana__idle');
  assert.deepEqual(c.npcs.map((n) => n.id), ['ana']);
  assert.equal(c.landmarks[0].id, 'dock');
  assert.deepEqual(c.ending.quests, ['m1', 'm2']);
  // engine data runs in the real systems
  const flags = new Flags(), quests = new QuestSystem(flags), d = new DialogueSystem({ flags, quests });
  quests.define(c.quests); d.define('ana', c.dialogues.ana);
  d.start('ana'); assert.equal(d.current().node, 'ana_offer__start'); d.advance(); d.advance(0);
  assert.equal(quests.status('m1'), 'active'); assert.equal(flags.get('kind'), true);
  assert.equal(flags.get('seen:ana_offer'), true);
  quests.report('collect', 'letter'); assert.equal(flags.get('quest:m1:get'), true, 'objective flags are set');
});

test('compile errors are clear and aggregated', () => {
  const s = base(); s.missions[0].giver = 'nobody'; s.missions[1].requires = ['m9']; s.missions[0].objectives[0].type = 'teleport';
  assert.throws(() => compileStory(s), (e) => e instanceof StoryError && e.errors.length === 3 && /unknown character "nobody"/.test(e.message) && /unknown mission "m9"/.test(e.message) && /type must be one of/.test(e.message));
  assert.throws(() => compileStory(null), /export default/);
});

test('clean mini story passes every check', () => {
  const r = analyzeStory(base());
  assert.deepEqual(fails(r), []); assert.deepEqual(warns(r), []);
  assert.ok(r.playthroughs.length >= 4 && r.playthroughs.every((p) => p.ended));
});

test('each validation detects a seeded defect', () => {
  let s = base(); s.missions[0].dialogue[0].script += '\n# orphan\nAna: Nobody reaches me.\n-> end'; failsWith(s, /reachable/);
  s = base(); s.missions[0].dialogue[0].script = s.missions[0].dialogue[0].script.replace('-> ok {do: set rude', '-> nowhere {do: set rude'); failsWith(s, /undefined jump/);
  s = base(); s.missions[0].dialogue[0].script = s.missions[0].dialogue[0].script.replace('Ana: Go.\n-> end', 'Ana: Go.'); failsWith(s, /dead ends/);
  s = base(); s.missions[0].dialogue[0].script = s.missions[0].dialogue[0].script.replace('Ana: Go.\n-> end', 'Ana: Go.\n-> loop\n# loop\nAna: Again.\n-> ok'); failsWith(s, /traps/);
  s = base(); s.missions[1].dialogue[0].script = s.missions[1].dialogue[0].script.replace('@if: kind', '@if: kind_typo'); failsWith(s, /flags read are set/);
  s = base(); s.missions[0].dialogue[0].script = s.missions[0].dialogue[0].script.replace('set rude; ', 'set rude; set unused_flag; '); assert.ok(warns(analyzeStory(s)).some((n) => /flags set are read/.test(n)));
  s = base(); s.missions[0].objectives[1].target = 'moon'; failsWith(s, /objective can complete/);
  s = base(); s.missions[0].objectives.push({ id: 'k', type: 'kill', target: 'dragon', text: 'Slay' }); failsWith(s, /objective can complete/);
  s = base(); s.missions[0].requires = ['m2']; failsWith(s, /cycles/);
  s = base(); s.missions[0].dialogue[0].script = s.missions[0].dialogue[0].script.replace(/start m1/g, 'set started'); failsWith(s, /mission can start/);
  s = base(); s.missions[0].branches.push({ id: 'evil', flag: 'evil', foldback: 'm2' }); failsWith(s, /branches covered/);
  s = base(); s.missions[0].branches[0].foldback = undefined; failsWith(s, /fold back/);
  s = base(); s.missions[0].dialogue[0].script = s.missions[0].dialogue[0].script.replace('Ana: Go.', 'Stranger: Go.'); failsWith(s, /speaker is a defined character/);
  s = base(); delete s.characters[1].arc; failsWith(s, /want \/ need \/ flaw \/ arc/);
  s = base(); s.missions[0].dialogue[0].script = s.missions[0].dialogue[0].script.replace('Ana: Go.', 'Ana: ' + 'word '.repeat(35)); assert.ok(warns(analyzeStory(s)).some((n) => /≤ 30 words/.test(n)));
  s = base(); s.premise = 'A courier in Night City.'; failsWith(s, /original IP/);
  s = base(); s.missions[1].dialogue[0].script = s.missions[1].dialogue[0].script.replace(/> You are welcome\. -> end/, '> You are welcome. -> end {do: start ghost}'); failsWith(s, /reference existing/);
  // a branch that can only be reached through a flag nothing sets -> no playthrough reaches it
  s = base(); s.missions[0].dialogue[0].script = s.missions[0].dialogue[0].script.replace('> Fine. -> ok {do: set rude; start m1}', '> Fine. -> ok [if never] {do: set rude; start m1}'); { const r = analyzeStory(s); assert.ok(fails(r).some((n) => /flags read are set/.test(n))); assert.ok(fails(r).some((n) => /branch is playable/.test(n))); }
  // a mission whose objective waits on a flag nobody sets: static and simulated checks both fail
  s = base(); s.missions[1].objectives = [{ id: 'f', type: 'flag', target: 'never_set', text: 'Wait' }]; { const r = analyzeStory(s); assert.ok(fails(r).some((n) => /objective can complete/.test(n))); assert.ok(fails(r).some((n) => /playthroughs reach the ending/.test(n))); }
});

test('example heist story passes the review with real branching', () => {
  const r = analyzeStory(heist);
  assert.deepEqual(fails(r), [], r.checks.filter((c) => !c.pass).map((c) => c.name + ': ' + c.detail).join('\n'));
  assert.ok(r.metrics.missions >= 7 && r.metrics.branches >= 8 && r.metrics.acts === 3);
  const ends = new Set(r.playthroughs.filter((p) => p.ended).map((p) => ['ending_leak', 'ending_sale', 'ending_witness'].find((f) => p.flags[f])));
  assert.equal(ends.size, 3, 'all three endings reachable');
  const p = simulatePlaythrough(compileStory(heist), { choose: 'first' });
  assert.ok(p.ended && p.completed.includes('low_tide'));
});

test('composer spec integration and enemy list sync', () => {
  const spec = applyStoryToSpec({ title: 'T', npcs: [{ id: 'teo', name: 'Teo (custom)' }], story: heist });
  assert.equal(spec.story.format, STORY_FORMAT);
  assert.ok(spec.quests.some((q) => q.id === 'regatta') && spec.landmarks.some((l) => l.id === 'crane_tower'));
  const teo = spec.npcs.find((n) => n.id === 'teo'); assert.equal(teo.name, 'Teo (custom)'); assert.ok(teo.dialogue?.nodes);
  assert.equal(spec.goal.type, 'quests');
  const again = applyStoryToSpec({ title: 'T2', story: compileStory(heist) }); assert.equal(again.quests.length, 9);
  assert.deepEqual([...ENEMY_TYPE_IDS].sort(), Object.keys(ENEMY_TYPES).sort());
});

test('gameforge story CLI writes graph, bible and compiled data', async () => {
  const { reviewStory } = await import('../../tools/story.mjs');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'gfs-'));
  const r = await reviewStory(new URL('../../skills/gameforge/stories/heist.story.js', import.meta.url).pathname, { out, render: false, quiet: true });
  assert.ok(r.ok);
  for (const f of ['heist.graph.svg', 'heist.bible.md', 'heist.compiled.json', 'heist.story.json']) assert.ok(fs.existsSync(path.join(out, f)), f);
  const bible = fs.readFileSync(path.join(out, 'heist.bible.md'), 'utf8');
  for (const s of ['## Characters', '## Flags', '## Simulated playthroughs', 'Ines Rook']) assert.ok(bible.includes(s), s);
});
