#!/usr/bin/env node
// Renders agent definitions and packages the portable skill.
//   node tools/build-skill.mjs                 -> .claude/agents/*.md, skills/gameforge/agents/*.md, references/agents.md, .claude/skills/gameforge
//   node tools/build-skill.mjs --package DIR   -> self-contained skill (SKILL.md + references + agents + runtime/) in DIR/gameforge
//   node tools/build-skill.mjs --install claude|codex|both   -> package into ~/.claude/skills and/or ~/.agents/skills
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { AGENTS } from './lib/agents-def.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SKILL = path.join(ROOT, 'skills/gameforge');
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : undefined; };

const body = (a) => `# ${a.title}

${a.desc}

## Inputs
${a.inputs}

## Outputs
${a.outputs}

## File ownership
You may write only: **${a.owns}**. Read anything. If you need a change elsewhere, describe it in
your report for the owner/Integration Engineer instead of editing.

## Procedure
${a.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}

## Acceptance criteria
${a.accept.map((s) => `- [ ] ${s}`).join('\n')}

## Studio rules
- GameForge runtime: \`node <GF>/tools/gameforge.mjs\` (validate, playtest, build, shot). Engine API: skills/gameforge/references/engine-api.md.
- Simulation-time logic only (dt, \`app.after\`), relative imports only, no network, no external assets.
- Never claim success without a passing check; report exact commands and results.
- Original content only: AAA references are quality targets, never sources.
`;

fs.mkdirSync(path.join(ROOT, '.claude/agents'), { recursive: true });
fs.mkdirSync(path.join(SKILL, 'agents'), { recursive: true });
for (const a of AGENTS) {
  fs.writeFileSync(path.join(ROOT, '.claude/agents', `${a.id}.md`), `---\nname: ${a.id}\ndescription: ${JSON.stringify(a.desc + " (GameForge studio role)")}\ntools: ${a.tools}\n---\n\n${body(a)}`);
  fs.writeFileSync(path.join(SKILL, 'agents', `${a.id}.md`), body(a));
}
fs.writeFileSync(path.join(SKILL, 'agents', 'openai.yaml'), `# Codex skill metadata (experimental; see docs/PORTABILITY.md)\ninterface:\n  display_name: "GameForge"\n  short_description: "Autonomous game studio: build playable 3D browser games"\n  default_prompt: "Use $gameforge to build a playable game: "\n`);
const table = AGENTS.map((a) => `| ${a.title} | \`${a.id}\` | ${a.owns} | ${a.accept[0]} |`).join('\n');
fs.writeFileSync(path.join(SKILL, 'references/agents.md'), `# Studio roles

17 specialists. Claude Code loads them from \`.claude/agents/<id>.md\` (subagents); other runners use
\`agents/<id>.md\` as role briefs and execute them sequentially. Tasks in \`tasks.json\` name the role.

| Role | id | Owns | Key acceptance |
|---|---|---|---|
${table}

## Dispatch protocol
1. Director reads \`tasks.json\`, picks the lowest wave with pending tasks.
2. For each task: spawn the role with \`{ task, owned files, acceptance, references }\` and the rule
   "edit only owned files". Tasks in one wave never share files (\`gameforge plan\` validates this).
3. When the wave finishes: \`validate\` → \`playtest\` → update statuses → next wave.
4. A failing check goes back to the owner with the failing step + state dump; max 5 rounds,
   then mark the task \`blocked\` with the reason and continue with independent work.

${AGENTS.map((a) => `## ${a.title} (\`${a.id}\`)\n${a.desc}\n\n- **Inputs:** ${a.inputs}\n- **Outputs:** ${a.outputs}\n- **Owns:** ${a.owns}\n- **Accept:** ${a.accept.join('; ')}`).join('\n\n')}
`);
// In-repo Claude Code skill (uses repo root as runtime)
const inRepo = path.join(ROOT, '.claude/skills/gameforge');
fs.rmSync(inRepo, { recursive: true, force: true });
fs.mkdirSync(inRepo, { recursive: true });
for (const f of ['SKILL.md']) fs.copyFileSync(path.join(SKILL, f), path.join(inRepo, f));
fs.cpSync(path.join(SKILL, 'references'), path.join(inRepo, 'references'), { recursive: true });
fs.cpSync(path.join(SKILL, 'agents'), path.join(inRepo, 'agents'), { recursive: true });
console.log(`rendered ${AGENTS.length} agents -> .claude/agents, skills/gameforge/agents; synced .claude/skills/gameforge`);

function packageTo(dest) {
  const out = path.join(dest, 'gameforge');
  fs.rmSync(out, { recursive: true, force: true });
  fs.cpSync(SKILL, out, { recursive: true });
  for (const d of ['engine', 'tools', 'templates']) fs.cpSync(path.join(ROOT, d), path.join(out, 'runtime', d), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'LICENSE'), path.join(out, 'LICENSE'));
  fs.copyFileSync(path.join(ROOT, 'THIRD_PARTY_NOTICES.md'), path.join(out, 'THIRD_PARTY_NOTICES.md'));
  console.log('packaged skill -> ' + out);
  return out;
}
if (opt('package')) packageTo(path.resolve(opt('package')));
const inst = opt('install');
if (inst) {
  if (inst === 'claude' || inst === 'both') packageTo(path.join(os.homedir(), '.claude/skills'));
  if (inst === 'codex' || inst === 'both') packageTo(path.join(os.homedir(), '.agents/skills'));
}
