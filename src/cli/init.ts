import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "../utils/pathValidator.js";

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
  "Kuma MCP tools are installed (kuma_context, kuma_memory, kuma_safety).",
  "**Before coding, call `kuma_context({ action: \"init\" })`** to load project context.",
  "",
  "⚡ **DEFAULT WORKFLOW (Lean — 3 steps):**",
  "  1. `kuma_context({ action: \"init\" })` — Load context (START HERE)",
  "  2. *(edit/read using native tools)*",
  "  3. `kuma_context({ action: \"changes\" })` — Review session",
  "",
  "📝 **RECORD when needed (don't force it):**",
  "  • Found a bug? → `kuma_memory({ action: \"gotcha\" })` (IMMEDIATELY)",
  "  • Traced a flow? → `kuma_memory({ action: \"arch_flow\" })` (max 5 files)",
  "  • Chose between options? → `kuma_memory({ action: \"decision\" })`",
  "",
  "🔧 **ON-DEMAND (use when appropriate):**",
  "  • `kuma_safety({ action: \"guard\" })` — before risky ops (deletions, refactors)",
  "  • `kuma_context({ action: \"research\" })` — before editing unfamiliar code",
  "  • `kuma_safety({ action: \"verify\" })` — after edits to confirm nothing broken",
  "",
  "🗑️ **Delete/Clear:** `delete_node` | `clear`",
  "📖 Full rules: `.kuma/init.md`",
].join("\n");

const KUMA_CORE_INSTRUCTIONS = BOOTSTRAP_LINES;

function claudeTemplate(): string {
  return [
    "# Kuma MCP",
    "",
    KUMA_CORE_INSTRUCTIONS,
    "",
    "📖 Rules: `.kuma/init.md`",
    "🧠 Memories: `.kuma/memories/*.md`",
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
    "Project knowledge persists in `.kuma/memories/*.md` across sessions.",
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

/** OpenCode AGENTS.md section — uses kuma_kuma_* prefix */
function opencodeAgentsMdTemplate(): string {
  const opencodeLines = [
    "Kuma MCP tools are installed (kuma_kuma_context, kuma_kuma_memory, kuma_kuma_safety).",
    "**Before coding, call `kuma_kuma_context({ action: \"init\" })`** to load project context.",
    "",
    "⚡ **DEFAULT WORKFLOW (Lean — 3 steps):**",
    "  1. `kuma_kuma_context({ action: \"init\" })` — Load context (START HERE)",
    "  2. *(edit/read using native tools)*",
    "  3. `kuma_kuma_context({ action: \"changes\" })` — Review session",
    "",
    "📝 **RECORD when needed (don't force it):**",
    "  • Found a bug? → `kuma_kuma_memory({ action: \"gotcha\" })` (IMMEDIATELY)",
    "  • Traced a flow? → `kuma_kuma_memory({ action: \"arch_flow\" })` (max 5 files)",
    "  • Chose between options? → `kuma_kuma_memory({ action: \"decision\" })`",
    "",
    "🔧 **ON-DEMAND (use when appropriate):**",
    "  • `kuma_kuma_safety({ action: \"guard\" })` — before risky ops",
    "  • `kuma_kuma_context({ action: \"research\" })` — before editing unfamiliar code",
    "  • `kuma_kuma_safety({ action: \"verify\" })` — after edits",
    "",
    "⚠️ **OpenCode note:** Tool names use `kuma_kuma_*` prefix.",
    "",
  ].join("\n");
  return [
    "## Kuma MCP — OpenCode",
    "",
    opencodeLines,
    "📖 Rules: `.kuma/init.md`",
    "🧠 Skill: `.agents/skills/kuma/SKILL.md`",
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
    "🧠 Memories: `.kuma/memories/*.md`",
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
    "🧠 Memories: `.kuma/memories/*.md`",
  ].join("\n");
}

/**
 * Antigravity SKILL.md template — uses kuma_kuma_* prefix
 * (Antigravity is in .agents/ dir, same as OpenCode — server name kuma + already-prefixed kuma_context)
 */
function antigravitySkillTemplate(): string {
  const antigravityLines = [
    "Kuma MCP tools are installed (kuma_kuma_context, kuma_kuma_memory, kuma_kuma_safety).",
    "**Before coding, call `kuma_kuma_context({ action: \"init\" })`** to load project context.",
    "",
    "⚡ **DEFAULT WORKFLOW (Lean — 3 steps):**",
    "  1. `kuma_kuma_context({ action: \"init\" })` — Load context (START HERE)",
    "  2. *(edit/read using native tools)*",
    "  3. `kuma_kuma_context({ action: \"changes\" })` — Review session",
    "",
    "📝 **RECORD when needed (don't force it):**",
    "  • Found a bug? → `kuma_kuma_memory({ action: \"gotcha\" })` (IMMEDIATELY)",
    "  • Traced a flow? → `kuma_kuma_memory({ action: \"arch_flow\" })` (max 5 files)",
    "  • Chose between options? → `kuma_kuma_memory({ action: \"decision\" })`",
    "",
    "🔧 **ON-DEMAND:**",
    "  • `kuma_kuma_safety({ action: \"guard\" })` — before risky ops",
    "  • `kuma_kuma_context({ action: \"research\" })` — before editing unfamiliar code",
    "  • `kuma_kuma_safety({ action: \"verify\" })` — after edits",
    "",
    "⚠️ **Antigravity note:** Tool names use `kuma_kuma_*` prefix.",
    "",
  ].join("\n");
  return [
    "---",
    "name: kuma-mcp",
    "description: Kuma MCP — .kuma/ is the single source of truth",
    "---",
    "",
    antigravityLines,
    "",
    "📖 Read `.kuma/init.md` for detailed rules.",
    "🧠 Memories: `.kuma/memories/*.md`",
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
    "> • **OpenCode / Antigravity:** Use `kuma_kuma_*` prefix (e.g. `kuma_kuma_context({ action: \"init\" })`)",
    "> • **Other platforms:** Use `kuma_*` directly (e.g. `kuma_context({ action: \"init\" })`)",
    "",
    "---",
    "",
    "## SESSION WORKFLOW",
    "",
    "### DEFAULT: 3-Step Lean Workflow",
    "",
    "**For most tasks (edits, reads, simple changes):**",
    "",
    "1. `kuma_context({ action: \"init\" })` — Load context (START HERE)",
    "2. *(edit/read using native tools)*",
    "3. `kuma_context({ action: \"changes\" })` — Review session",
    "",
    "### ON-DEMAND: Extended Actions",
    "",
    "**Record only when something important happens:**",
    "- Found a bug/quirk? → `kuma_memory({ action: \"gotcha\" })` IMMEDIATELY",
    "- Traced a complete flow? → `kuma_memory({ action: \"arch_flow\" })` (max 5 core files)",
    "- Chose between options? → `kuma_memory({ action: \"decision\" })` to preserve rationale",
    "- Explored new area? → `kuma_memory({ action: \"research_save\", scope: \"<file>\" })`",
    "",
    "**Safety checks (use when appropriate):**",
    "- Before risky edits: `kuma_safety({ action: \"guard\", guardGoal: \"...\" })`",
    "- After edits: `kuma_safety({ action: \"verify\", scope: \"<area>\" })`",
    "- Before research: `kuma_context({ action: \"research\", scope: \"<area>\" })`",
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
    "kuma_memory({ action: \"decision\", decisionAction: \"record\", title: \"...\", context: \"...\", rationale: \"...\", outcome: \"...\" })",
    "```",
    "- Required: `title` and `rationale`",
    "",
    "---",
    "",
    "## ⚠️ HONEST LIMITATIONS",
    "",
    "- **Node IDs are text-based** — same file recorded with slightly different paths can create duplicates. Use `delete_node` to clean up.",
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
    "| `init` | Load project brief, restore session |",
    "| `research` | 5-step research pipeline |",
    "| `impact` | Analyze change effects |",
    "| `navigate` | Trace code flow |",
    "| `changes` | View session change log |",
    "| `health` | Project health score 0-100 |",
    "| `digest` | Ultra-compact project briefing |",
    "| `drift` | Detect memory staleness |",
    "| `rollback` | Undo a change by change ID |",
    "",
    "### kuma_memory — Knowledge Recording",
    "",
    "| Action | Description |",
    "|--------|-------------|",
    "| `gotcha` | Record bug/quirk (IMMEDIATELY when found) |",
    "| `arch_flow` | Record architecture flow (max 5 core files) |",
    "| `decision` | Record ADR / decision rationale |",
    "| `research_save` | Cache research findings |",
    "| `search` | Search knowledge graph |",
    "| `session_mine` | Auto-extract insights from transcript |",
    "| `delete_node` | Remove node + graph + table entries |",
    "",
    "### kuma_safety — Safety & Verification",
    "",
    "| Action | Description |",
    "|--------|-------------|",
    "| `guard` | Anti-pattern detection before edits |",
    "| `verify` | Auto-run scoped tests after edits |",
    "| `gotcha_staleness` | Verify gotcha file references |",
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
    "## 🗑️ Graph Management",
    "",
    "**Delete:** `kuma_memory({ action: \"delete_node\", target: \"<node_id_or_type>\" })`",
    "- Deletes from graph nodes, edges, AND known_gotchas table (unified delete)",
    "",
    "**Clear entire graph:** `kuma_memory({ action: \"clear\" })`",
    "",
    "**Self-heal:** `kuma_safety({ action: \"gotcha_staleness\" })`",
    "- Verifies gotcha file/symbol references still exist",
    "- Removes obsolete gotchas (deleted files)",
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

/** OpenCode secondary: generate `.agents/skills/kuma/SKILL.md` for skill detection */
function handleOpencodeSecondary(root: string, results: InitResult[]): void {
  const skillPath = path.resolve(root, ".agents", "skills", "kuma", "SKILL.md");
  if (results.some(r => r.filePath === ".agents/skills/kuma/SKILL.md")) return;

  try {
    const dir = path.dirname(skillPath);
    const content = [
      "---",
      "name: kuma-mcp",
      "description: Kuma MCP — safety toolkit for AI coding agents. Research, memory, and safety guard.",
      "---",
      "",
      "Kuma MCP tools are installed (kuma_kuma_context, kuma_kuma_memory, kuma_kuma_safety).",
      "**Before coding, call `kuma_kuma_context({ action: \"init\" })`** to load project context.",
      "",
      "⚡ **DEFAULT WORKFLOW (Lean — 3 steps):**",
      "  1. `kuma_kuma_context({ action: \"init\" })` — Load context (START HERE)",
      "  2. *(edit/read using native tools)*",
      "  3. `kuma_kuma_context({ action: \"changes\" })` — Review session",
      "",
      "📝 **RECORD when needed:**",
      "  • Bug? → `kuma_kuma_memory({ action: \"gotcha\" })` | Flow? → `kuma_kuma_memory({ action: \"arch_flow\" })` | Decision? → `kuma_kuma_memory({ action: \"decision\" })`",
      "",
      "🔧 **ON-DEMAND:** guard (risky ops) | research (unfamiliar code) | verify (after edits)",
      "",
      "⚠️ **OpenCode note:** Tool names use `kuma_kuma_*` prefix.",
      "",
      "📖 Full rules: `.kuma/init.md`",
    ].join("\n");

    if (fs.existsSync(skillPath)) {
      const existing = fs.readFileSync(skillPath, "utf-8");
      if (existing.includes("kuma-mcp")) {
        results.push({ type: "opencode", filePath: ".agents/skills/kuma/SKILL.md", action: "skipped" });
        return;
      }
      // Smart append: keep existing content, append Kuma section
      const newContent = existing.trimEnd() + "\n\n---\n\n" + content;
      fs.writeFileSync(skillPath, newContent, "utf-8");
      results.push({ type: "opencode", filePath: ".agents/skills/kuma/SKILL.md", action: "appended" });
    } else {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(skillPath, content, "utf-8");
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
    "**DEFAULT: 3-Step Lean Workflow** (for most tasks):",
    "",
    "  1. `[kuma_]context({ action: \"init\" })` — Load context (START HERE)",
    "  2. *(edit/read using native tools)*",
    "  3. `[kuma_]context({ action: \"changes\" })` — Review session",
    "",
    "**Record only when something important happens:**",
    "- Found a bug/quirk? → `[kuma_]memory({ action: \"gotcha\" })` IMMEDIATELY",
    "- Traced a complete flow? → `[kuma_]memory({ action: \"arch_flow\" })` (max 5 core files)",
    "- Chose between options? → `[kuma_]memory({ action: \"decision\" })`",
    "",
    "**Safety checks (use when appropriate):**",
    "- Before risky edits: `[kuma_]safety({ action: \"guard\", guardGoal: \"...\" })`",
    "- After edits: `[kuma_]safety({ action: \"verify\", scope: \"<area>\" })`",
    "- Before research: `[kuma_]context({ action: \"research\", scope: \"<area>\" })`",
  "",
  "🗑️ **Delete/Clear:** `delete_node` (delete node/gotcha/todo/decision) | `clear` (wipe entire graph)",
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
      "| Changes | `kuma_kuma_context({ action: \"changes\" })` |",
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
      "| Changes | `kuma_context({ action: \"changes\" })` |",
      "",
      "---",
      "",
    );
  }

  lines.push(
    "📖 Rules: `.kuma/init.md`",
    "🧠 Memories: `.kuma/memories/*.md`",
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
        if (!existingContent.includes("_Generated by Kuma MCP_")) {
          const trimmed = existingContent.trimEnd();
          if (trimmed.endsWith("}")) {
            const updated = trimmed.slice(0, -1).trimEnd() + ',\n  "_kuma_note": "Kuma MCP - Generated by kuma init"\n}\n';
            fs.writeFileSync(mcpPath, updated, "utf-8");
            results.push({ type: "antigravity", filePath: ".agents/mcp_config.json", action: "appended" });
          }
        }
        return;
      }
      // Merge Kuma into existing mcp_config.json
      const parsed = JSON.parse(existingContent);
      parsed.mcpServers = parsed.mcpServers || {};
      parsed.mcpServers.kuma = { command: "npx", args: ["-y", "@plumpslabs/kuma"], env: {} };
      fs.writeFileSync(mcpPath, JSON.stringify(parsed, null, 2) + "\n", "utf-8");
      results.push({ type: "antigravity", filePath: ".agents/mcp_config.json", action: "appended" });
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

/** Generate .kuma/quickref.md — simplified cheat sheet */
function handleQuickrefGeneration(root: string, results: InitResult[]): void {
  const quickrefPath = path.resolve(root, ".kuma/quickref.md");
  const content = [
    "# Kuma Quick Reference",
    "",
    "## Lean Mode (default — for speed)",
    "1. `init` → edit → record (if needed)",
    "",
    "## Standard Mode (for safety)",
    "1. `init` → `guard` → `research` → edit → `record` → `verify`",
    "",
    "## Full Mode (for complex changes)",
    "1. `init` → `guard` → `research` → `impact` → edit → `record` → `verify` → `changes`",
    "",
    "## Record Rules",
    "- **MUST:** decision, gotcha, arch_flow, research_save, feature",
    "- **SKIP:** function, class, import, route",
    "- **RELATIONSHIPS:** Every node MUST have edges. No orphan nodes.",
    "",
    "## Platform Tool Names",
    "- OpenCode / Antigravity: `kuma_kuma_*`",
    "- Others: `kuma_*`",
    "",
    "📖 Full: `.kuma/init.md` | 📊 Modes: `.kuma/MODE.md` | 🟢 Skip: `.kuma/SKIP_RULES.md`",
    "_Generated by Kuma MCP - https://github.com/plumpslabs/kuma_",
  ].join("\n");

  try {
    const kumaDir = path.dirname(quickrefPath);
    if (!fs.existsSync(kumaDir)) fs.mkdirSync(kumaDir, { recursive: true });

    if (fs.existsSync(quickrefPath)) {
      const existing = fs.readFileSync(quickrefPath, "utf-8");
      if (existing.includes("_Generated by Kuma MCP_")) {
        results.push({ type: "claude", filePath: ".kuma/quickref.md", action: "skipped" });
        return;
      }
    }
    fs.writeFileSync(quickrefPath, content, "utf-8");
    results.push({ type: "claude", filePath: ".kuma/quickref.md", action: "created" });
  } catch (err) {
    results.push({
      type: "claude",
      filePath: ".kuma/quickref.md",
      action: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Generate .kuma/MODE.md */
function handleModeMdGeneration(root: string, results: InitResult[]): void {
  const filePath = path.resolve(root, ".kuma/MODE.md");
  const content = [
    "# Adaptive Mode Selector",
    "",
    "## Mode Definitions",
    "",
    "| Mode | When to Use | Token Cost | Steps |",
    "|------|-------------|------------|-------|",
    "| **Lean** (default) | Small fixes, familiar code, hotfixes, < 3 files | ~100 | 3 |",
    "| **Standard** | New features, unfamiliar modules, 3-10 files | ~300 | 5 |",
    "| **Full** | Cross-module refactors, architecture changes, > 10 files | ~500 | 7 |",
    "",
    "## Auto-Detection Rules",
    "",
    "```",
    "IF file_count < 3 AND area_familiar == true:",
    "  mode = \"lean\"",
    "ELSE IF file_count <= 10 OR area_familiar == false:",
    "  mode = \"standard\"",
    "ELSE IF file_count > 10 OR cross_module == true:",
    "  mode = \"full\"",
    "```",
    "",
    "## Mode Behaviors",
    "",
    "### Lean Mode (Default)",
    "- Skip: guard, research, verify, changes",
    "- Record: only if decision/gotcha explicit",
    "- Focus: speed, minimal overhead",
    "",
    "### Standard Mode",
    "- Include: guard (before unfamiliar), research (before edit)",
    "- Record: decision, gotcha, arch_flow (if complex)",
    "- Focus: safety + knowledge capture",
    "",
    "### Full Mode",
    "- Include: all steps including impact, changes",
    "- Record: everything valuable",
    "- Focus: completeness, audit trail",
    "",
    "_Generated by Kuma MCP - https://github.com/plumpslabs/kuma_",
  ].join("\n");

  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, content, "utf-8");
      results.push({ type: "claude", filePath: ".kuma/MODE.md", action: "created" });
    }
  } catch (err) {
    results.push({ type: "claude", filePath: ".kuma/MODE.md", action: "error", error: err instanceof Error ? err.message : String(err) });
  }
}

/** Generate .kuma/SKIP_RULES.md */
function handleSkipRulesMdGeneration(root: string, results: InitResult[]): void {
  const filePath = path.resolve(root, ".kuma/SKIP_RULES.md");
  const content = [
    "# Skip Rules — What NOT to Record",
    "",
    "## 🟢 NEVER Record (grep/glob is faster)",
    "",
    "| What | Why Skip | Better Tool |",
    "|------|----------|-------------|",
    "| Function definitions | `grep funcName(` | Grep |",
    "| Class definitions | `grep class ClassName` | Grep |",
    "| Import statements | Read import block | Read |",
    "| Component definitions | `glob **/*Component*` | Glob |",
    "| Route definitions | Check router file | Read |",
    "| Type/interface definitions | `grep interface TypeName` | Grep |",
    "| Variable/const declarations | `grep const varName` | Grep |",
    "| Test file locations | `glob **/*.test.*` | Glob |",
    "",
    "## 🔴 ALWAYS Record (high value)",
    "",
    "| What | Why Record | Tool |",
    "|------|------------|------|",
    "| Architecture decisions with rationale | Preserves context | `decision` |",
    "| Bugs/quirks found and fixed | Prevents re-discovery | `gotcha` |",
    "| Cross-module flow paths | Saves 5-10 files next session | `arch_flow` |",
    "| Business rules discovered | Domain knowledge | `domain_rules` |",
    "",
    "## 🟡 Record ONLY If Complex",
    "",
    "| What | Condition | Tool |",
    "|------|-----------|------|",
    "| Research findings | Multi-file exploration (> 3 files) | `research_save` |",
    "| Architecture flow | Cross-service or > 3 hops | `arch_flow` |",
    "| Feature definition | High-level feature with owns edges | `feature` |",
    "",
    "_Generated by Kuma MCP - https://github.com/plumpslabs/kuma_",
  ].join("\n");

  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, content, "utf-8");
      results.push({ type: "claude", filePath: ".kuma/SKIP_RULES.md", action: "created" });
    }
  } catch (err) {
    results.push({ type: "claude", filePath: ".kuma/SKIP_RULES.md", action: "error", error: err instanceof Error ? err.message : String(err) });
  }
}

/** Generate .kuma/STALENESS.md */
function handleStalenessMdGeneration(root: string, results: InitResult[]): void {
  const filePath = path.resolve(root, ".kuma/STALENESS.md");
  const content = [
    "# Auto-Staleness Detection",
    "",
    "## Staleness Signals",
    "",
    "| Signal | Detection | Action |",
    "|--------|-----------|--------|",
    "| File modified after save | Compare file mtime vs research_save timestamp | Mark STALE, skip cache |",
    "| Git commit touches file | `git log --since` on researched files | Mark STALE, warn |",
    "| Age > 7 days | Current time - research_save timestamp | Warn: \"Cache may be stale\" |",
    "| Age > 30 days | Current time - research_save timestamp | Auto-invalidate, re-read |",
    "",
    "## Recovery Protocol",
    "",
    "```",
    "ON stale_detected:",
    "  1. Skip cached data",
    "  2. Re-read file from disk",
    "  3. Update research_save timestamp",
    "  4. Continue with fresh data",
    "",
    "ON search_conflict:",
    "  1. Prefer recent research (newer timestamp)",
    "  2. If same age, prefer live file over cache",
    "  3. Log conflict for review",
    "```",
    "",
    "_Generated by Kuma MCP - https://github.com/plumpslabs/kuma_",
  ].join("\n");

  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, content, "utf-8");
      results.push({ type: "claude", filePath: ".kuma/STALENESS.md", action: "created" });
    }
  } catch (err) {
    results.push({ type: "claude", filePath: ".kuma/STALENESS.md", action: "error", error: err instanceof Error ? err.message : String(err) });
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

  // Always generate quickref.md, MODE.md, SKIP_RULES.md, STALENESS.md alongside init.md
  handleQuickrefGeneration(root, results);
  handleModeMdGeneration(root, results);
  handleSkipRulesMdGeneration(root, results);
  handleStalenessMdGeneration(root, results);
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
            // For antigravity/openclaw/codewhale, still try secondary even if primary skipped
            if (type === "antigravity") {
              handleAntigravityMcpConfig(root, results);
            } else if (type === "openclaw") {
              handleOpenclawSecondary(root, results);
            } else if (type === "codewhale") {
              handleCodewhaleSecondary(root, results);
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
          handleAntigravityMcpConfig(root, results);
        } else if (type === "openclaw") {
          handleOpenclawSecondary(root, results);
        } else if (type === "codewhale") {
          handleCodewhaleSecondary(root, results);
        } else if (type === "aider") {
          handleAiderSecondary(root, results);
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
