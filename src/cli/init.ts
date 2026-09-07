import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "../utils/pathValidator.js";
import { getActiveGotchas } from "../engine/domainRules.js";

// ============================================================
// KUMA INIT — Generate/append AI agent config files
// ============================================================

export type ConfigType =
  | "claude"
  | "cursor"
  | "windsurf"
  | "copilot"
  | "cline"
  | "aider"
  | "antigravity"
  | "opencode"
  | "codex"
  | "qwen"
  | "kiro"
  | "openclaw"
  | "codewhale";

export const ALL_CONFIG_TYPES: ConfigType[] = [
  "claude",
  "cursor",
  "windsurf",
  "copilot",
  "cline",
  "aider",
  "antigravity",
  "opencode",
  "codex",
  "qwen",
  "kiro",
  "openclaw",
  "codewhale",
];

export const CONFIG_LABELS: Record<ConfigType, string> = {
  claude: "Claude Code (CLAUDE.md / plugin)",
  cursor: "Cursor (.cursor/rules/*.mdc)",
  windsurf: "Windsurf (.windsurf/rules/)",
  copilot: "GitHub Copilot Editor (AGENTS.md + Skill)",
  cline: "Cline (.clinerules/*.md)",
  aider: "Aider (CONVENTIONS.md via .aider.conf.yml)",
  antigravity: "Antigravity CLI (.agents/skills/)",
  opencode: "OpenCode (AGENTS.md + skills)",
  codex: "Codex CLI (AGENTS.md + .codex/config.toml)",
  qwen: "Qwen Code (AGENTS.md + settings.json)",
  kiro: "Kiro (.kiro/steering/*.md)",
  openclaw: "OpenClaw (skills/)",
  codewhale: "CodeWhale (skills/ + .codewhale/mcp.json)",
};

function configFilePath(type: ConfigType): string {
  switch (type) {
    case "claude": return "CLAUDE.md";
    case "cursor": return ".cursor/rules/kuma.mdc";
    case "windsurf": return ".windsurf/rules/kuma.md";
    case "copilot": return "AGENTS.md";
    case "cline": return ".clinerules/kuma.md";
    case "aider": return "CONVENTIONS.md";
    case "antigravity": return ".agents/skills/kuma/SKILL.md";
    case "opencode": return "AGENTS.md";
    case "codex": return "AGENTS.md";
    case "qwen": return "AGENTS.md";
    case "kiro": return ".kiro/steering/kuma.md";
    case "openclaw": return "skills/kuma/SKILL.md";
    case "codewhale": return "skills/kuma/SKILL.md";
  }
}

// ============================================================
// TEMPLATES — Thin bootstrap (rules moved to .kuma/init.md)
// ============================================================

/** Thin bootstrap snippet — lean 3-step default (guard/research/verify on-demand) */
const BOOTSTRAP_LINES = [
  "Kuma MCP tools: kuma_context, kuma_memory, kuma_safety.",
  "Record what matters, skip what doesn't.",
  "",
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
  "",
  "🪄 **Auto-inject (Claude Code):** gotcha/decision/history injected automatically before edits",
  "   via the PreToolUse hook — an empty hook output means the file has no gotchas.",
  "",
  "📖 Full rules: `.kuma/init.md`",
].join("\n");

const KUMA_CORE_INSTRUCTIONS = BOOTSTRAP_LINES;

function claudeTemplate(): string {
  return [
    "# Kuma MCP",
    "",
    KUMA_CORE_INSTRUCTIONS,
    "",
    "🪄 **Auto-inject hook:** `.claude/settings.json` wires a PreToolUse hook",
    "   (`kuma hook pre-edit`) — gotchas/decisions/history injected before edits.",
    "   ⚠️ Requires `kuma` on PATH (global install). A silent hook means no gotchas for that file.",
    "",
    "📖 Rules: `.kuma/init.md`",
    "📂 Readable state: `.kuma/KNOWN_GOTCHAS.md` (gotchas) · `.kuma/memories/decisions.md` (decisions)",
  ].join("\n");
}

/** Cursor .cursor/rules/kuma.mdc template with YAML frontmatter */
function cursorRulesTemplate(): string {
  return [
    "---",
    "description: Kuma MCP — .kuma/ is the single source of truth",
    "alwaysApply: true",
    "---",
    "",
    KUMA_CORE_INSTRUCTIONS,
    "",
    "📖 Read `.kuma/init.md` for detailed rules.",
  ].join("\n");
}

/** Windsurf .windsurf/rules/kuma.md — plain markdown, NO YAML frontmatter */
function windsurfRulesTemplate(): string {
  return [
    "# Kuma MCP — Windsurf",
    "",
    "Windsurf Cascade agent: Kuma MCP tools are installed.",
    "All behavioral rules are in `.kuma/init.md`.",
    "**Before coding, call `kuma_context({ action: \"init\" })`** to load project context and session memory.",
    "Project knowledge persists across sessions (`.kuma/` — kuma.db + markdown layers).",
    "",
    "Also auto-detected as SKILL.md in `.windsurf/skills/` and `.agents/skills/`.",
  ].join("\n");
}

/** Copilot Editor AGENTS.md section */
function copilotTemplate(): string {
  return [
    "## Kuma MCP",
    "",
    KUMA_CORE_INSTRUCTIONS,
  ].join("\n");
}

/** Cline .clinerules/kuma.md template with paths frontmatter */
function clineRulesTemplate(): string {
  return [
    "---",
    "description: Kuma MCP — .kuma/ is the single source of truth",
    "paths:",
    '  - "*"',
    "---",
    "",
    KUMA_CORE_INSTRUCTIONS,
    "",
    "📖 Read `.kuma/init.md` for detailed rules.",
  ].join("\n");
}

/** Aider CONVENTIONS.md template (referenced from .aider.conf.yml via read:) */
function aiderTemplate(): string {
  return [
    "# Kuma MCP",
    "",
    KUMA_CORE_INSTRUCTIONS,
  ].join("\n");
}

/** OpenCode AGENTS.md section — supports kuma_kuma_* and kuma_* */
function opencodeAgentsMdTemplate(): string {
  const opencodeLines = [
    "Kuma MCP tools: kuma_kuma_context (or kuma_context), kuma_kuma_memory (or kuma_memory), kuma_kuma_safety (or kuma_safety).",
    "Record what matters, skip what doesn't.",
    "",
    "<kuma_obedience>",
    "## 🔒 Obedience (non-negotiable)",
    "- MUST call `kuma_kuma_context({ action: \"init\" })` (or `kuma_context({ action: \"init\" })`) at session start.",
    "- MUST record gotchas IMMEDIATELY when a bug/quirk is found.",
    "- MUST call `kuma_kuma_safety({ action: \"verify\" })` (or `kuma_safety({ action: \"verify\" })`) after edits.",
    "- MUST NOT call actions outside the core actions.",
    "</kuma_obedience>",
    "",
    "<kuma_workflow>",
    "🧠 **Before coding:** `kuma_kuma_context({ action: \"init\" })`",
    "🗺️ **Monorepo map:** `kuma_kuma_context({ action: \"map\" })`",
    "🔬 **Blast radius / impact:** `kuma_kuma_context({ action: \"impact\", target: \"<file>\" })` or `kuma_kuma_context({ action: \"research\", scope: \"<area>\" })`",
    "🐛 **Found a bug/quirk:** `kuma_kuma_memory({ action: \"gotcha\" })` (IMMEDIATELY)",
    "🧭 **Chose between options:** `kuma_kuma_memory({ action: \"decision\" })`",
    "🔀 **Traced a flow:** `kuma_kuma_memory({ action: \"arch_flow\" })` (max 5 files)",
    "🛡️ **Before risky work / after edits:** `kuma_kuma_safety({ action: \"guard\" | \"verify\" })`",
    "</kuma_workflow>",
    "",
    "⚠️ **OpenCode note:** Depending on OpenCode MCP registration, tool names may be prefixed with server name (`kuma_kuma_*`) or bare (`kuma_*`). Both are valid.",
    "",
    "### 🍵 Companion: Matcha & Kuma Harmony",
    "If Matcha is active: Matcha provides Intent Discovery (`.agents/plan/current.md`); Kuma provides blast radius, gotchas memory, and test verification.",
    "",
  ].join("\n");
  return [
    "## Kuma MCP — OpenCode",
    "",
    opencodeLines,
    "📖 Rules: `.kuma/init.md`",
    "🧠 Skills: `.agents/skills/kuma/SKILL.md` · `.opencode/skills/kuma/SKILL.md`",
    "🔌 Plugin: `.opencode/plugins/kuma.js`",
  ].join("\n");
}

/** Codex CLI AGENTS.md section */
function codexTemplate(): string {
  return [
    "## Kuma MCP",
    "",
    KUMA_CORE_INSTRUCTIONS,
    "",
    "📖 Rules: `.kuma/init.md`",
  ].join("\n");
}

/** Codex CLI .codex/config.toml (secondary file) */
function codexConfigTomlTemplate(): string {
  return [
    "# Generated by Kuma MCP - https://github.com/plumpslabs/kuma",
    '# Kuma MCP server config for Codex CLI',
    "",
    "[mcp_servers.kuma]",
    'command = "npx"',
    'args = ["-y", "@plumpslabs/kuma"]',
    "",
  ].join("\n");
}

/** Qwen Code AGENTS.md section */
function qwenTemplate(): string {
  return [
    "## Kuma MCP",
    "",
    KUMA_CORE_INSTRUCTIONS,
    "",
    "📖 Rules: `.kuma/init.md`",
  ].join("\n");
}

/** Qwen Code settings.json (secondary file - MCP servers) */
function qwenSettingsTemplate(): string {
  const config = {
    mcpServers: {
      kuma: {
        command: "npx",
        args: ["-y", "@plumpslabs/kuma"],
        env: {},
      },
    },
  };
  return JSON.stringify(config, null, 2) + "\n";
}

/** Kiro .kiro/steering/kuma.md template with YAML frontmatter */
function kiroRulesTemplate(): string {
  return [
    "---",
    "name: kuma-mcp",
    "description: Kuma MCP — .kuma/ is the single source of truth",
    "inclusion: always",
    "---",
    "",
    KUMA_CORE_INSTRUCTIONS,
    "",
    "📖 Read `.kuma/init.md` for detailed rules.",
  ].join("\n");
}

/** OpenClaw skills/kuma/SKILL.md template */
function openclawSkillTemplate(): string {
  return [
    "---",
    "name: kuma-mcp",
    "description: Kuma MCP — .kuma/ is the single source of truth",
    "---",
    "",
    KUMA_CORE_INSTRUCTIONS,
    "",
    "📖 Read `.kuma/init.md` for detailed rules.",
    "📂 Readable state: `.kuma/KNOWN_GOTCHAS.md` (gotchas) · `.kuma/memories/decisions.md` (decisions)",
  ].join("\n");
}

/** CodeWhale skills/kuma/SKILL.md template */
function codewhaleTemplate(): string {
  return [
    "---",
    "name: kuma-mcp",
    "description: Kuma MCP — .kuma/ is the single source of truth",
    "---",
    "",
    KUMA_CORE_INSTRUCTIONS,
    "",
    "📖 Read `.kuma/init.md` for detailed rules.",
    "📂 Readable state: `.kuma/KNOWN_GOTCHAS.md` (gotchas) · `.kuma/memories/decisions.md` (decisions)",
  ].join("\n");
}

/**
 * Antigravity SKILL.md template — uses kuma_kuma_* prefix
 * (Antigravity is in .agents/ dir, same as OpenCode — server name kuma + already-prefixed kuma_context)
 */
function antigravitySkillTemplate(): string {
  return [
    "---",
    "name: kuma-mcp",
    "description: Kuma MCP — .kuma/ is the single source of truth",
    "---",
    "",
    KUMA_CORE_INSTRUCTIONS,
    "",
    "📖 Read `.kuma/init.md` for detailed rules.",
    "📂 Readable state: `.kuma/KNOWN_GOTCHAS.md` (gotchas) · `.kuma/memories/decisions.md` (decisions)",
  ].join("\n");
}

/** Antigravity mcp_config.json template */
function antigravityMcpConfigTemplate(): string {
  const config = {
    mcpServers: {
      kuma: {
        command: "npx",
        args: ["-y", "@plumpslabs/kuma"],
        env: {},
      },
    },
  };
  return JSON.stringify(config, null, 2) + "\n";
}

/** Antigravity persistent rule template: .agents/rules/kuma.md */
function antigravityRuleTemplate(): string {
  return [
    "# 🐻 Kuma MCP — Antigravity Rules",
    "",
    "This project uses **Kuma MCP** for runtime safety, blast radius analysis, and codebase memory.",
    "",
    KUMA_CORE_INSTRUCTIONS,
    "",
    "### 🍵 Companion: Matcha & Kuma Harmony",
    "If Matcha is active in this workspace:",
    "- **Matcha** governs engineering philosophy, intent discovery, reuse checks, and review gates.",
    "- **Kuma** governs blast radius calculation, monorepo workspace dependencies, known gotchas memory, architecture boundary guards, and scoped test verification.",
    "- Workflow: Use Matcha to plan (Intent Discovery) → Use Kuma to inspect dependencies & blast radius (`kuma_context({ action: 'impact' })`) → Use Kuma to verify after edits (`kuma_safety({ action: 'verify' })`).",
    "",
    "📖 Rules: `.kuma/init.md`",
    "📂 Readable state: `.kuma/KNOWN_GOTCHAS.md` (gotchas) · `.kuma/memories/decisions.md` (decisions)",
  ].join("\n");
}

/** Gemini / Antigravity workspace instruction template: GEMINI.md */
function geminiTemplate(): string {
  return [
    "# 🐻 Kuma MCP — Workspace Instructions",
    "",
    "This workspace uses **Kuma MCP** for runtime safety, monorepo intelligence, blast radius calculation, and memory.",
    "",
    "<kuma_obedience>",
    "## 🔒 Kuma MCP Safety & Memory (non-negotiable)",
    "- **Session Start:** Call `kuma_context({ action: \"init\" })` before reading or editing code.",
    "- **Monorepo / Blast Radius:** Call `kuma_context({ action: \"impact\", target: \"<file>\" })` or `kuma_context({ action: \"research\", scope: \"<area>\" })` before modifying unfamiliar code.",
    "- **Gotchas:** Call `kuma_memory({ action: \"gotcha\", scope: \"<file>\", content: \"<description>\" })` IMMEDIATELY when any quirk/bug is discovered.",
    "- **Decisions:** Call `kuma_memory({ action: \"decision\", title: \"...\", rationale: \"...\" })` when choosing between options.",
    "- **Post-Edits:** Call `kuma_safety({ action: \"verify\" })` after modifying code to run affected package/unit tests.",
    "</kuma_obedience>",
    "",
    "### 🍵 Matcha & Kuma Harmony",
    "If Matcha is active: Matcha provides Intent Discovery & review; Kuma provides blast radius, gotchas memory, architecture guards, and test verification.",
    "",
    "📖 Full rules: `.kuma/init.md`",
  ].join("\n");
}

/** OpenCode native auto-loaded plugin: .opencode/plugins/kuma.js */
function opencodePluginTemplate(): string {
  return [
    "/**",
    " * 🐻 Kuma MCP — OpenCode Plugin",
    " * Auto-injects gotcha warnings and safety guidance before file edits and commands in OpenCode.",
    " * OpenCode loads all plugins from .opencode/plugins/*.js automatically.",
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

/** Roo Code .roo/rules/kuma.md template */
function rooRulesTemplate(): string {
  return [
    "---",
    "description: Kuma MCP — .kuma/ is the single source of truth",
    "alwaysApply: true",
    "---",
    "",
    KUMA_CORE_INSTRUCTIONS,
    "",
    "📖 Read `.kuma/init.md` for detailed rules.",
  ].join("\n");
}

/** Trae .trae/rules/kuma.md template */
function traeRulesTemplate(): string {
  return [
    "# Kuma MCP — Trae Rules",
    "",
    KUMA_CORE_INSTRUCTIONS,
    "",
    "📖 Read `.kuma/init.md` for detailed rules.",
  ].join("\n");
}

/** Qoder .qoder/rules/kuma.md template */
function qoderRulesTemplate(): string {
  return [
    "# Kuma MCP — Qoder Rules",
    "",
    KUMA_CORE_INSTRUCTIONS,
    "",
    "📖 Read `.kuma/init.md` for detailed rules.",
  ].join("\n");
}

/** Root .windsurfrules template */
function windsurfrulesTemplate(): string {
  return [
    "# Kuma MCP — Windsurf Rules",
    "",
    KUMA_CORE_INSTRUCTIONS,
    "",
    "📖 Read `.kuma/init.md` for detailed rules.",
  ].join("\n");
}

// ============================================================
// .kuma/init.md — Instruction-style behavioral rules (single source of truth)
// ============================================================

/**
 * Generate .kuma/init.md — instruction-style step-by-step workflow.
 * Agents MUST follow this sequence every session.
 * Includes graph node legend for knowledge graph node types/shapes.
 */
export function generateInitMdContent(): string {
  return [
    "# Kuma Init — Workflow & Rules",
    "",
    "_(Auto-generated by `kuma init` — edit this file to customize)_",
    "",
    "---",
    "",
    "> **Platform Tool Names:**",
    "> • **OpenCode:** Use `kuma_kuma_*` prefix (e.g. `kuma_kuma_context({ action: \"init\" })`)",
    "> • **Other platforms:** Use `kuma_*` directly (e.g. `kuma_context({ action: \"init\" })`)",
    "",
    "---",
    "",
    "<kuma_obedience>",
    "## 🔒 OBEDIENCE (non-negotiable)",
    "",
    "1. **MUST call `kuma_context({ action: \"init\" })`** at session start — before any code edit.",
    "2. **MUST record gotchas IMMEDIATELY** when a bug/quirk is found (`kuma_memory({ action: \"gotcha\" })`).",
    "3. **MUST call `kuma_safety({ action: \"verify\" })`** after code edits.",
    "4. **MUST NOT call actions outside the core actions** in this file — anything else is rejected by the MCP schema.",
    "5. If a Kuma call fails or returns an error, **re-read this file and retry** — do not silently continue.",
    "",
    "> These rules are enforced: the MCP schema rejects unknown actions, and Claude Code hooks inject gotchas before every edit.",
    "</kuma_obedience>",
    "",
    "---",
    "",
    "<kuma_workflow>",
    "## SESSION WORKFLOW",
    "",
    "### Core Actions (15)",
    "",
    "🧠 **Before coding:** `kuma_context({ action: \"init\" })`",
    "🗺️ **Monorepo map:** `kuma_context({ action: \"map\" })`",
    "🔬 **Blast radius / impact:** `kuma_context({ action: \"impact\", target: \"<file>\" })` or `kuma_context({ action: \"research\", scope: \"<area>\" })`",
    "🕰️ **Why this file?** `kuma_context({ action: \"history\", target: \"<file>\" })`",
    "🗂️ **Read a flow:** `kuma_context({ action: \"flow\", target: \"<domain>\" })`",
    "🐛 **Found a bug/quirk:** `kuma_memory({ action: \"gotcha\" })` (IMMEDIATELY)",
    "🧭 **Chose between options:** `kuma_memory({ action: \"decision\" })`",
    "🔀 **Traced a flow:** `kuma_memory({ action: \"arch_flow\" })` (max 5 files)",
    "💾 **Saved findings:** `kuma_memory({ action: \"research_save\" })` · 🔍 **Quick lookup:** `kuma_memory({ action: \"search\" })`",
    "🛡️ **Before risky work / after edits:** `kuma_safety({ action: \"guard\" | \"verify\" })`",
    "📸 **Rollback (one mechanism):** `kuma_safety({ action: \"checkpoint\", label: \"pre-x\" })` → `rollback_label` to restore",
    "</kuma_workflow>",
    "",
    "### Recording Rules",
    "",
    "**RECORD (high value):**",
    "- `gotcha` — IMMEDIATELY when bug/quirk found (saves future agents from same issue)",
    "- `arch_flow` — AFTER tracing COMPLETE flow (max 5 core files, skip UI/controllers/schemas)",
    "- `decision` — IMMEDIATELY when choosing between options (preserves rationale)",
    "- `research_save` — After exploring a new area (creates search cache)",
    "",
    "**SKIP (low value):** function/class/component nodes — grep/glob is faster",
    "",
    "**⚠️ gotcha format:**",
    "```",
    "kuma_memory({ action: \"gotcha\", scope: \"<file_path>\", content: \"<description>\", status: \"medium\" })",
    "```",
    "- `scope` — file path where the bug was found",
    "- `content` — bug description",
    "- `status` — severity: `low` | `medium` | `high` | `critical`",
    "",
    "**⚠️ arch_flow format:**",
    "```",
    "kuma_memory({ action: \"arch_flow\", content: \"domain: <Name> | hops: <file1> → <file2> → <file3>\" })",
    "```",
    "- MAX 5 files per flow — core business logic only",
    "- SKIP UI components, Controllers, Schemas, simple CRUD",
    "- INCLUDE files with complex logic, decision points, state mutations",
    "",
    "**⚠️ decision format:**",
    "```",
    "kuma_memory({ action: \"decision\", title: \"...\", context: \"...\", rationale: \"...\", outcome: \"...\" })",
    "```",
    "- Required: `title` and `rationale`",
    "",
    "---",
    "",
    "## 🍵 Companion: Matcha & Kuma Harmony",
    "",
    "If **Matcha** is active in this workspace:",
    "- **Matcha** governs engineering philosophy, intent discovery, reuse checks, and review gates.",
    "- **Kuma** governs blast radius calculation, monorepo workspace dependencies, known gotchas memory, architecture boundary guards, and scoped test verification.",
    "- **Workflow:**",
    "  1. Use Matcha's Intent Discovery (`.agents/plan/current.md`) to define Problem / Goals / Success Criteria.",
    "  2. Use Kuma (`kuma_context({ action: \"map\" })` and `kuma_context({ action: \"impact\", target: \"...\" })`) to analyze blast radius and package dependents before modifying code.",
    "  3. When encountering quirks or architectural boundaries, record immediately with `kuma_memory({ action: \"gotcha\" | \"decision\" })`.",
    "  4. After changes, verify with `kuma_safety({ action: \"verify\" })` to run scoped tests.",
    "",
    "---",
    "",
    "## ⚠️ HONEST LIMITATIONS",
    "",
    "- **Node IDs are text-based** — same file recorded with slightly different paths can create duplicates.",
    "- **Metadata is JSON** — format varies per node type. Studio displays all fields dynamically.",
    "- **Gotchas have 2 stores** — `known_gotchas` table + `nodes` graph. `syncGotchasGraph()` keeps them in sync.",
    "- **Edge weights are static** — `contains`=2.0, `flows_through`=1.0. Dynamic ranking not yet implemented.",
    "",
    "---",
    "",
    "## 📋 Tool Reference",
    "",
    "### kuma_context — Context & Research",
    "",
    "| Action | Description |",
    "|--------|-------------|",
    "| `init` | Lean project brief, restore session, monorepo brief |",
    "| `map` | Repository workspace map & package dependency graph |",
    "| `impact` | Direct blast radius analysis (dependents, consumers, tests) |",
    "| `research` | 5-step pipeline before editing unfamiliar code |",
    "| `history` | Why is this file written this way (cross-session trace) |",
    "| `flow` | Read a recorded architecture flow |",
    "",
    "### kuma_memory — Knowledge Recording",
    "",
    "| Action | Description |",
    "|--------|-------------|",
    "| `gotcha` | Record bug/quirk (candidate -> active -> verified) |",
    "| `arch_flow` | Record architecture flow (max 5 core files) |",
    "| `decision` | Record ADR / decision rationale |",
    "| `research_save` | Cache research findings |",
    "| `search` | Quick lookup of memory + knowledge graph |",
    "",
    "### kuma_safety — Safety & Verification",
    "",
    "| Action | Description |",
    "|--------|-------------|",
    "| `guard` | Anti-pattern detection & architecture boundary check |",
    "| `verify` | Auto-run scoped tests for affected packages/files |",
    "| `checkpoint` | Labeled snapshot before risky work |",
    "| `rollback_label` | Restore a labeled snapshot |",
    "",
    "---",
    "",
    "<kuma_storage>",
    "## 📂 What Kuma Stores (.kuma/)",
    "",
    "Kuma persists project knowledge in `.kuma/`. You can READ these files directly ",
    "(no MCP call needed) — but never edit them by hand; record via the actions instead.",
    "",
    "| File | Contents | Read via |",
    "|------|----------|----------|",
    "| `init.md` | This file — behavioral rules | read directly |",
    "| `KNOWN_GOTCHAS.md` | Gotchas (human-readable) | `kuma_context({ action: \"history\" })` or read directly |",
    "| `ARCHITECTURE_FLOW.md` | Recorded flows | `kuma_context({ action: \"flow\" })` or read directly |",
    "| `memories/decisions.md` | Decision log (ADR-style) | `kuma_context({ action: \"history\" })` or read directly |",
    "| `kuma.db` | SQLite graph (nodes, edges, research cache) | `kuma_memory({ action: \"search\" })` |",
    "| `memory.json` | Session memory (internal) | `kuma_context({ action: \"init\" })` auto-restores |",
    "| `auto-gotcha.json` | Loop auto-capture state (internal) | — |",
    "",
    "> Rules of thumb: `gotcha`/`arch_flow`/`decision` are the WRITE paths; `init`/`history`/",
    "> `flow`/`search` are the READ paths. Keep recordings small and high-signal — each one",
    "> is re-injected on future sessions.",
    "</kuma_storage>",
    "",
    "---",
    "",
    "## 🧠 Session Memory",
    "",
    "Session memory tracks tool calls, recordings, and tool health across the session.",
    "It detects loops (10+ identical calls), suppresses cleanup noise, and provides context for guard checks.",
    "",
    "📊 **Metrics Tracked:**",
    "- Tool call count & unique tools used",
    "- Recording counts: arch_flows, gotchas, decisions, research_saves",
    "- Error detection from bash/test output",
    "- Loop detection: identical tool+params called 10+ times",
    "",
    "---",
    "",
    "## 📏 Guard Anti-Patterns",
    "",
    "The guard checks for common anti-patterns before editing:",
    "",
    "1. **Missing Research** — editing unfamiliar code without research",
    "2. **Missing Recordings** — many tool calls with 0 recordings (knowledge loss)",
    "3. **AST Anti-Patterns** — editing generated files, test snapshots, dist directories",
    "4. **Scope Mismatch** — editing files outside declared scope",
    "5. **Loop Detection** — same tool+params called 10+ times (param variation < 5)",
    "",
    "---",
    "",
    "---",
    "",
    "_Generated by Kuma MCP_",
  ].join("\n");
}
const TEMPLATES: Record<ConfigType, () => string> = {
  claude: claudeTemplate,
  cursor: cursorRulesTemplate,
  windsurf: windsurfRulesTemplate,
  copilot: copilotTemplate,
  cline: clineRulesTemplate,
  aider: aiderTemplate,
  antigravity: antigravitySkillTemplate,
  opencode: opencodeAgentsMdTemplate,
  codex: codexTemplate,
  qwen: qwenTemplate,
  kiro: kiroRulesTemplate,
  openclaw: openclawSkillTemplate,
  codewhale: codewhaleTemplate,
};

const APPEND_SEPARATOR =
  "\n\n---\n_Generated by Kuma MCP - https://github.com/plumpslabs/kuma_\n\n";

// ============================================================
// INIT LOGIC
// ============================================================

export interface InitResult {
  type: ConfigType;
  filePath: string;
  action: "created" | "appended" | "skipped" | "error";
  error?: string;
}

/** OpenCode secondary: generate .agents/skills/kuma/SKILL.md, .opencode/skills/kuma/SKILL.md, and .opencode/plugins/kuma.js */
function handleOpencodeSecondary(root: string, results: InitResult[]): void {
  const opencodeContent = [
    "---",
    "name: kuma-mcp",
    "description: Kuma MCP — safety toolkit for AI coding agents. Research, memory, and safety guard.",
    "---",
    "",
    "Kuma MCP tools: kuma_kuma_context (or kuma_context), kuma_kuma_memory (or kuma_memory), kuma_kuma_safety (or kuma_safety).",
    "Record what matters, skip what doesn't.",
    "",
    "<kuma_obedience>",
    "## 🔒 Obedience (non-negotiable)",
    "- MUST call `kuma_kuma_context({ action: \"init\" })` at session start.",
    "- MUST record gotchas IMMEDIATELY when a bug/quirk is found.",
    "- MUST call `kuma_kuma_safety({ action: \"verify\" })` after edits.",
    "- MUST NOT call actions outside the core actions.",
    "</kuma_obedience>",
    "",
    "<kuma_workflow>",
    "🧠 **Before coding:** `kuma_kuma_context({ action: \"init\" })`",
    "🗺️ **Monorepo map:** `kuma_kuma_context({ action: \"map\" })`",
    "🔬 **Blast radius / impact:** `kuma_kuma_context({ action: \"impact\", target: \"<file>\" })` or `kuma_kuma_context({ action: \"research\", scope: \"<area>\" })`",
    "🐛 **Found a bug/quirk:** `kuma_kuma_memory({ action: \"gotcha\" })` (IMMEDIATELY)",
    "🧭 **Chose between options:** `kuma_kuma_memory({ action: \"decision\" })`",
    "🔀 **Traced a flow:** `kuma_kuma_memory({ action: \"arch_flow\" })` (max 5 files)",
    "🛡️ **Before risky work / after edits:** `kuma_kuma_safety({ action: \"guard\" | \"verify\" })`",
    "</kuma_workflow>",
    "",
    "⚠️ **OpenCode note:** Tool names use `kuma_kuma_*` or `kuma_*` prefix depending on server registration.",
    "",
    "📖 Full rules: `.kuma/init.md`",
  ].join("\n");

  // 1. .agents/skills/kuma/SKILL.md
  const skillPath = path.resolve(root, ".agents", "skills", "kuma", "SKILL.md");
  if (!results.some(r => r.filePath === ".agents/skills/kuma/SKILL.md")) {
    try {
      const dir = path.dirname(skillPath);
      if (fs.existsSync(skillPath)) {
        const existing = fs.readFileSync(skillPath, "utf-8");
        if (existing.includes("kuma-mcp")) {
          results.push({ type: "opencode", filePath: ".agents/skills/kuma/SKILL.md", action: "skipped" });
        } else {
          fs.writeFileSync(skillPath, existing.trimEnd() + "\n\n---\n\n" + opencodeContent, "utf-8");
          results.push({ type: "opencode", filePath: ".agents/skills/kuma/SKILL.md", action: "appended" });
        }
      } else {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(skillPath, opencodeContent, "utf-8");
        results.push({ type: "opencode", filePath: ".agents/skills/kuma/SKILL.md", action: "created" });
      }
    } catch (err) {
      results.push({
        type: "opencode",
        filePath: ".agents/skills/kuma/SKILL.md",
        action: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 2. .opencode/skills/kuma/SKILL.md (OpenCode native skills directory)
  const opencodeSkillPath = path.resolve(root, ".opencode", "skills", "kuma", "SKILL.md");
  if (!results.some(r => r.filePath === ".opencode/skills/kuma/SKILL.md")) {
    try {
      const dir = path.dirname(opencodeSkillPath);
      if (fs.existsSync(opencodeSkillPath)) {
        const existing = fs.readFileSync(opencodeSkillPath, "utf-8");
        if (existing.includes("kuma-mcp")) {
          results.push({ type: "opencode", filePath: ".opencode/skills/kuma/SKILL.md", action: "skipped" });
        } else {
          fs.writeFileSync(opencodeSkillPath, existing.trimEnd() + "\n\n---\n\n" + opencodeContent, "utf-8");
          results.push({ type: "opencode", filePath: ".opencode/skills/kuma/SKILL.md", action: "appended" });
        }
      } else {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(opencodeSkillPath, opencodeContent, "utf-8");
        results.push({ type: "opencode", filePath: ".opencode/skills/kuma/SKILL.md", action: "created" });
      }
    } catch (err) {
      results.push({
        type: "opencode",
        filePath: ".opencode/skills/kuma/SKILL.md",
        action: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 3. .opencode/plugins/kuma.js (OpenCode auto-loaded plugin)
  const pluginPath = path.resolve(root, ".opencode", "plugins", "kuma.js");
  if (!results.some(r => r.filePath === ".opencode/plugins/kuma.js")) {
    try {
      const dir = path.dirname(pluginPath);
      if (fs.existsSync(pluginPath)) {
        const existing = fs.readFileSync(pluginPath, "utf-8");
        if (existing.includes("KumaPlugin") || existing.includes("kuma")) {
          results.push({ type: "opencode", filePath: ".opencode/plugins/kuma.js", action: "skipped" });
        } else {
          fs.writeFileSync(pluginPath, existing.trimEnd() + "\n\n" + opencodePluginTemplate(), "utf-8");
          results.push({ type: "opencode", filePath: ".opencode/plugins/kuma.js", action: "appended" });
        }
      } else {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(pluginPath, opencodePluginTemplate(), "utf-8");
        results.push({ type: "opencode", filePath: ".opencode/plugins/kuma.js", action: "created" });
      }
    } catch (err) {
      results.push({
        type: "opencode",
        filePath: ".opencode/plugins/kuma.js",
        action: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/** Generate Codex CLI .codex/config.toml as secondary file */
function handleCodexSecondary(root: string, results: InitResult[]): void {
  const tomlPath = path.resolve(root, ".codex/config.toml");
  if (results.some(r => r.filePath === ".codex/config.toml")) return;

  try {
    const dir = path.dirname(tomlPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    if (fs.existsSync(tomlPath)) {
      const existingContent = fs.readFileSync(tomlPath, "utf-8");
      if (existingContent.includes("kuma")) {
        results.push({ type: "codex", filePath: ".codex/config.toml", action: "skipped" });
        return;
      }
      fs.writeFileSync(tomlPath, existingContent.trimEnd() + "\n\n" + codexConfigTomlTemplate(), "utf-8");
      results.push({ type: "codex", filePath: ".codex/config.toml", action: "appended" });
    } else {
      fs.writeFileSync(tomlPath, codexConfigTomlTemplate(), "utf-8");
      results.push({ type: "codex", filePath: ".codex/config.toml", action: "created" });
    }
  } catch (err) {
    results.push({
      type: "codex",
      filePath: ".codex/config.toml",
      action: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Generate Qwen Code settings.json as secondary file */
function handleQwenSecondary(root: string, results: InitResult[]): void {
  const settingsPath = path.resolve(root, "settings.json");
  if (results.some(r => r.filePath === "settings.json")) return;

  try {
    if (fs.existsSync(settingsPath)) {
      const existingContent = fs.readFileSync(settingsPath, "utf-8");
      if (existingContent.includes("kuma")) {
        if (!existingContent.includes("_Generated by Kuma MCP_")) {
          try {
            const parsed = JSON.parse(existingContent);
            parsed.mcpServers = parsed.mcpServers || {};
            if (!parsed.mcpServers.kuma) {
              parsed.mcpServers.kuma = { command: "npx", args: ["-y", "@plumpslabs/kuma"], env: {} };
              fs.writeFileSync(settingsPath, JSON.stringify(parsed, null, 2) + "\n", "utf-8");
              results.push({ type: "qwen", filePath: "settings.json", action: "appended" });
              return;
            }
          } catch {
            // If JSON parse fails, fall through to skipped
          }
        }
        results.push({ type: "qwen", filePath: "settings.json", action: "skipped" });
        return;
      }
      try {
        const parsed = JSON.parse(existingContent);
        parsed.mcpServers = parsed.mcpServers || {};
        if (!parsed.mcpServers.kuma) {
          parsed.mcpServers.kuma = { command: "npx", args: ["-y", "@plumpslabs/kuma"], env: {} };
          fs.writeFileSync(settingsPath, JSON.stringify(parsed, null, 2) + "\n", "utf-8");
          results.push({ type: "qwen", filePath: "settings.json", action: "appended" });
        }
      } catch {
        // If JSON parse fails, skip
      }
    } else {
      fs.writeFileSync(settingsPath, qwenSettingsTemplate(), "utf-8");
      results.push({ type: "qwen", filePath: "settings.json", action: "created" });
    }
  } catch (err) {
    results.push({
      type: "qwen",
      filePath: "settings.json",
      action: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ============================================================
// AGENTS.md MERGE LOGIC
// ============================================================

/** Config types that target AGENTS.md (need merge dedup) */
const AGENTS_MD_TYPES: ConfigType[] = ["opencode", "codex", "qwen", "copilot"];

/** Generate unified AGENTS.md content from selected types */
function getCombinedAgentsMd(selectedTypes: Set<ConfigType>): string {
  const lines: string[] = [
    "# Kuma MCP — Combined Agent Instructions",
    "",
    "This file contains behavioral rules for AI coding agents. Unused sections can be safely removed.",
    "",
    "---",
    "",
    "## SESSION WORKFLOW",
    "",
    "<kuma_obedience>",
    "## 🔒 Obedience (non-negotiable)",
    "- MUST call `[kuma_]context({ action: \"init\" })` at session start.",
    "- MUST record gotchas IMMEDIATELY when a bug/quirk is found.",
    "- MUST call `[kuma_]safety({ action: \"verify\" })` after edits.",
    "- MUST NOT call actions outside the 13 core actions.",
    "</kuma_obedience>",
    "",
    "<kuma_workflow>",
    "### Core Actions (13)",
    "",
    "🧠 **Before coding:** `[kuma_]context({ action: \"init\" })`",
    "🔬 **Unfamiliar code:** `[kuma_]context({ action: \"research\", scope: \"<area>\" })`",
    "🕰️ **Why this file?** `[kuma_]context({ action: \"history\", target: \"<file>\" })`",
    "🗂️ **Read a flow:** `[kuma_]context({ action: \"flow\", target: \"<domain>\" })`",
    "🐛 **Found a bug/quirk:** `[kuma_]memory({ action: \"gotcha\" })` (IMMEDIATELY)",
    "🧭 **Chose between options:** `[kuma_]memory({ action: \"decision\" })`",
    "🔀 **Traced a flow:** `[kuma_]memory({ action: \"arch_flow\" })` (max 5 files)",
    "💾 **Saved findings:** `[kuma_]memory({ action: \"research_save\" })` · 🔍 **Quick lookup:** `[kuma_]memory({ action: \"search\" })`",
    "🛡️ **Before risky work / after edits:** `[kuma_]safety({ action: \"guard\" | \"verify\" })`",
    "📸 **Rollback:** `[kuma_]safety({ action: \"checkpoint\", label: \"pre-x\" })` → `rollback_label` to restore",
    "</kuma_workflow>",
    "",
    "Replace `[kuma_]` with the correct prefix for your platform (see below).",
    "",
    "---",
    "",
  ];

  // OpenCode: tools need kuma_kuma_* prefix
  if (selectedTypes.has("opencode")) {
    lines.push(
      "### OpenCode",
      "",
      "OpenCode adds the MCP server name (`kuma`) as a prefix to tool names.",
      "The server-registered names (kuma_context, kuma_memory, kuma_safety) become:",
      "",
      "| Action | Call this |",
      "|--------|-----------|",
      "| Init | `kuma_kuma_context({ action: \"init\" })` |",
      "| Guard | `kuma_kuma_safety({ action: \"guard\" })` |",
      "| Research | `kuma_kuma_context({ action: \"research\", scope: \"...\" })` |",
      "| Save | `kuma_kuma_memory({ action: \"research_save\", ... })` |",
      "| Verify | `kuma_kuma_safety({ action: \"verify\", ... })` |",
      "| Checkpoint | `kuma_kuma_safety({ action: \"checkpoint\", label: \"pre-x\" })` |",
      "",
      "📖 Skill: `.agents/skills/kuma/SKILL.md`",
      "",
      "---",
      "",
    );
  }

  // Other platforms: tools use kuma_* directly (no prefix)
  const nonOpenCode = Array.from(selectedTypes).filter(t => t !== "opencode");
  if (nonOpenCode.length > 0) {
    lines.push(
      "### Other Platforms",
      "",
      ...(nonOpenCode.map(t => `- ${CONFIG_LABELS[t]}`)),
      "",
      "Tool names are registered directly — no server prefix added:",
      "",
      "| Action | Call this |",
      "|--------|-----------|",
      "| Init | `kuma_context({ action: \"init\" })` |",
      "| Guard | `kuma_safety({ action: \"guard\" })` |",
      "| Research | `kuma_context({ action: \"research\", scope: \"...\" })` |",
      "| Save | `kuma_memory({ action: \"research_save\", ... })` |",
      "| Verify | `kuma_safety({ action: \"verify\", ... })` |",
      "| Checkpoint | `kuma_safety({ action: \"checkpoint\", label: \"pre-x\" })` |",
      "",
      "---",
      "",
    );
  }

  lines.push(
    "📖 Rules: `.kuma/init.md`",
    "📂 Readable state: `.kuma/KNOWN_GOTCHAS.md` (gotchas) · `.kuma/memories/decisions.md` (decisions)",
    "",
    "_Generated by Kuma MCP - https://github.com/plumpslabs/kuma_",
  );

  return lines.join("\n");
}

/** Generate Antigravity mcp_config.json as secondary file */
function handleAntigravityMcpConfig(root: string, results: InitResult[]): void {
  const mcpPath = path.resolve(root, ".agents/mcp_config.json");
  // Avoid duplicate processing
  if (results.some(r => r.filePath === ".agents/mcp_config.json")) return;

  try {
    const mcpDir = path.dirname(mcpPath);
    if (fs.existsSync(mcpPath)) {
      const existingContent = fs.readFileSync(mcpPath, "utf-8");
      if (existingContent.includes("kuma")) {
        results.push({ type: "antigravity", filePath: ".agents/mcp_config.json", action: "skipped" });
        return;
      }
      // Merge Kuma into existing mcp_config.json (JSON.parse-safe — never string-surgery)
      try {
        const parsed = JSON.parse(existingContent);
        parsed.mcpServers = parsed.mcpServers || {};
        parsed.mcpServers.kuma = { command: "npx", args: ["-y", "@plumpslabs/kuma"], env: {} };
        fs.writeFileSync(mcpPath, JSON.stringify(parsed, null, 2) + "\n", "utf-8");
        results.push({ type: "antigravity", filePath: ".agents/mcp_config.json", action: "appended" });
      } catch {
        results.push({ type: "antigravity", filePath: ".agents/mcp_config.json", action: "error", error: "Invalid JSON in existing mcp_config.json" });
      }
    } else {
      if (!fs.existsSync(mcpDir)) fs.mkdirSync(mcpDir, { recursive: true });
      fs.writeFileSync(mcpPath, antigravityMcpConfigTemplate(), "utf-8");
      results.push({ type: "antigravity", filePath: ".agents/mcp_config.json", action: "created" });
    }
  } catch (err) {
    results.push({
      type: "antigravity",
      filePath: ".agents/mcp_config.json",
      action: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Generate Antigravity .agents/rules/kuma.md as secondary file */
function handleAntigravityRules(root: string, results: InitResult[]): void {
  const rulePath = path.resolve(root, ".agents", "rules", "kuma.md");
  if (results.some(r => r.filePath === ".agents/rules/kuma.md")) return;

  try {
    const dir = path.dirname(rulePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    if (fs.existsSync(rulePath)) {
      const existing = fs.readFileSync(rulePath, "utf-8");
      if (existing.includes("Kuma MCP") || existing.includes("kuma-mcp")) {
        results.push({ type: "antigravity", filePath: ".agents/rules/kuma.md", action: "skipped" });
        return;
      }
      fs.writeFileSync(rulePath, existing.trimEnd() + "\n\n---\n\n" + antigravityRuleTemplate(), "utf-8");
      results.push({ type: "antigravity", filePath: ".agents/rules/kuma.md", action: "appended" });
    } else {
      fs.writeFileSync(rulePath, antigravityRuleTemplate(), "utf-8");
      results.push({ type: "antigravity", filePath: ".agents/rules/kuma.md", action: "created" });
    }
  } catch (err) {
    results.push({
      type: "antigravity",
      filePath: ".agents/rules/kuma.md",
      action: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Generate/append root GEMINI.md for Antigravity & Gemini CLI as secondary file */
function handleGeminiMd(root: string, results: InitResult[]): void {
  const geminiPath = path.resolve(root, "GEMINI.md");
  if (results.some(r => r.filePath === "GEMINI.md")) return;

  try {
    if (fs.existsSync(geminiPath)) {
      const existing = fs.readFileSync(geminiPath, "utf-8");
      if (existing.includes("Kuma MCP") || existing.includes("kuma_context")) {
        results.push({ type: "antigravity", filePath: "GEMINI.md", action: "skipped" });
        return;
      }
      fs.writeFileSync(geminiPath, existing.trimEnd() + "\n\n---\n\n" + geminiTemplate(), "utf-8");
      results.push({ type: "antigravity", filePath: "GEMINI.md", action: "appended" });
    } else {
      fs.writeFileSync(geminiPath, geminiTemplate(), "utf-8");
      results.push({ type: "antigravity", filePath: "GEMINI.md", action: "created" });
    }
  } catch (err) {
    results.push({
      type: "antigravity",
      filePath: "GEMINI.md",
      action: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Generate Antigravity secondary suite: mcp_config.json, .agents/rules/kuma.md, and GEMINI.md */
function handleAntigravitySecondary(root: string, results: InitResult[]): void {
  handleAntigravityMcpConfig(root, results);
  handleAntigravityRules(root, results);
  handleGeminiMd(root, results);
}

/** Generate Windsurf .windsurfrules at root as secondary file */
function handleWindsurfSecondary(root: string, results: InitResult[]): void {
  const rulesPath = path.resolve(root, ".windsurfrules");
  if (results.some(r => r.filePath === ".windsurfrules")) return;

  try {
    if (fs.existsSync(rulesPath)) {
      const existing = fs.readFileSync(rulesPath, "utf-8");
      if (existing.includes("Kuma MCP") || existing.includes("kuma_context")) {
        results.push({ type: "windsurf", filePath: ".windsurfrules", action: "skipped" });
        return;
      }
      fs.writeFileSync(rulesPath, existing.trimEnd() + "\n\n---\n\n" + windsurfrulesTemplate(), "utf-8");
      results.push({ type: "windsurf", filePath: ".windsurfrules", action: "appended" });
    } else {
      fs.writeFileSync(rulesPath, windsurfrulesTemplate(), "utf-8");
      results.push({ type: "windsurf", filePath: ".windsurfrules", action: "created" });
    }
  } catch (err) {
    results.push({
      type: "windsurf",
      filePath: ".windsurfrules",
      action: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Generate Cline / Roo / Trae secondary rules files */
function handleClineSecondary(root: string, results: InitResult[]): void {
  // Roo Code: .roo/rules/kuma.md if .roo exists or always as companion
  const rooPath = path.resolve(root, ".roo", "rules", "kuma.md");
  if (!results.some(r => r.filePath === ".roo/rules/kuma.md")) {
    try {
      const dir = path.dirname(rooPath);
      if (fs.existsSync(rooPath)) {
        const existing = fs.readFileSync(rooPath, "utf-8");
        if (existing.includes("kuma-mcp") || existing.includes("Kuma MCP")) {
          results.push({ type: "cline", filePath: ".roo/rules/kuma.md", action: "skipped" });
        } else {
          fs.writeFileSync(rooPath, existing.trimEnd() + "\n\n---\n\n" + rooRulesTemplate(), "utf-8");
          results.push({ type: "cline", filePath: ".roo/rules/kuma.md", action: "appended" });
        }
      } else {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(rooPath, rooRulesTemplate(), "utf-8");
        results.push({ type: "cline", filePath: ".roo/rules/kuma.md", action: "created" });
      }
    } catch (err) {
      results.push({
        type: "cline",
        filePath: ".roo/rules/kuma.md",
        action: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Trae: .trae/rules/kuma.md
  const traePath = path.resolve(root, ".trae", "rules", "kuma.md");
  if (!results.some(r => r.filePath === ".trae/rules/kuma.md")) {
    try {
      const dir = path.dirname(traePath);
      if (fs.existsSync(traePath)) {
        const existing = fs.readFileSync(traePath, "utf-8");
        if (existing.includes("Kuma MCP")) {
          results.push({ type: "cline", filePath: ".trae/rules/kuma.md", action: "skipped" });
        } else {
          fs.writeFileSync(traePath, existing.trimEnd() + "\n\n---\n\n" + traeRulesTemplate(), "utf-8");
          results.push({ type: "cline", filePath: ".trae/rules/kuma.md", action: "appended" });
        }
      } else {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(traePath, traeRulesTemplate(), "utf-8");
        results.push({ type: "cline", filePath: ".trae/rules/kuma.md", action: "created" });
      }
    } catch (err) {
      results.push({
        type: "cline",
        filePath: ".trae/rules/kuma.md",
        action: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Qoder: .qoder/rules/kuma.md
  const qoderPath = path.resolve(root, ".qoder", "rules", "kuma.md");
  if (!results.some(r => r.filePath === ".qoder/rules/kuma.md")) {
    try {
      const dir = path.dirname(qoderPath);
      if (fs.existsSync(qoderPath)) {
        const existing = fs.readFileSync(qoderPath, "utf-8");
        if (existing.includes("Kuma MCP")) {
          results.push({ type: "cline", filePath: ".qoder/rules/kuma.md", action: "skipped" });
        } else {
          fs.writeFileSync(qoderPath, existing.trimEnd() + "\n\n---\n\n" + qoderRulesTemplate(), "utf-8");
          results.push({ type: "cline", filePath: ".qoder/rules/kuma.md", action: "appended" });
        }
      } else {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(qoderPath, qoderRulesTemplate(), "utf-8");
        results.push({ type: "cline", filePath: ".qoder/rules/kuma.md", action: "created" });
      }
    } catch (err) {
      results.push({
        type: "cline",
        filePath: ".qoder/rules/kuma.md",
        action: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/** Generate Aider .aider.conf.yml with read: CONVENTIONS.md reference */
function handleAiderSecondary(root: string, results: InitResult[]): void {
  const ymlPath = path.resolve(root, ".aider.conf.yml");
  if (results.some(r => r.filePath === ".aider.conf.yml")) return;

  try {
    const conventionsRef = "read: CONVENTIONS.md";
    if (fs.existsSync(ymlPath)) {
      const existingContent = fs.readFileSync(ymlPath, "utf-8");
      if (existingContent.includes("CONVENTIONS.md") || existingContent.includes("kuma")) {
        results.push({ type: "aider", filePath: ".aider.conf.yml", action: "skipped" });
        return;
      }
      const newContent = existingContent.trimEnd() + "\n\n# Kuma MCP conventions\n" + conventionsRef + "\n";
      fs.writeFileSync(ymlPath, newContent, "utf-8");
      results.push({ type: "aider", filePath: ".aider.conf.yml", action: "appended" });
    } else {
      const content = [
        "# Generated by Kuma MCP - https://github.com/plumpslabs/kuma",
        "# Aider will read CONVENTIONS.md for coding conventions",
        "",
        conventionsRef,
        "",
      ].join("\n");
      fs.writeFileSync(ymlPath, content, "utf-8");
      results.push({ type: "aider", filePath: ".aider.conf.yml", action: "created" });
    }
  } catch (err) {
    results.push({
      type: "aider",
      filePath: ".aider.conf.yml",
      action: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Generate Copilot Editor .github/skills/kuma/SKILL.md as secondary skill file */
function handleCopilotSecondary(root: string, results: InitResult[]): void {
  const skillPath = path.resolve(root, ".github/skills/kuma/SKILL.md");
  if (results.some(r => r.filePath === ".github/skills/kuma/SKILL.md")) return;

  try {
    const dir = path.dirname(skillPath);
    const content = [
      "---",
      "name: kuma-mcp",
      "description: Kuma MCP — .kuma/ is the single source of truth",
      "---",
      "",
      KUMA_CORE_INSTRUCTIONS,
      "",
      "📖 Read `.kuma/init.md` for detailed rules.",
    ].join("\n");

    if (fs.existsSync(skillPath)) {
      const existingContent = fs.readFileSync(skillPath, "utf-8");
      if (existingContent.includes("kuma")) {
        results.push({ type: "copilot", filePath: ".github/skills/kuma/SKILL.md", action: "skipped" });
        return;
      }
      fs.writeFileSync(skillPath, existingContent.trimEnd() + "\n\n" + content, "utf-8");
      results.push({ type: "copilot", filePath: ".github/skills/kuma/SKILL.md", action: "appended" });
    } else {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(skillPath, content, "utf-8");
      results.push({ type: "copilot", filePath: ".github/skills/kuma/SKILL.md", action: "created" });
    }
  } catch (err) {
    results.push({
      type: "copilot",
      filePath: ".github/skills/kuma/SKILL.md",
      action: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Generate .agents/mcp_config.json for OpenClaw (shares same file as Antigravity) */
function handleOpenclawSecondary(root: string, results: InitResult[]): void {
  const mcpPath = path.resolve(root, ".agents/mcp_config.json");
  if (results.some(r => r.filePath === ".agents/mcp_config.json")) return;

  try {
    const dir = path.dirname(mcpPath);
    if (fs.existsSync(mcpPath)) {
      const existingContent = fs.readFileSync(mcpPath, "utf-8");
      if (existingContent.includes("kuma")) return;
      const parsed = JSON.parse(existingContent);
      parsed.mcpServers = parsed.mcpServers || {};
      parsed.mcpServers.kuma = { command: "npx", args: ["-y", "@plumpslabs/kuma"], env: {} };
      fs.writeFileSync(mcpPath, JSON.stringify(parsed, null, 2) + "\n", "utf-8");
      results.push({ type: "openclaw", filePath: ".agents/mcp_config.json", action: "appended" });
    } else {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(mcpPath, antigravityMcpConfigTemplate(), "utf-8");
      results.push({ type: "openclaw", filePath: ".agents/mcp_config.json", action: "created" });
    }
  } catch (err) {
    results.push({
      type: "openclaw",
      filePath: ".agents/mcp_config.json",
      action: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Generate .kuma/init.md — behavioral rules, single source of truth (no duplicates) */
function handleInitMdGeneration(root: string, results: InitResult[]): void {
  const initMdPath = path.resolve(root, ".kuma/init.md");

  try {
    const kumaDir = path.dirname(initMdPath);
    if (!fs.existsSync(kumaDir)) fs.mkdirSync(kumaDir, { recursive: true });

    if (fs.existsSync(initMdPath)) {
      const existing = fs.readFileSync(initMdPath, "utf-8");
      // Skip if it already has our marker (no duplicates!)
      if (existing.includes("_Generated by Kuma MCP_")) {
        results.push({ type: "claude", filePath: ".kuma/init.md", action: "skipped" });
        return;
      }
      // Smart append: keep existing content, add Kuma rules at the end
      fs.writeFileSync(initMdPath, existing.trimEnd() + "\n\n" + generateInitMdContent(), "utf-8");
      results.push({ type: "claude", filePath: ".kuma/init.md", action: "appended" });
    } else {
      fs.writeFileSync(initMdPath, generateInitMdContent(), "utf-8");
      results.push({ type: "claude", filePath: ".kuma/init.md", action: "created" });
    }
  } catch (err) {
    results.push({
      type: "claude",
      filePath: ".kuma/init.md",
      action: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  }

}

/** Generate CodeWhale .codewhale/mcp.json as secondary file */
function handleCodewhaleSecondary(root: string, results: InitResult[]): void {
  const mcpPath = path.resolve(root, ".codewhale/mcp.json");
  if (results.some(r => r.filePath === ".codewhale/mcp.json")) return;

  try {
    const dir = path.dirname(mcpPath);
    if (fs.existsSync(mcpPath)) {
      const existingContent = fs.readFileSync(mcpPath, "utf-8");
      if (existingContent.includes("kuma")) return;
      const parsed = JSON.parse(existingContent);
      parsed.mcpServers = parsed.mcpServers || {};
      parsed.mcpServers.kuma = { command: "npx", args: ["-y", "@plumpslabs/kuma"], env: {} };
      fs.writeFileSync(mcpPath, JSON.stringify(parsed, null, 2) + "\n", "utf-8");
      results.push({ type: "codewhale", filePath: ".codewhale/mcp.json", action: "appended" });
    } else {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const config = {
        mcpServers: {
          kuma: {
            command: "npx",
            args: ["-y", "@plumpslabs/kuma"],
            env: {},
          },
        },
      };
      fs.writeFileSync(mcpPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
      results.push({ type: "codewhale", filePath: ".codewhale/mcp.json", action: "created" });
    }
  } catch (err) {
    results.push({
      type: "codewhale",
      filePath: ".codewhale/mcp.json",
      action: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export interface InitOptions {
  types: ConfigType[];
  projectRoot?: string;
  skipExisting?: boolean;
}

/**
 * Claude Code secondary: write/merge `.claude/settings.json` with PreToolUse hooks
 * and generate `.claude/skills/kuma/SKILL.md`.
 */
function handleClaudeSecondary(root: string, results: InitResult[]): void {
  const settingsPath = path.resolve(root, ".claude", "settings.json");
  const hookBlock = {
    hooks: {
      PreToolUse: [
        {
          matcher: "Edit|Write|MultiEdit|NotebookEdit",
          hooks: [{ type: "command", command: "kuma hook pre-edit" }],
        },
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: "kuma hook pre-bash" }],
        },
      ],
    },
  };

  try {
    if (fs.existsSync(settingsPath)) {
      const existing = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      const merged = {
        ...existing,
        hooks: {
          ...(existing.hooks || {}),
          ...hookBlock.hooks,
        },
      };
      // Avoid duplicate matchers — replace existing hooks with the same matcher
      const matchers = new Set((merged.hooks.PreToolUse || []).map((h: { matcher: string }) => h.matcher));
      for (const entry of hookBlock.hooks.PreToolUse) {
        if (!matchers.has(entry.matcher)) {
          merged.hooks.PreToolUse = [...(merged.hooks.PreToolUse || []), entry];
          matchers.add(entry.matcher);
        }
      }
      fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + "\n", "utf-8");
      results.push({ type: "claude", filePath: ".claude/settings.json", action: "appended" });
    } else {
      const dir = path.dirname(settingsPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(settingsPath, JSON.stringify(hookBlock, null, 2) + "\n", "utf-8");
      results.push({ type: "claude", filePath: ".claude/settings.json", action: "created" });
    }
  } catch (err) {
    results.push({
      type: "claude",
      filePath: ".claude/settings.json",
      action: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Claude Code native skill: .claude/skills/kuma/SKILL.md
  const skillPath = path.resolve(root, ".claude", "skills", "kuma", "SKILL.md");
  if (!results.some(r => r.filePath === ".claude/skills/kuma/SKILL.md")) {
    try {
      const dir = path.dirname(skillPath);
      const content = [
        "---",
        "name: kuma-mcp",
        "description: Kuma MCP — safety toolkit for AI coding agents",
        "---",
        "",
        KUMA_CORE_INSTRUCTIONS,
        "",
        "📖 Read `.kuma/init.md` for detailed rules.",
        "📂 Readable state: `.kuma/KNOWN_GOTCHAS.md` (gotchas) · `.kuma/memories/decisions.md` (decisions)",
      ].join("\n");

      if (fs.existsSync(skillPath)) {
        const existing = fs.readFileSync(skillPath, "utf-8");
        if (existing.includes("kuma-mcp")) {
          results.push({ type: "claude", filePath: ".claude/skills/kuma/SKILL.md", action: "skipped" });
        } else {
          fs.writeFileSync(skillPath, existing.trimEnd() + "\n\n---\n\n" + content, "utf-8");
          results.push({ type: "claude", filePath: ".claude/skills/kuma/SKILL.md", action: "appended" });
        }
      } else {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(skillPath, content, "utf-8");
        results.push({ type: "claude", filePath: ".claude/skills/kuma/SKILL.md", action: "created" });
      }
    } catch (err) {
      results.push({
        type: "claude",
        filePath: ".claude/skills/kuma/SKILL.md",
        action: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * I7 (Roadmap): generate Cursor globs-based rules for active high/critical
 * gotchas. Cursor auto-applies a .mdc rule when a matching file is opened,
 * giving gotcha injection on Cursor without PreToolUse hooks.
 * Regenerates the whole rules dir each run (idempotent, safe to re-run).
 */
function handleCursorGotchaRules(root: string, results: InitResult[]): void {
  const rulesDir = path.resolve(root, ".cursor", "rules", "kuma-gotchas");
  try {
    // 1. Gather active gotchas from the markdown layer (cheap, no DB side effects)
    let gotchas: Array<{ filePath: string; description: string; severity: string }> = [];
    try {
      gotchas = getActiveGotchas().filter((g) => g.severity === "high" || g.severity === "critical");
    } catch { /* no markdown layer yet */ }

    // 2. Regenerate only the .mdc files (never wipe user files in the dir)
    if (fs.existsSync(rulesDir)) {
      for (const f of fs.readdirSync(rulesDir)) {
        if (f.endsWith(".mdc")) {
          try { fs.rmSync(path.join(rulesDir, f), { force: true }); } catch { /* non-critical */ }
        }
      }
    }
    if (gotchas.length === 0) {
      results.push({ type: "cursor", filePath: ".cursor/rules/kuma-gotchas/", action: "skipped" });
      return;
    }
    fs.mkdirSync(rulesDir, { recursive: true });

    const seen = new Set<string>();
    let created = 0;
    for (const g of gotchas) {
      const slug = g.filePath
        .replace(/[^a-zA-Z0-9._-]/g, "-")
        .replace(/\.(ts|js|tsx|jsx|py|go|rs|java|rb|php)$/i, "")
        .slice(0, 60);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      const md = [
        "---",
        `description: "KUMA gotcha — ${g.description.substring(0, 80)}"`,
        `globs: ["**/${g.filePath}"]`,
        "---",
        "",
        `## ⚠️ Known gotcha (auto-generated by Kuma)`,
        "",
        g.description,
        "",
        "Check active gotchas before editing:",
        "`kuma_context({ action: 'history', target: '<file>' })`",
        "",
      ].join("\n");
      fs.writeFileSync(path.join(rulesDir, `${slug}.mdc`), md, "utf-8");
      created++;
    }
    results.push({
      type: "cursor",
      filePath: `.cursor/rules/kuma-gotchas/ (${created} rule(s))`,
      action: created > 0 ? "created" : "skipped",
    });
  } catch (err) {
    results.push({
      type: "cursor",
      filePath: ".cursor/rules/kuma-gotchas/",
      action: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function runInit(options: InitOptions): InitResult[] {
  const root = options.projectRoot ?? getProjectRoot();
  const selected = options.types.length > 0 ? options.types : ALL_CONFIG_TYPES;
  const results: InitResult[] = [];

  // ALWAYS generate .kuma/init.md first (single source of truth for rules)
  handleInitMdGeneration(root, results);

  // Pre-compute which AGENTS.md types are selected for merge logic
  const selectedSet = new Set(selected);
  const agentsMdSelected = AGENTS_MD_TYPES.filter(t => selectedSet.has(t));
  let agentsMdHandled = false;

  for (const type of selected) {
    const relativePath = configFilePath(type);
    const fullPath = path.resolve(root, relativePath);
    const getTemplate = TEMPLATES[type];

    try {
      // AGENTS.md merge: first AGENTS.md type generates combined content
      if (AGENTS_MD_TYPES.includes(type) && !agentsMdHandled) {
        agentsMdHandled = true;
        const combinedContent = getCombinedAgentsMd(new Set(agentsMdSelected));

        if (fs.existsSync(fullPath)) {
          if (options.skipExisting) {
            results.push({ type, filePath: relativePath, action: "skipped" });
          } else {
            const existingContent = fs.readFileSync(fullPath, "utf-8");
            if (existingContent.includes("_Generated by Kuma MCP_")) {
              results.push({ type, filePath: relativePath, action: "skipped" });
            } else {
              // Smart append: don't remove existing content
              fs.writeFileSync(fullPath, existingContent.trimEnd() + "\n\n" + combinedContent, "utf-8");
              results.push({ type, filePath: relativePath, action: "appended" });
            }
          }
        } else {
          const dir = path.dirname(fullPath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(fullPath, combinedContent, "utf-8");
          results.push({ type, filePath: relativePath, action: "created" });
        }

        // Handle AGENTS.md secondary files for all selected types
        if (selectedSet.has("opencode")) handleOpencodeSecondary(root, results);
        if (selectedSet.has("codex")) handleCodexSecondary(root, results);
        if (selectedSet.has("qwen")) handleQwenSecondary(root, results);
        if (selectedSet.has("copilot")) handleCopilotSecondary(root, results);
      } else if (AGENTS_MD_TYPES.includes(type) && agentsMdHandled) {
        // Already handled by the first AGENTS.md type
        results.push({ type, filePath: relativePath, action: "skipped" });
        continue;
      } else {
        const template = getTemplate();

        if (fs.existsSync(fullPath)) {
          if (options.skipExisting) {
            results.push({ type, filePath: relativePath, action: "skipped" });
            continue;
          }
          const existingContent = fs.readFileSync(fullPath, "utf-8");

          if (existingContent.includes("_Generated by Kuma MCP_")) {
            // Still run secondary file generation even if primary file is skipped
            if (type === "antigravity") {
              handleAntigravitySecondary(root, results);
            } else if (type === "openclaw") {
              handleOpenclawSecondary(root, results);
            } else if (type === "codewhale") {
              handleCodewhaleSecondary(root, results);
            } else if (type === "windsurf") {
              handleWindsurfSecondary(root, results);
            } else if (type === "cline") {
              handleClineSecondary(root, results);
            }
            results.push({ type, filePath: relativePath, action: "skipped" });
            continue;
          }

          // Smart append: keep existing content, append Kuma section
          const newContent = existingContent.trimEnd() + APPEND_SEPARATOR + template;
          fs.writeFileSync(fullPath, newContent, "utf-8");
          results.push({ type, filePath: relativePath, action: "appended" });
        } else {
          const dir = path.dirname(fullPath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          fs.writeFileSync(fullPath, template, "utf-8");
          results.push({ type, filePath: relativePath, action: "created" });
        }

        // Secondary files for non-AGENTS.md types
        if (type === "antigravity") {
          handleAntigravitySecondary(root, results);
        } else if (type === "openclaw") {
          handleOpenclawSecondary(root, results);
        } else if (type === "codewhale") {
          handleCodewhaleSecondary(root, results);
        } else if (type === "aider") {
          handleAiderSecondary(root, results);
        } else if (type === "windsurf") {
          handleWindsurfSecondary(root, results);
        } else if (type === "cline") {
          handleClineSecondary(root, results);
        }
        // OpenCode now handled via AGENTS.md path above
      }
    } catch (err) {
      results.push({
        type,
        filePath: relativePath,
        action: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Claude Code secondary: PreToolUse hooks (F2 auto-inject) — called AFTER the loop
  // so it runs even when CLAUDE.md is skipped (already present / skip-existing).
  if (selectedSet.has("claude")) {
    handleClaudeSecondary(root, results);
  }

  // I7: Cursor globs-based gotcha rules — auto-apply when a gotcha file is open
  if (selectedSet.has("cursor")) {
    handleCursorGotchaRules(root, results);
  }

  return results;
}

// ============================================================
// FORMAT OUTPUT
// ============================================================

export function formatInitResults(results: InitResult[]): string {
  const lines: string[] = [
    "\u{1F43B} **Kuma Init - AI Agent Config Generator**",
    "",
  ];

  for (const r of results) {
    const label = CONFIG_LABELS[r.type];
    switch (r.action) {
      case "created":
        lines.push("  \u2705 " + label);
        lines.push("     \u2192 Created: " + r.filePath);
        break;
      case "appended":
        lines.push("  \u2795 " + label);
        lines.push("     \u2192 Appended to: " + r.filePath);
        break;
      case "skipped":
        lines.push("  \u23ED " + label);
        lines.push("     \u2192 Skipped (already has Kuma): " + r.filePath);
        break;
      case "error":
        lines.push("  \u274C " + label);
        lines.push("     \u2192 Error: " + (r.error ?? "unknown"));
        break;
    }
  }

  const created = results.filter(r => r.action === "created").length;
  const appended = results.filter(r => r.action === "appended").length;
  const skipped = results.filter(r => r.action === "skipped").length;
  const errors = results.filter(r => r.action === "error").length;

  lines.push(
    "",
    "\u{1F4CA} Summary: " + created + " created, " + appended + " appended, "
      + skipped + " skipped, " + errors + " errors",
    "",
    "\u{1F4A1} Rules are in `.kuma/init.md` — single source of truth for all tools.",
    "\u{1F4A1} Call `kuma_init()` at session start to load project context.",
    "\u{1F4A1} Run again to generate additional config files anytime.",
  );

  return lines.join("\n");
}
