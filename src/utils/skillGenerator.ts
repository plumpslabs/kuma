// ============================================================
// SKILL GENERATOR — Generate AI agent skill files
// ============================================================
// Creates native skill/config files for all supported AI agents.
// Matches the exact file format each agent expects.
// ============================================================

import type { AgentType } from "./agentDetector.js";

// Shared bootstrap message — points to .kuma/init.md as single source of truth
const BOOTSTRAP = [
  "Kuma MCP tools are available (kuma_context, kuma_memory, kuma_safety).",
  "**Before coding, call `kuma_context({ action: \"init\" })`** to load project context and session memory.",
  "Project knowledge persists in `.kuma/memories/*.md` across sessions.",
  "",
  "⚠️ **MANDATORY WORKFLOW** — Follow in order every session (including research-only):",
  "",
  "  1. `kuma_context({ action: \"init\" })`                     — Load context (START HERE)",
  "  2. `kuma_safety({ action: \"guard\" })`                     — Safety check before work",
  "  3. `kuma_context({ action: \"research\", scope: \"<area>\" })` — Research before editing",
  "  4. *(edit/read using native tools)*",
  "  5. `kuma_memory({ action: \"research_save\", ... })`        — After exploring area (creates search cache)",
  "  6. `kuma_memory({ action: \"gotcha\" })`                    — 🔥 IMMEDIATELY when bug found (exponential value)",
  "  7. `kuma_memory({ action: \"arch_flow\" })`                 — 🔥 IMMEDIATELY after each flow hop (exponential value)",
  "  8. `kuma_memory({ action: \"decision\" })`                  — When choosing between options (preserves rationale)",
  "  9. `kuma_safety({ action: \"verify\", ... })`               — Run tests / confirm nothing broken",
  " 10. `kuma_context({ action: \"changes\" })`                  — Review session activity",
  "",
  "🔥 **Power Curve:** `arch_flow` + `gotcha` are EXPONENTIAL — each record saves 5-10 files next session.",
  "   The more you record, the more overpowered the agent becomes. These are the highest-value actions.",
  "🟢 **SKIP** recording function/class/component nodes — grep/glob is faster.",
  "🧠 Knowledge graph is persistent — nodes/edges accumulate across sessions, getting richer over time.",
  "",
  "⛔ Do NOT skip steps 5-10 after research — even if no code was changed.",
  "🗑️ **Delete/Clear:** `delete_node` (delete node/gotcha/todo/decision) | `clear` (wipe entire graph)",
  "📖 Full rules: `.kuma/init.md`",
  "🧠 Tools: `kuma_context` | `kuma_memory` | `kuma_safety`",
].join("\n");

// OpenCode-specific bootstrap — uses kuma_kuma_* prefix (OpenCode doubles the prefix)
const BOOTSTRAP_OPENCODE = [
  "Kuma MCP tools are available (kuma_kuma_context, kuma_kuma_memory, kuma_kuma_safety).",
  "**Before coding, call `kuma_kuma_context({ action: \"init\" })`** to load project context.",
  "Project knowledge persists in `.kuma/memories/*.md` across sessions.",
  "",
  "⚠️ **MANDATORY WORKFLOW** — Follow in order every session (including research-only):",
  "",
  "  1. `kuma_kuma_context({ action: \"init\" })`                     — Load context (START HERE)",
  "  2. `kuma_kuma_safety({ action: \"guard\" })`                     — Safety check before work",
  "  3. `kuma_kuma_context({ action: \"research\", scope: \"<area>\" })` — Research before editing",
  "  4. *(edit/read using native tools)*",
  "  5. `kuma_kuma_memory({ action: \"research_save\", ... })`        — After exploring area (creates search cache)",
  "  6. `kuma_kuma_memory({ action: \"gotcha\" })`                    — 🔥 IMMEDIATELY when bug found (exponential value)",
  "  7. `kuma_kuma_memory({ action: \"arch_flow\" })`                 — 🔥 IMMEDIATELY after each flow hop (exponential value)",
  "  8. `kuma_kuma_memory({ action: \"decision\" })`                  — When choosing between options (preserves rationale)",
  "  9. `kuma_kuma_safety({ action: \"verify\", ... })`               — Run tests / confirm nothing broken",
  " 10. `kuma_kuma_context({ action: \"changes\" })`                  — Review session activity",
  "",
  "🔥 **Power Curve:** `arch_flow` + `gotcha` are EXPONENTIAL — each record saves 5-10 files next session.",
  "   The more you record, the more overpowered the agent becomes. These are the highest-value actions.",
  "🟢 **SKIP** recording function/class/component nodes — grep/glob is faster.",
  "🧠 Knowledge graph is persistent — nodes/edges accumulate across sessions, getting richer over time.",
  "",
  "⛔ Do NOT skip steps 5-10 after research — even if no code was changed.",
  "🗑️ **Delete/Clear:** `delete_node` (delete node/gotcha/todo/decision) | `clear` (wipe entire graph)",
  "📖 Full rules: `.kuma/init.md`",
  "🧠 Tools: `kuma_kuma_context` | `kuma_kuma_memory` | `kuma_kuma_safety`",
].join("\n");

/**
 * Generate skill file content for a specific agent type.
 */
export function generateSkill(type: AgentType): string {
  switch (type) {
    case "claude":
      return generateClaudeSkill();
    case "cursor":
      return generateCursorSkill();
    case "cline":
      return generateClineSkill();
    case "antigravity":
      return generateAntigravitySkill();
    case "codex":
      return generateCodexSkill();
    case "opencode":
      return generateOpencodeSkill();
    case "aider":
      return generateAiderSkill();
    case "windsurf":
      return generateWindsurfSkill();
    case "copilot":
      return generateCopilotSkill();
    case "qwen":
      return generateQwenSkill();
    case "kiro":
      return generateKiroSkill();
    case "openclaw":
      return generateOpenclawSkill();
    case "codewhale":
      return generateCodewhaleSkill();
  }
}

/**
 * Get secondary files for agents that need multiple files.
 */
export function getSecondaryFiles(type: AgentType): Array<{ path: string; content: string }> {
  switch (type) {
    case "antigravity":
      return [{ path: ".agents/mcp_config.json", content: generateAntigravityMcpConfig() }];
    case "codex":
      return [{ path: ".codex/config.toml", content: generateCodexConfigToml() }];
    case "qwen":
      return [{ path: "settings.json", content: generateQwenSettings() }];
    case "aider":
      return [{ path: ".aider.conf.yml", content: generateAiderConfig() }];
    case "codewhale":
      return [{ path: ".codewhale/mcp.json", content: generateCodewhaleMcpConfig() }];
    default:
      return [];
  }
}

/**
 * Claude Code: `.claude/skills/kuma/SKILL.md`
 * Format: Folder-based skill with SKILL.md inside
 */
function generateClaudeSkill(): string {
  return [
    "---",
    "name: kuma-mcp",
    "description: Kuma MCP — safety toolkit for AI coding agents",
    "---",
    "",
    BOOTSTRAP,
    "",
    "📖 **Usage:**",
    "  • `kuma_context({ action: \"init\" })` — load project context (call first)",
    "  • `kuma_safety({ action: \"guard\" })` — safety check before risky ops",
    "  • `kuma_safety({ action: \"verify\", scope: \"<area>\" })` — verify after edits",
    "  • `.kuma/init.md` — full behavioral rules",
    "  • `.kuma/memories/` — persistent project knowledge",
  ].join("\n");
}

/**
 * Cursor: `.cursor/rules/kuma.mdc`
 * Format: Flat file with YAML frontmatter (alwaysApply: true)
 */
function generateCursorSkill(): string {
  return [
    "---",
    "description: Kuma MCP — safety and context runtime for AI agents",
    "alwaysApply: true",
    "---",
    "",
    BOOTSTRAP,
    "",
    "📖 **Usage:**",
    "  • `kuma_context({ action: \"init\" })` — load project context (call first)",
    "  • `kuma_safety({ action: \"guard\" })` — safety check before risky ops",
    "  • `kuma_safety({ action: \"verify\", scope: \"<area>\" })` — verify after edits",
    "  • `.kuma/init.md` — full behavioral rules",
    "  • `.kuma/memories/` — persistent project knowledge",
  ].join("\n");
}

/**
 * Cline: `.clinerules/kuma.md`
 * Format: Markdown with paths frontmatter
 */
function generateClineSkill(): string {
  return [
    "---",
    "description: Kuma MCP — safety toolkit for AI coding agents",
    "paths:",
    "  - \"*\"",
    "---",
    "",
    BOOTSTRAP,
    "",
    "📖 **Usage:**",
    "  • `kuma_context({ action: \"init\" })` — load project context (call first)",
    "  • `kuma_safety({ action: \"guard\" })` — safety check before risky ops",
    "  • `kuma_safety({ action: \"verify\", scope: \"<area>\" })` — verify after edits",
    "  • `.kuma/init.md` — full behavioral rules",
  ].join("\n");
}

/**
 * Antigravity CLI: `.agents/skills/kuma/SKILL.md`
 * Uses kuma_kuma_* prefix (same as OpenCode — .agents/ dir adds kuma_ prefix)
 */
function generateAntigravitySkill(): string {
  return [
    "---",
    "name: kuma-mcp",
    "description: Kuma MCP — safety toolkit for AI coding agents",
    "---",
    "",
    "⚠️ **Antigravity platform note:** Tool names use `kuma_kuma_*` prefix",
    "   (server name `kuma` + already-prefixed `kuma_context`).",
    "   Example: `kuma_kuma_context({ action: \"init\" })`",
    "",
    BOOTSTRAP_OPENCODE,
    "",
    "📖 Read `.kuma/init.md` for detailed rules.",
  ].join("\n");
}

/**
 * Antigravity MCP config: `.agents/mcp_config.json`
 */
function generateAntigravityMcpConfig(): string {
  return JSON.stringify({
    mcpServers: {
      kuma: {
        command: "npx",
        args: ["-y", "@plumpslabs/kuma"],
        env: {},
      },
    },
  }, null, 2) + "\n";
}

/**
 * Codex CLI: `.agents/skills/kuma/SKILL.md`
 * Uses regular kuma_* prefix (Codex may not add server prefix like OpenCode/Antigravity)
 */
function generateCodexSkill(): string {
  return [
    "---",
    "name: kuma-mcp",
    "description: Kuma MCP — safety toolkit for AI coding agents",
    "---",
    "",
    BOOTSTRAP,
    "",
    "📖 Read `.kuma/init.md` for detailed rules.",
  ].join("\n");
}

/**
 * Codex CLI config: `.codex/config.toml`
 */
function generateCodexConfigToml(): string {
  return [
    "# Generated by Kuma MCP - https://github.com/plumpslabs/kuma",
    "# Kuma MCP server config for Codex CLI",
    "",
    "[mcp_servers.kuma]",
    'command = "npx"',
    'args = ["-y", "@plumpslabs/kuma"]',
    "",
  ].join("\n");
}

/**
 * OpenCode: `.agents/skills/kuma/SKILL.md`
 * Uses kuma_kuma_* prefix (OpenCode adds kuma_ prefix to tool names)
 */
function generateOpencodeSkill(): string {
  return [
    "---",
    "name: kuma-mcp",
    "description: Kuma MCP — safety toolkit for AI coding agents. Research, memory, and safety guard.",
    "---",
    "",
    "⚠️ **OpenCode platform note:** Tool names use `kuma_kuma_*` prefix",
    "   (server name `kuma` + already-prefixed `kuma_context`).",
    "   Example: `kuma_kuma_context({ action: \"init\" })`",
    "",
    BOOTSTRAP_OPENCODE,
    "",
    "📖 Read `.kuma/init.md` for detailed rules.",
  ].join("\n");
}

/**
 * Aider: `CONVENTIONS.md`
 * Format: Convention file referenced via .aider.conf.yml
 */
function generateAiderSkill(): string {
  return [
    "# Kuma MCP — Aider Conventions",
    "",
    BOOTSTRAP,
    "",
    "📖 **Usage:**",
    "  • `kuma_context({ action: \"init\" })` — load project context (call first)",
    "  • `kuma_safety({ action: \"guard\" })` — safety check",
    "  • `kuma_safety({ action: \"verify\", scope: \"<area>\" })` — verify after edits",
    "  • `.kuma/init.md` — full behavioral rules",
  ].join("\n");
}

/**
 * Aider config: `.aider.conf.yml`
 */
function generateAiderConfig(): string {
  return [
    "# Generated by Kuma MCP - https://github.com/plumpslabs/kuma",
    "# Aider will read CONVENTIONS.md for coding conventions",
    "",
    "read: CONVENTIONS.md",
    "",
  ].join("\n");
}

/**
 * Windsurf: `.windsurf/rules/kuma.md`
 * Format: Plain markdown rules file (NO YAML frontmatter)
 */
function generateWindsurfSkill(): string {
  return [
    "# Kuma MCP — Windsurf",
    "",
    BOOTSTRAP,
    "",
    "Also auto-detected via `.windsurf/skills/` and `.agents/skills/`.",
  ].join("\n");
}

/**
 * GitHub Copilot: `.github/skills/kuma/SKILL.md`
 * Format: Skill file with YAML frontmatter
 */
function generateCopilotSkill(): string {
  return [
    "---",
    "name: kuma-mcp",
    "description: Kuma MCP — safety toolkit for AI coding agents",
    "---",
    "",
    BOOTSTRAP,
    "",
    "📖 **Usage:**",
    "  • `kuma_context({ action: \"init\" })` — load project context (call first)",
    "  • `kuma_safety({ action: \"guard\" })` — safety check",
    "  • `kuma_safety({ action: \"verify\", scope: \"<area>\" })` — verify after edits",
    "  • `.kuma/init.md` — full behavioral rules",
  ].join("\n");
}

/**
 * Qwen Code: `AGENTS.md` section
 * Format: Markdown section in AGENTS.md
 */
function generateQwenSkill(): string {
  return [
    "## Kuma MCP",
    "",
    BOOTSTRAP,
    "",
    "📖 **Usage:**",
    "  • `kuma_context({ action: \"init\" })` — load project context (call first)",
    "  • `kuma_safety({ action: \"guard\" })` — safety check",
    "  • `kuma_safety({ action: \"verify\", scope: \"<area>\" })` — verify after edits",
    "  • `.kuma/init.md` — full behavioral rules",
  ].join("\n");
}

/**
 * Qwen Code settings: `settings.json`
 */
function generateQwenSettings(): string {
  return JSON.stringify({
    mcpServers: {
      kuma: {
        command: "npx",
        args: ["-y", "@plumpslabs/kuma"],
        env: {},
      },
    },
  }, null, 2) + "\n";
}

/**
 * Kiro: `.kiro/steering/kuma.md`
 * Format: Markdown with YAML frontmatter (inclusion: always)
 */
function generateKiroSkill(): string {
  return [
    "---",
    "name: kuma-mcp",
    "description: Kuma MCP — safety toolkit for AI coding agents",
    "inclusion: always",
    "---",
    "",
    BOOTSTRAP,
    "",
    "📖 **Usage:**",
    "  • `kuma_context({ action: \"init\" })` — load project context (call first)",
    "  • `kuma_safety({ action: \"guard\" })` — safety check",
    "  • `kuma_safety({ action: \"verify\", scope: \"<area>\" })` — verify after edits",
    "  • `.kuma/init.md` — full behavioral rules",
  ].join("\n");
}

/**
 * OpenClaw: `skills/kuma/SKILL.md`
 * Format: Root-level skill with YAML frontmatter
 */
function generateOpenclawSkill(): string {
  return [
    "---",
    "name: kuma-mcp",
    "description: Kuma MCP — safety toolkit for AI coding agents",
    "---",
    "",
    BOOTSTRAP,
    "",
    "📖 **Usage:**",
    "  • `kuma_context({ action: \"init\" })` — load project context (call first)",
    "  • `kuma_safety({ action: \"guard\" })` — safety check",
    "  • `kuma_safety({ action: \"verify\", scope: \"<area>\" })` — verify after edits",
    "  • `.kuma/init.md` — full behavioral rules",
  ].join("\n");
}

/**
 * CodeWhale: `skills/kuma/SKILL.md`
 * Same as OpenClaw
 */
function generateCodewhaleSkill(): string {
  return generateOpenclawSkill();
}

/**
 * CodeWhale MCP config: `.codewhale/mcp.json`
 */
function generateCodewhaleMcpConfig(): string {
  return JSON.stringify({
    mcpServers: {
      kuma: {
        command: "npx",
        args: ["-y", "@plumpslabs/kuma"],
        env: {},
      },
    },
  }, null, 2) + "\n";
}
