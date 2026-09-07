#!/usr/bin/env bash
set -euo pipefail

# 🐻 Kuma — Universal Installation Script
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/plumpslabs/kuma/main/install.sh | bash
#   curl -fsSL ... | bash -s -- --target /path
#   ./install.sh                # from cloned repo

GH_RAW="https://raw.githubusercontent.com/plumpslabs/kuma/main"
HERE="$(cd "$(dirname "$0")" 2>/dev/null && pwd || echo "")"
CLONED=false
[ -n "$HERE" ] && [ -f "$HERE/package.json" ] && [ -f "$HERE/dist/index.js" ] && CLONED=true

TARGET="${PWD}"
f=""; for a in "$@"; do [ "$f" = "--target" ] && TARGET="$a" && break; f="$a"; done

GLOBAL=false
for a in "$@"; do [ "$a" = "--global" ] && GLOBAL=true && break; done

ALL=false
for a in "$@"; do [ "$a" = "--all" ] && ALL=true && break; done

echo "🐻 Kuma Safety Engine — Installer"
echo "Target: $TARGET"
$CLONED && echo "Source: local repo" || echo "Source: remote repo"
echo ""

# 1. Verify Node.js
if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js is required but not found. Please install Node.js >= 18." >&2
  exit 1
fi

NODE_MAJOR=$(node -v | cut -d'.' -f1 | tr -d 'v')
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "❌ Node.js >= 18 is required. Current version: $(node -v)" >&2
  exit 1
fi
echo "✅ Node.js $(node -v) detected"

# 2. Global CLI Install (if requested or missing)
if $GLOBAL; then
  echo "📦 Installing @plumpslabs/kuma globally..."
  if command -v npm >/dev/null 2>&1; then
    npm install -g @plumpslabs/kuma
  elif command -v pnpm >/dev/null 2>&1; then
    pnpm add -g @plumpslabs/kuma
  fi
fi

# 3. Initialize target repository
echo "🔧 Configuring AI agent environments in $TARGET..."

mkdir -p "$TARGET"
if $CLONED; then
  (cd "$TARGET" && node "$HERE/dist/index.js" init --merge ${ALL:+--all})
else
  (cd "$TARGET" && npx -y @plumpslabs/kuma init --merge ${ALL:+--all})
fi

# 4. Configure MCP for detected environments (non-destructive merge)
echo ""
echo "🔌 Configuring MCP Server integrations..."

merge_mcp_config() {
  local mcp_path="$1"
  local label="$2"
  node -e "
    const fs = require('fs');
    let data = {};
    if (fs.existsSync('$mcp_path')) {
      try { data = JSON.parse(fs.readFileSync('$mcp_path', 'utf-8')); } catch(e) {}
    }
    data.mcpServers = data.mcpServers || {};
    if (!data.mcpServers.kuma) {
      data.mcpServers.kuma = { command: 'npx', args: ['-y', '@plumpslabs/kuma'] };
      fs.writeFileSync('$mcp_path', JSON.stringify(data, null, 2) + '\n', 'utf-8');
      console.log('  ✅ Added kuma to $label ($mcp_path)');
    } else {
      console.log('  ℹ️  kuma already registered in $label');
    }
  "
}

# Claude Code / Desktop
if [ -d "$TARGET/.claude" ] || [ -f "$TARGET/CLAUDE.md" ]; then
  mkdir -p "$TARGET/.claude"
  merge_mcp_config "$TARGET/.mcp.json" "Claude Code"
fi

# Cursor
if [ -d "$TARGET/.cursor" ] || [ -f "$TARGET/.cursorrules" ]; then
  mkdir -p "$TARGET/.cursor"
  merge_mcp_config "$TARGET/.cursor/mcp.json" "Cursor"
fi

# Antigravity / Gemini CLI
if [ -d "$TARGET/.agents" ] || [ -f "$TARGET/GEMINI.md" ]; then
  mkdir -p "$TARGET/.agents"
  merge_mcp_config "$TARGET/.agents/mcp_config.json" "Antigravity"
fi

# OpenCode
if [ -d "$TARGET/.opencode" ] || [ -f "$TARGET/opencode.json" ] || [ -f "$TARGET/opencode.jsonc" ]; then
  OPENCODE_CONF="$TARGET/opencode.json"
  node -e "
    const fs = require('fs');
    let data = { '\$schema': 'https://opencode.ai/config.json' };
    const confPath = fs.existsSync('$TARGET/opencode.jsonc') ? '$TARGET/opencode.jsonc' : '$OPENCODE_CONF';
    if (fs.existsSync(confPath)) {
      try { data = JSON.parse(fs.readFileSync(confPath, 'utf-8')); } catch(e) {}
    }
    data.mcp = data.mcp || {};
    if (!data.mcp.kuma) {
      data.mcp.kuma = { type: 'local', command: ['npx', '-y', '@plumpslabs/kuma'], enabled: true };
      fs.writeFileSync(confPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
      console.log('  ✅ Added kuma to OpenCode (' + confPath + ')');
    } else {
      console.log('  ℹ️  kuma already registered in OpenCode');
    }
  "
fi

echo ""
echo "🎉 Kuma setup complete!"
echo "• Rules & hooks: Active in target configuration files"
echo "• MCP tools: kuma_context, kuma_memory, kuma_safety ready"
echo "• Studio dashboard: run 'npx @plumpslabs/kuma studio' to visualize"
