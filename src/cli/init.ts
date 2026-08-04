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
  "  • `kuma_context({ action: \"history\", target: \"<file>\" })` — WHY this file is written this way",
  "  • `kuma_safety({ action: \"verify\" })` — after edits to confirm nothing broken",
  "",
  "🪄 **Auto-inject (Claude Code):** gotcha/decision/history injected automatically before edits",
  "   via the PreToolUse hook — an empty hook output means the file has no gotchas.",
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
    "🪄 **Auto-inject hook:** `.claude/settings.json` wires a PreToolUse hook",
    "   (`kuma hook pre-edit`) — gotchas/decisions/history injected before edits.",
    "   ⚠️ Requires `kuma` on PATH (global install). A silent hook means no gotchas for that file.",
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
    "> • **OpenCode:** Use `kuma_kuma_*` prefix (e.g. `kuma_kuma_context({ action: \"init\" })`)",
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
    "kuma_memory({ action: \"decision\", title: \"...\", context: \"...\", rationale: \"...\", outcome: \"...\" })",
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
    "| `init` | Lean project brief, restore session |",
    "| `history` | Why is this file written this way (cross-session trace) |",
    "| `flow` | Hash-verified derived flow cache (F13) |",
    "| `impact` | Analyze change effects |",
    "| `navigate` | Trace code flow |",
    "| `changes` | View session change log |",
    "| `digest` | Ultra-compact project briefing |",
    "| `drift` | Detect memory staleness |",
    "| `rollback` | Undo a change by change ID |",
    "| `resume` | Load previous session context |",
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
    "| `session` | Session summary |",
    "| `mine` | Mine decisions from git history |",
    "| `delete_node` | Remove node + graph + table entries |",
    "| `goal_progress` | Track goal completion |",
    "",
    "### kuma_safety — Safety & Verification",
    "",
    "| Action | Description |",
    "|--------|-------------|",
    "| `guard` | Anti-pattern detection before edits |",
    "| `verify` | Auto-run scoped tests after edits |",
    "| `check` | Pre-execution safety check |",
    "| `audit` | Query audit trail |",
    "| `security` | Security leak scanner |",
    "| `gc` | Garbage collection |",
    "| `ast`/`validate` | AST-based code validation |",
    "| `checkpoint` | Atomic snapshot before refactors |",
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
 * (Roadmap F2 — auto-inject shadow memory before every Edit/Write/MultiEdit).
 * Merges with existing settings (hooks never overwrite other keys).
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
