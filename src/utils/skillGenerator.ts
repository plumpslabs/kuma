// ============================================================
// SKILL GENERATOR — Generate AI agent skill files
// ============================================================
// Creates native skill/config files for all supported AI agents.
// Matches the exact file format each agent expects.
// ============================================================

import type { AgentType } from "./agentDetector.js";

// Shared bootstrap message — core actions only, super-lean.
// XML delimiters (<kuma_rules>/<kuma_workflow>) are used like matcha's
// <execution_filter>/<core_principles>: LLMs treat them as hard boundaries
// between instruction and data, which measurably raises compliance.
const CORE_ACTIONS = [
  "<kuma_obedience>",
  "## 🔒 Obedience (non-negotiable)",
  "- MUST call `kuma_context({ action: \"init\" })` at session start.",
  "- MUST record gotchas IMMEDIATELY when a bug/quirk is found.",
  "- MUST call `kuma_safety({ action: \"verify\" })` after edits.",
  "- MUST NOT call actions outside the core actions.",
  "</kuma_obedience>",
  "",
  "<kuma_workflow>",
  "🧠 **Before coding:** `kuma_context({ action: \"init\" })`",
  "🗺️ **Monorepo map:** `kuma_context({ action: \"map\" })`",
  "🔬 **Unfamiliar code / blast radius:** `kuma_context({ action: \"research\", scope: \"<area>\" })` or `kuma_context({ action: \"impact\", target: \"<file>\" })`",
  "🐛 **Found a bug/quirk:** `kuma_memory({ action: \"gotcha\" })` (IMMEDIATELY)",
  "🧭 **Chose between options:** `kuma_memory({ action: \"decision\" })`",
  "🔀 **Traced a flow:** `kuma_memory({ action: \"arch_flow\" })` (max 5 files)",
  "🛡️ **Before risky work / after edits:** `kuma_safety({ action: \"guard\" | \"verify\" })`",
  "</kuma_workflow>",
].join("\n");

const BOOTSTRAP = [
  "Kuma MCP tools: kuma_context, kuma_memory, kuma_safety.",
  "Record what matters, skip what doesn't.",
  "",
  CORE_ACTIONS,
  "",
  "📖 Full rules: `.kuma/init.md`",
].join("\n");

// OpenCode-specific bootstrap — uses kuma_kuma_* prefix (client adds server name)
const PREFIX_TOOLS = (s: string, prefix: string): string =>
  s.split(prefix).join("kuma_" + prefix);

const BOOTSTRAP_OPENCODE = [
  "Kuma MCP tools: kuma_kuma_context, kuma_kuma_memory, kuma_kuma_safety.",
  "Record what matters, skip what doesn't.",
  "",
  ["kuma_context", "kuma_memory", "kuma_safety"]
    .reduce((acc, tool) => PREFIX_TOOLS(acc, tool), CORE_ACTIONS),
  "",
  "📖 Full rules: `.kuma/init.md`",
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
      return [
        { path: ".agents/mcp_config.json", content: generateAntigravityMcpConfig() },
        { path: ".agents/rules/kuma.md", content: generateAntigravityRule() },
        { path: "GEMINI.md", content: generateGeminiMd() },
      ];
    case "opencode":
      return [
        { path: ".opencode/plugins/kuma.js", content: generateOpencodePlugin() },
        { path: ".opencode/skills/kuma/SKILL.md", content: generateOpencodeSkill() },
        { path: ".agents/skills/kuma/SKILL.md", content: generateOpencodeSkill() },
      ];
    case "claude":
      return [
        { path: ".claude/skills/kuma/SKILL.md", content: generateClaudeSkill() },
      ];
    case "windsurf":
      return [
        { path: ".windsurfrules", content: generateWindsurfrules() },
      ];
    case "cline":
      return [
        { path: ".roo/rules/kuma.md", content: generateRooRule() },
        { path: ".trae/rules/kuma.md", content: generateTraeRule() },
      ];
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
 * Antigravity rules: `.agents/rules/kuma.md`
 */
function generateAntigravityRule(): string {
  return [
    "# 🐻 Kuma MCP — Antigravity Rules",
    "",
    "This project uses **Kuma MCP** for runtime safety, blast radius analysis, and codebase memory.",
    "",
    BOOTSTRAP,
    "",
    "### 🍵 Companion: Matcha & Kuma Harmony",
    "If Matcha is active in this workspace:",
    "- **Matcha** governs engineering philosophy, intent discovery, reuse checks, and review gates.",
    "- **Kuma** governs blast radius calculation, monorepo workspace dependencies, known gotchas memory, architecture boundary guards, and scoped test verification.",
    "- Workflow: Use Matcha to plan (Intent Discovery) → Use Kuma to inspect dependencies & blast radius (`kuma_context({ action: 'impact' })`) → Use Kuma to verify after edits (`kuma_safety({ action: 'verify' })`).",
    "",
    "📖 Read `.kuma/init.md` for detailed rules.",
  ].join("\n");
}

/**
 * Gemini / Antigravity workspace instruction: `GEMINI.md`
 */
function generateGeminiMd(): string {
  return [
    "# 🐻 Kuma MCP — Workspace Instructions",
    "",
    "This workspace uses **Kuma MCP** for runtime safety, monorepo intelligence, blast radius calculation, and memory.",
    "",
    BOOTSTRAP,
    "",
    "### 🍵 Matcha & Kuma Harmony",
    "If Matcha is active: Matcha provides Intent Discovery & review; Kuma provides blast radius, gotchas memory, architecture guards, and test verification.",
    "",
    "📖 Full rules: `.kuma/init.md`",
  ].join("\n");
}

/**
 * OpenCode native plugin: `.opencode/plugins/kuma.js`
 */
function generateOpencodePlugin(): string {
  return [
    "/**",
    " * 🐻 Kuma MCP — OpenCode Plugin",
    " * Auto-injects gotcha warnings and safety checks before file edits and commands in OpenCode.",
    " */",
    'import fs from "node:fs";',
    'import path from "node:path";',
    "",
    "function getProjectRoot() {",
    "  let curr = process.cwd();",
    "  while (curr !== path.dirname(curr)) {",
    '    if (fs.existsSync(path.join(curr, ".kuma")) || fs.existsSync(path.join(curr, ".git"))) {',
    "      return curr;",
    "    }",
    "    curr = path.dirname(curr);",
    "  }",
    "  return process.cwd();",
    "}",
    "",
    "function getActiveGotchasForFile(filePath) {",
    "  try {",
    "    const root = getProjectRoot();",
    '    const gotchasPath = path.join(root, ".kuma", "KNOWN_GOTCHAS.md");',
    "    if (!fs.existsSync(gotchasPath)) return [];",
    '    const content = fs.readFileSync(gotchasPath, "utf-8");',
    "    const gotchas = [];",
    '    const normalizedTarget = filePath.replace(/^[./]+/, "");',
    '    const sections = content.split(/###\\s+/);',
    "    for (const section of sections) {",
    "      if (!section.trim()) continue;",
    '      const lines = section.split("\\n");',
    '      const title = lines[0] || "";',
    "      if (title.includes(normalizedTarget) || section.includes(normalizedTarget)) {",
    "        gotchas.push(title.trim());",
    "      }",
    "    }",
    "    return gotchas;",
    "  } catch {",
    "    return [];",
    "  }",
    "}",
    "",
    "export const KumaPlugin = async () => {",
    "  return {",
    '    "tool.execute.before": async (input, output) => {',
    '      const tool = (input.tool || "").toLowerCase();',
    "      const args = output.args || {};",
    '      const targetPath = args.filePath || args.targetFile || args.path || args.file || "";',
    '      if (targetPath && (tool.includes("edit") || tool.includes("write") || tool.includes("patch"))) {',
    "        const gotchas = getActiveGotchasForFile(String(targetPath));",
    "        if (gotchas.length > 0) {",
    "          console.warn(",
    "            `\\n🐻 [Kuma Alert] Active gotchas found for ${targetPath}:\\n` +",
    '            gotchas.map((g) => `  ⚠️ ${g}`).join("\\n") +',
    '            `\\n👉 Remember to record any new gotchas via kuma_memory({ action: "gotcha" })\\n`',
    "          );",
    "        }",
    "      }",
    "    },",
    "  };",
    "};",
    "",
  ].join("\n");
}

function generateWindsurfrules(): string {
  return [
    "# Kuma MCP — Windsurf Rules",
    "",
    BOOTSTRAP,
    "",
    "📖 Read `.kuma/init.md` for detailed rules.",
  ].join("\n");
}

function generateRooRule(): string {
  return [
    "---",
    "description: Kuma MCP — .kuma/ is the single source of truth",
    "alwaysApply: true",
    "---",
    "",
    BOOTSTRAP,
    "",
    "📖 Read `.kuma/init.md` for detailed rules.",
  ].join("\n");
}

function generateTraeRule(): string {
  return [
    "# Kuma MCP — Trae Rules",
    "",
    BOOTSTRAP,
    "",
    "📖 Read `.kuma/init.md` for detailed rules.",
  ].join("\n");
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
    "  • `.kuma/KNOWN_GOTCHAS.md` — gotchas · `.kuma/memories/decisions.md` — decisions (readable)",
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
    "  • `.kuma/KNOWN_GOTCHAS.md` — gotchas · `.kuma/memories/decisions.md` — decisions (readable)",
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
 * Uses regular kuma_* prefix (no server prefix added).
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
