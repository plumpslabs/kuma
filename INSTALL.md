# 🐻 Kuma — Complete Installation & Provider Setup Guide

> Universal guide to installing and configuring **Kuma MCP** for every major AI coding agent and IDE.

---

## ⚡ Quick Start (Universal)

The fastest way to install Kuma in any repository:

```bash
# 1-Liner auto-detect installer (auto-configures rules, hooks, and MCP)
curl -fsSL https://raw.githubusercontent.com/plumpslabs/kuma/main/install.sh | bash
```

Or via `npx` with zero installation:

```bash
# Auto-detects your IDE/agent and creates tailored rules & hooks
npx @plumpslabs/kuma init

# Or initialize for ALL supported providers at once
npx @plumpslabs/kuma init --all
```

---

## 🔌 Provider Setup Matrix

| Provider / IDE | Install Method | Config Files Generated | MCP Integration |
|---|---|---|---|
| **Claude Code** | Marketplace / `kuma init` | `CLAUDE.md`, `.claude/settings.json` (hooks) | `.mcp.json` / `~/.claude.json` |
| **Google Antigravity** | Plugin / `kuma init` | `.agents/rules/kuma.md`, `.agents/skills/`, `GEMINI.md` | `.agents/mcp_config.json` |
| **Cursor** | `kuma init --cursor` | `.cursor/rules/kuma.mdc`, `.cursorrules` | `.cursor/mcp.json` |
| **Windsurf** | `kuma init --windsurf` | `.windsurfrules`, `.windsurf/rules/kuma.md` | `~/.codeium/windsurf/mcp_config.json` |
| **OpenCode** | `kuma init --opencode` | `AGENTS.md`, `.opencode/plugins/kuma.js` | `opencode.json` (array command) |
| **GitHub Copilot** | `kuma init --copilot` | `.github/copilot-instructions.md`, `.github/skills/` | Extension settings |
| **Zed** | `kuma init` | `AGENTS.md` | `settings.json` (`context_servers`) |
| **Cline / Roo / Trae** | `kuma init --cline` | `.clinerules/kuma.md`, `.roo/rules/`, `.trae/rules/` | Cline MCP UI |
| **Codex (OpenAI)** | `kuma init --codex` | `AGENTS.md`, `.codex/config.toml` | Codex MCP config |
| **Aider** | `kuma init --aider` | `CONVENTIONS.md`, `.aider.conf.yml` | Native config |
| **Qwen / Kiro** | `kuma init --qwen --kiro` | `AGENTS.md`, `.kiro/steering/kuma.md` | Local config |

---

## 🟠 1. Claude Code

### Method A: Claude Code Marketplace (Recommended)
Add the Kuma marketplace and install the plugin directly:

```bash
/plugin marketplace add plumpslabs/kuma
/plugin install kuma@plumpslabs-kuma
```

### Method B: Via `kuma init`
Run inside your project directory:
```bash
npx @plumpslabs/kuma init --claude
```

This creates:
- `CLAUDE.md` — Project context and safety obedience guidelines.
- `.claude/settings.json` — PreToolUse hooks (`kuma hook pre-edit` and `kuma hook pre-bash`) that auto-inject known gotchas before file modifications.

### MCP Configuration
Add to `.mcp.json` in your project root or `~/.claude.json` globally:

```json
{
  "mcpServers": {
    "kuma": {
      "command": "npx",
      "args": ["-y", "@plumpslabs/kuma"]
    }
  }
}
```

---

## 🟣 2. Google Antigravity (AGY) / Gemini CLI

### Method A: Plugin Installation (System-Wide)
Install Kuma directly into your Antigravity plugins directory:

```bash
# Clone to Antigravity global plugins
git clone https://github.com/plumpslabs/kuma.git ~/.gemini/config/plugins/kuma
```
Or via AGY plugin command:
```bash
agy plugin add https://github.com/plumpslabs/kuma
```

Antigravity will automatically read `plugin.json`, mount the `kuma-mcp` skill, and launch Kuma via `mcp_config.json`.

### Method B: Per-Project via `kuma init`
```bash
npx @plumpslabs/kuma init --antigravity
```

This creates:
- `.agents/skills/kuma/SKILL.md` — Core workflow skill.
- `.agents/rules/kuma.md` — Antigravity behavioral safety rules.
- `GEMINI.md` — Root workspace instructions.
- `.agents/mcp_config.json` — Preconfigured MCP server configuration.

---

## ⚡ 3. Cursor

Run inside your project:
```bash
npx @plumpslabs/kuma init --cursor
```

### Files Created:
- `.cursor/rules/kuma.mdc` — Modern Cursor rule with XML delimiters and gotcha query triggers.
- `.cursorrules` — Fallback universal rule for all Cursor versions.

### MCP Configuration:
Create or edit `.cursor/mcp.json` in your workspace or global settings:
```json
{
  "mcpServers": {
    "kuma": {
      "command": "npx",
      "args": ["-y", "@plumpslabs/kuma"]
    }
  }
}
```

---

## 🌊 4. Windsurf

Run:
```bash
npx @plumpslabs/kuma init --windsurf
```

### Files Created:
- `.windsurfrules` — Cascade behavioral guidelines.
- `.windsurf/rules/kuma.md` — Detailed safety and gotcha workflow instructions.

### MCP Configuration:
Add to `~/.codeium/windsurf/mcp_config.json`:
```json
{
  "mcpServers": {
    "kuma": {
      "command": "npx",
      "args": ["-y", "@plumpslabs/kuma"]
    }
  }
}
```

---

## 🔵 5. OpenCode

Run:
```bash
npx @plumpslabs/kuma init --opencode
```

### Files Created:
- `AGENTS.md` — Shared agent instructions.
- `.opencode/plugins/kuma.js` — Native OpenCode plugin for pre-edit gotcha interception.
- `.opencode/skills/kuma/SKILL.md` — OpenCode skill with `kuma_kuma_*` prefixed actions.

### MCP Configuration:
Add to `opencode.json` in your project root:
```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "kuma": {
      "type": "local",
      "command": ["npx", "-y", "@plumpslabs/kuma"],
      "enabled": true
    }
  }
}
```
*(Note: OpenCode requires `command` to be an array containing the binary and its arguments together).*

---

## 🐙 6. GitHub Copilot Editor

Run:
```bash
npx @plumpslabs/kuma init --copilot
```

### Files Created:
- `.github/copilot-instructions.md` — Workspace instructions for Copilot Chat.
- `.github/skills/kuma/SKILL.md` — Copilot skills definition.

---

## ⚡ 7. Zed

Add to your Zed `settings.json`:
```json
{
  "context_servers": {
    "kuma": {
      "command": "npx",
      "args": ["-y", "@plumpslabs/kuma"]
    }
  }
}
```

---

## 🛡️ 8. Cline / Roo-Code / Trae

Run:
```bash
npx @plumpslabs/kuma init --cline
```

### Files Created:
- `.clinerules/kuma.md`
- `.roo/rules/kuma.md`
- `.trae/rules/kuma.md`

Configure the MCP server via Cline's MCP Settings UI:
- **Server Name:** `kuma`
- **Command:** `npx`
- **Args:** `["-y", "@plumpslabs/kuma"]`

---

## 🍵 Companion Mode: Kuma + Matcha

Kuma works standalone, but if you use [Matcha](https://github.com/plumpslabs/matcha):
- **Matcha** handles the cognitive planning gate, stack audits, and code review.
- **Kuma** handles runtime safety, blast radius impact analysis, gotchas memory, and post-edit verification.

Install both in 1 line:
```bash
curl -fsSL https://raw.githubusercontent.com/plumpslabs/matcha/main/install.sh | bash
curl -fsSL https://raw.githubusercontent.com/plumpslabs/kuma/main/install.sh | bash
```

---

## 📊 Kuma Studio Dashboard

To launch the web dashboard:
```bash
npx @plumpslabs/kuma studio
```
Access at `http://localhost:3322` to view:
- **Gotcha Shield** (filters, 1-click workaround copy)
- **Domain Sequence Flows**
- **Workspace & Blast Radius Simulator**
- **Health & Efficiency Metrics**
