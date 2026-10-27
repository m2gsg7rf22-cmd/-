# Using GameForge with different agents

| Runner | Install | Invoke | Parallel agents | Status |
|---|---|---|---|---|
| Claude Code (this repo) | nothing — `.claude/skills/gameforge` and `.claude/agents/*` are checked in | `/gameforge <request>` | yes (Agent tool + 17 subagents) | tested |
| Claude Code (global) | `node tools/build-skill.mjs --install claude` → `~/.claude/skills/gameforge` (includes `runtime/`) | `/gameforge <request>` | subagents only if you also copy `.claude/agents/*` to `~/.claude/agents/` | packaging tested; global invocation not tested |
| Codex | `node tools/build-skill.mjs --install codex` → `~/.agents/skills/gameforge`, or open this repo (AGENTS.md) | `$gameforge <request>` or "use the gameforge skill" | sequential waves (role briefs in `agents/`) | experimental, not run |
| Any shell-capable agent | `node tools/build-skill.mjs --package ./out` and point the agent at `out/gameforge/SKILL.md` | paste SKILL.md or reference it | sequential | experimental |
| Claude.ai / API skills upload | zip `out/gameforge` (SKILL.md at root) | by name | n/a | not tested; needs a code-execution sandbox with Node ≥18 |

## Capability detection & fallbacks
`gameforge doctor` writes `capabilities.json`:
- **No Playwright/Chromium** → playtests skipped; agent must still run `validate` + `build` and
  tell the user to open `dist/<id>.html`. (Install: `npm i -D playwright && npx playwright install chromium`.)
- **Software WebGL** → use `--quality low` for tests and never report fps as performance.
- **No subagents** → run `tasks.json` waves sequentially; ownership rules still apply.
- **No git** → nothing changes; checkpoints are just files.

## Runtime requirements
- Development/tooling: Node.js ≥ 18 (no npm packages required).
- Players: any modern browser with WebGL2 (Chrome/Edge/Firefox/Safari 15+). Games are single
  HTML files and work offline from `file://`.
