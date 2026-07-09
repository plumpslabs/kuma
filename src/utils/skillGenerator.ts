// ============================================================
// SKILL GENERATOR — Generate AI agent skill files
// ============================================================
// Creates native skill/config files for all supported AI agents.
// Matches the exact file format each agent expects.
// ============================================================

import type { AgentType } from "./agentDetector.js";

// Shared bootstrap message — points to .kuma/init.md as single source of truth
const BOOTSTRAP = [
  "Kuma MCP tools are available. All behavioral rules are in `.kuma/init.md`.",
  "**Before coding, call `kuma_init()`** to load project context and session memory.",
  "Project knowledge persists in `.kuma/memories/*.md` across sessions.",
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
    "  • `kuma_init()` — load project context (call first)",
    "  • `kuma_guard({check: \"all\"})` — safety check before risky ops",
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
    "  • `kuma_init()` — load project context (call first)",
    "  • `kuma_guard({check: \"all\"})` — safety check before risky ops",
    "  • `kuma_verify({action: \"test\"})` — verify after edits",
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
    "  • `kuma_init()` — load project context (call first)",
    "  • `kuma_guard({check: \"all\"})` — safety check before risky ops",
    "  • `.kuma/init.md` — full behavioral rules",
  ].join("\n");
}

/**
 * Antigravity CLI: `.agents/skills/kuma/SKILL.md`
 * Format: Folder-based skill with SKILL.md (same as Claude)
 */
function generateAntigravitySkill(): string {
  return [
    "---",
    "name: kuma-mcp",
    "description: Kuma MCP — safety toolkit for AI coding agents",
    "---",
    "",
    BOOTSTRAP,
    "",
    "📖 **Usage:**",
    "  • `kuma_init()` — load project context (call first)",
    "  • `kuma_guard({check: \"all\"})` — safety check",
    "  • `kuma_verify({action: \"test\"})` — verify after edits",
    "  • `.kuma/init.md` — full behavioral rules",
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
 * Same path as Antigravity
 */
function generateCodexSkill(): string {
  return generateAntigravitySkill();
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
 * OpenCode: `opencode.json`
 * Format: JSON plugin configuration
 */
function generateOpencodeSkill(): string {
  return JSON.stringify({
    $schema: "https://opencode-ai.github.io/schema.json",
    mcp: {
      kuma: {
        type: "local",
        command: ["npx", "-y", "@plumpslabs/kuma"],
        enabled: true,
      },
    },
    instructions: [".kuma/init.md"],
  }, null, 2) + "\n";
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
    "  • `kuma_init()` — load project context (call first)",
    "  • `kuma_guard({check: \"all\"})` — safety check",
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
 * Windsurf: `.windsurfrules`
 * Format: Static rules file (no frontmatter)
 */
function generateWindsurfSkill(): string {
  return [
    "# Kuma MCP — Windsurf Rules",
    "",
    BOOTSTRAP,
    "",
    "📖 **Usage:**",
    "  • `kuma_init()` — load project context (call first)",
    "  • `kuma_guard({check: \"all\"})` — safety check",
    "  • `kuma_verify({action: \"test\"})` — verify after edits",
    "  • `.kuma/init.md` — full behavioral rules",
    "  • `.kuma/memories/` — persistent project knowledge",
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
    "  • `kuma_init()` — load project context (call first)",
    "  • `kuma_guard({check: \"all\"})` — safety check",
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
    "  • `kuma_init()` — load project context (call first)",
    "  • `kuma_guard({check: \"all\"})` — safety check",
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
    "  • `kuma_init()` — load project context (call first)",
    "  • `kuma_guard({check: \"all\"})` — safety check",
    "  • `kuma_verify({action: \"test\"})` — verify after edits",
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
    "  • `kuma_init()` — load project context (call first)",
    "  • `kuma_guard({check: \"all\"})` — safety check",
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
