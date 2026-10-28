#!/usr/bin/env sh
# GameForge AAA one-command installer.
#   curl -fsSL https://raw.githubusercontent.com/m2gsg7rf22-cmd/-/gameforge-aaa/install.sh | sh
# Options (env): GF_TARGET=claude|codex|both (default: both)  GF_HOME=~/.gameforge  GF_REPO=<git url or local dir>
# Needs: git, Node.js >= 18. Installs the skill (+ runtime) into ~/.claude/skills/gameforge and/or
# ~/.agents/skills/gameforge and the 17 specialist subagents into ~/.claude/agents. No npm packages.
set -e
GF_HOME="${GF_HOME:-$HOME/.gameforge}"
GF_REPO="${GF_REPO:-https://github.com/m2gsg7rf22-cmd/-.git}"
GF_BRANCH="${GF_BRANCH:-gameforge-aaa}"
GF_TARGET="${GF_TARGET:-both}"
command -v node >/dev/null 2>&1 || { echo "GameForge needs Node.js >= 18 (https://nodejs.org)"; exit 1; }
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 18 ] || { echo "Node.js >= 18 required (found $(node -v))"; exit 1; }
if [ -d "$GF_REPO" ]; then
  echo "▶ using local checkout $GF_REPO"; SRC="$GF_REPO"
else
  command -v git >/dev/null 2>&1 || { echo "git is required"; exit 1; }
  if [ -d "$GF_HOME/.git" ]; then echo "▶ updating $GF_HOME"; git -C "$GF_HOME" pull --ff-only -q;
  else echo "▶ cloning GameForge into $GF_HOME"; git clone -q --depth 1 --branch "$GF_BRANCH" "$GF_REPO" "$GF_HOME"; fi
  SRC="$GF_HOME"
fi
node "$SRC/tools/build-skill.mjs" --install "$GF_TARGET"
node "$SRC/tools/gameforge.mjs" doctor || true
echo ""
echo "✔ GameForge installed. In Claude Code: /gameforge <describe your game>   ·   Codex: \$gameforge <request>"
echo "  Optional (automated playtests): npm i -g playwright && npx playwright install chromium"
