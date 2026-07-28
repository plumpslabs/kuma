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

/** Thin bootstrap snippet — shared across all config files */
const BOOTSTRAP_LINES = [
  "Kuma MCP tools are installed (kuma_context, kuma_memory, kuma_safety).",
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
  "📖 Full rules: `.kuma/init.md`",
  "🧠 Tools: `kuma_context` | `kuma_memory` | `kuma_safety`",
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

/** OpenCode AGENTS.md section — uses kuma_kuma_* prefix (OpenCode doubles the prefix) */
function opencodeAgentsMdTemplate(): string {
  const opencodeLines = [
    "Kuma MCP tools are installed (kuma_kuma_context, kuma_kuma_memory, kuma_kuma_safety).",
    "**Before coding, call `kuma_kuma_context({ action: \"init\" })`** to load project context.",
    "Project knowledge persists in `.kuma/memories/*.md` across sessions.",
    "",
    "⚠️ **MANDATORY WORKFLOW** — Follow in order every session (including research-only):",
    "",
    "  1. `kuma_kuma_context({ action: \"init\" })`                    — Load context (START HERE)",
    "  2. `kuma_kuma_safety({ action: \"guard\" })`                    — Safety check before work",
    "  3. `kuma_kuma_context({ action: \"research\", scope: \"<area>\" })` — Research before editing",
    "  4. *(edit/read using native tools)*",
    "  5. `kuma_kuma_memory({ action: \"research_save\", ... })`       — After exploring area (creates search cache)",
    "  6. `kuma_kuma_memory({ action: \"gotcha\" })`                   — 🔥 IMMEDIATELY when bug found (exponential value)",
    "  7. `kuma_kuma_memory({ action: \"arch_flow\" })`                — 🔥 IMMEDIATELY after each flow hop (exponential value)",
    "  8. `kuma_kuma_memory({ action: \"decision\" })`                 — When choosing between options (preserves rationale)",
    "  9. `kuma_kuma_safety({ action: \"verify\", ... })`              — Run tests / confirm nothing broken",
    " 10. `kuma_kuma_context({ action: \"changes\" })`                 — Review session activity",
    "",
    "🔥 **Power Curve:** `arch_flow` + `gotcha` are EXPONENTIAL — each record saves 5-10 files next session.",
    "   The more you record, the more overpowered the agent becomes. These are the highest-value actions.",
    "🟢 **SKIP** recording function/class/component nodes — grep/glob is faster.",
    "🧠 Knowledge graph is persistent — nodes/edges accumulate across sessions, getting richer over time.",
    "",
    "⚠️ **OpenCode platform note:** Tool names use `kuma_kuma_*` prefix",
    "   (server name `kuma` + already-prefixed tool name `kuma_context`).",
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

/** Antigravity SKILL.md template */
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
    "# Kuma Init — Mandatory Workflow",
    "",
    "_(Auto-generated by `kuma init` — edit this file directly to customize rules)_",
    "",
    "---",
    "",
    "> ⚠️ **Platform Tool Names:**",
    "> • **OpenCode / Antigravity:** Use `kuma_kuma_*` prefix (e.g. `kuma_kuma_context({ action: \"init\" })`)",
    "> • **Other platforms (Claude, Cursor, Cline, etc.):** Use `kuma_*` directly (e.g. `kuma_context({ action: \"init\" })`)",
    "> • **Replace `kuma_` with `kuma_kuma_` in all examples below if you're on OpenCode.**",
    "",
    "---",
    "",
    "## ⚠️ SESSION WORKFLOW — Follow Steps in Order",
    "",
    "### STEP 1: Init Session (ALWAYS — Start of Session)",
    "```",
    "kuma_context({ action: \"init\" })",
    "```",
    "**When:** Every session start or project switch",
    "**Why:** Load project brief, restore session memory, populate knowledge graph",
    "",
    "### STEP 2: Safety Guard (ALWAYS — Before Work)",
    "```",
    "kuma_safety({ action: \"guard\", guardGoal: \"describe your intent\" })",
    "```",
    "**When:** After STEP 1, before research or editing",
    "**Why:** Detect anti-patterns, code drift, runaway loops upfront",
    "",
    "### STEP 3: Research (MANDATORY — Before Editing Unfamiliar Code)",
    "```",
    "kuma_context({ action: \"research\", scope: \"<target area>\" })",
    "```",
    "**When:** Every time you plan to edit code in an unfamiliar area",
    "**Why:** 5-step pipeline: cache load → staleness check → graph query → impact analysis → decision lookup",
    "",
    "> ⛔ DO NOT EDIT FILES BEFORE STEP 3 — Unless trivial/minor change",
    "",
    "### STEP 4: EDIT/READ — Implement (Use Agent Native Tools)",
    "```",
    "# Use agent BUILT-IN tools to read, grep, edit, create files",
    "# Kuma does NOT manage files — that's your agent's job",
    "```",
    "",
    "> ⚠️ **Research-only sessions included.** Workflow ini wajib meskipun session hanya membaca/riset tanpa code changes.",
    "",
    "> 🧠 **Graph Philosophy:** Record findings INLINE as you work, not just at the end. Every time you read a",
    "> file, grep a pattern, or trace a flow — call `research_save` immediately to persist what you learned.",
    "> The knowledge graph accumulates across sessions. The more you use it, the richer it becomes.",
    "",
    "> 🔬 **Scanner vs Inline Recording:**",
    "> • Scanner = cold start only. Auto-detects structure in TS/JS/TSX/JSX files during research step 3.",
    "> • Inline Recording = primary method. You (the agent) record findings as you read/grep/edit.",
    "> • Non-TS/JS projects (Go, Ruby, Python, Rust, PHP) rely ENTIRELY on inline recording.",
    "",
    "**AUTO-RECORDED (cold start scanner — TS/JS only):**",
    "- Files, Functions, Classes → scanned during research step 3",
    "- Imports, Calls, Extends → scanned edges",
    "- Components, Routes → scanned when patterns match",
    "",
    "🔴 **MUST RECORD — High Impact (use MCP):**",
    "- `arch_flow` — IMMEDIATELY after each flow hop. Saves reading 5-10 files next session.",
    "- `gotcha` — IMMEDIATELY when bug/quirk found. No re-research needed.",
    "- `decision` — IMMEDIATELY when choosing. Preserves rationale context.",
    "- `research_save` — After exploring area. Creates searchable cache + graph file node.",
    "",
    "🟢 **SKIP — Low Impact (agent can grep faster):**",
    "- Function/class nodes → grep `funcName(` / `class ClassName`",
    "- Component nodes → glob `**/*ComponentName*`",
    "- Import edges → check imports directly",
    "- Route nodes → check router file directly",
    "- Visual graph → for humans, not AI agents",
    "",
    "**RECORD INLINE — Focus on high-impact actions:**",
    "- Finished tracing a flow? → `arch_flow` IMMEDIATELY (saves reading 5-10 files next session)",
    "- Found a bug/quirk? → `gotcha` IMMEDIATELY (no re-research needed)",
    "- Chose between options? → `decision` IMMEDIATELY (preserves rationale)",
    "- Explored a new area? → `research_save` (creates searchable cache)",
    "",
    "**SKIP recording these — grep/glob is faster:**",
    "- Function/class nodes → just `grep funcName(` or `grep class ClassName`",
    "- Component/route nodes → glob directly",
    "- Import edges → read import statements",
    "- Visual graph → for humans, not AI",
    "",
    "### STEP 5: Save Research (RECORD INLINE — After Every Read/Grep)",
    "```",
    "kuma_memory({ action: \"research_save\", scope: \"<file or area>\", confidence: 0.8 })",
    "```",
    "**When:** After EVERY read/grep that discovers new files, functions, imports, or patterns. Don't wait — record inline!",
    "**Why:** Persist findings into knowledge graph + research cache. Graph grows richer across sessions.",
    "",
    "### STEP 6: Record Gotchas (RECORD INLINE — When Bug Found)",
    "```",
    "kuma_memory({ action: \"gotcha\", filePath: \"<file>\", description: \"...\", severity: \"medium\" })",
    "```",
    "**When:** IMMEDIATELY when you discover bugs, quirks, unexpected behavior, or workarounds. Record INLINE, don't save for later.",
    "**Why:** Prevents future agents from hitting the same issues. Every bug = a gotcha. Skip now = lost forever.",
    "",
    "### STEP 7: Record Arch Flow (RECORD INLINE — When Tracing Flow)",
    "```",
    "kuma_memory({ action: \"arch_flow\", content: \"...\" })",
    "```",
    "**When:** IMMEDIATELY after tracing EACH hop in a data/control flow. Record INLINE, then continue tracing the next hop.",
    "**Why:** Architecture knowledge dissipates fast. Record each hop before moving to the next file/task.",
    "",
    "### STEP 8: Record Decision (RECORD INLINE — When Choosing)",
    "```",
    "kuma_memory({ action: \"decision\", decisionAction: \"record\", title: \"...\", outcome: \"...\" })",
    "```",
    "**When:** IMMEDIATELY when you choose between 2+ options, uncover an architecture pattern, or identify a root cause.",
    "**Why:** Saves ADR (Architecture Decision Record). Bukan cuma code changes — temuan, tradeoffs, root causes juga.",
    "",
    "### STEP 9: Verify (MANDATORY — After Research/Editing)",
    "```",
    "kuma_safety({ action: \"verify\", scope: \"<area or file>\" })",
    "```",
    "**When:** After research/edits are done, before switching tasks. Even for research-only — confirms nothing is broken.",
    "**Why:** Auto-run scoped tests + AST code validation. If no test framework, at minimum report \"No tests to run\".",
    "",
    "### STEP 10: Check Changes (MANDATORY — End of Session)",
    "```",
    "kuma_context({ action: \"changes\" })",
    "```",
    "**When:** End of session or before git commit. Even 0 changes = valid result to confirm.",
    "**Why:** View session log of all modifications + tool calls made in this session.",
    "",
    "---",
    "",
    "## 📋 Tool Reference",
    "",
    "### 🧠 kuma_context — Context & Research",
    "",
    "| Action | Description | When to Call |",
    "|--------|-------------|--------------|",
    "| `init` | Load project brief, restore session | STEP 1 — Every session |",
    "| `research` | 5-step research pipeline | STEP 3 — Before edits |",
    "| `impact` | Analyze change effects on symbol | After research, before design |",
    "| `navigate` | Trace code flow | When need to understand call flow |",
    "| `changes` | View session change log | STEP 10 — End of session |",
    "| `health` | Project health score 0-100 | Periodic check |",
    "| `digest` | Ultra-compact project briefing | Session start (alt to init) |",
    "| `drift` | Detect memory staleness | When suspecting stale context |",
    "",
    "### 📝 kuma_memory — Decision & Knowledge",
    "",
    "| Action | Description | When to Call |",
    "|--------|-------------|--------------|",
    "| `research_save` | Save research results | STEP 5 — IMMEDIATELY after every read/grep (inline) |",
    "| `gotcha` | Record bugs/quirks/workarounds | STEP 6 — IMMEDIATELY when bug found (inline) |",
    "| `arch_flow` | Document architecture flow | STEP 7 — IMMEDIATELY after each flow hop (inline) |",
    "| `decision` | ADR-style decision record | STEP 8 — IMMEDIATELY when choosing (inline) |",
    "| `mine` | Mine decisions from git log | When need historical context |",
    "| `session` | Session summary | End of session |",
    "| `heal` | Self-heal knowledge graph | When graph has errors |",
    "| `search` | Search memories + graph | Find stored information |",
    "| `todo` | Persistent todo CRUD | When managing tasks |",
    "| `context` | Inject context notes | Additional notes when needed |",
    "| `domain_rules` | Layer 1: business rules | Record business rules when discovered |",
    "| `add_node` | Create structural nodes (low impact — grep is faster) | Rarely needed; only for visualize debugging |",
    "| `layers` | Show all 3 layers summary | Overview memory layers |",
    "",
    "### 🛡️ kuma_safety — Safety & Policy",
    "",
    "| Action | Description | When to Call |",
    "|--------|-------------|--------------|",
    "| `guard` | Anti-pattern, drift, loop | STEP 2 — Before work |",
    "| `verify` | Auto-run scoped tests + validation | STEP 9 — After research/edits |",
    "| `check` | Pre-execution safety check | Before risky operations |",
    "| `audit` | Query safety audit trail | Security investigation |",
    "| `lock` | Multi-agent file lock | Multi-agent collaboration |",
    "| `health` | Safety score 0-100 | Periodic check |",
    "| `policy` | Policy-as-Code engine | Evaluate command/file paths |",
    "| `ast` | AST-based code validation | Code correctness checks |",
    "| `checkpoint` | Create atomic snapshot | Before major refactors |",
    "| `contract` | Pre/post-condition check | Contract verification |",
    "",
    "---",
    "",
    "## 📊 Knowledge Graph — Node Types & Shapes",
    "",
    "Kuma's knowledge graph visualizes your project structure. Each node type has a unique shape:",
    "",
    "| Shape | Node Type | Description | Auto/Manual |",
    "|-------|-----------|-------------|-------------|",
    "| ▢ `box` | function | Functions (named/arrow) | AUTO by scanner |",
    "| ⬡ `hexagon` | class | Classes (TS/JS) | AUTO by scanner |",
    "| ○ `ellipse` | module | Directory modules | AUTO by scanner |",
    "| ◇ `diamond` | component | React/Vue components | AUTO by scanner |",
    "| ▣ `square` | file | Source files | AUTO by scanner |",
    "| ▲ `triangle` | route | API routes | AUTO by scanner |",
    "| ⭒ `star` | test | Test files/describes | AUTO by scanner |",
    "| 📄 `note` | context | Manual context notes | MANUAL — kuma_memory context |",
    "| 🏛️ `feature_domain` | FeatureDomain | High-level feature domain anchor | MANUAL — kuma_memory arch_flow (domain:) |",
    "| 🔗 `cross_service_link` | Workflow hop | Cross-service/inter-file flow step | MANUAL — kuma_memory arch_flow (hops:) |",
    "| 🏷️ `tag` | domain_rule | Business rules (Layer 1) | MANUAL — kuma_memory domain_rules |",
    "| 🔀 `flow` | arch_flow | Architecture flows (Layer 2) | MANUAL — kuma_memory arch_flow |",
    "| ⚠️ `warning` | gotcha | Known gotchas (Layer 3) | MANUAL — kuma_memory gotcha |",
    "| 📌 `milestone` | decision | Architecture decisions | MANUAL — kuma_memory decision |",
    "| ✅ `checklist` | todo | Persistent todos | MANUAL — kuma_memory todo |",
    "",
    "**Edges (connections between nodes):**",
    "- `imports` — file imports another (AUTO)",
    "- `calls` — function calls another (AUTO)",
    "- `defines` — file defines function/class (AUTO)",
    "- `depends_on` — logical dependency (AUTO + MANUAL)",
    "- `extends` — class extends class (AUTO)",
    "- `contains` — file contains function (AUTO)",
    "- `composes` — component contains sub-component (AUTO)",
    "- `references` — node references context note (MANUAL)",
    "",
    "---",
    "",
    "## 📌 Workflow Summary",
    "",
    "```",
    "EVERY SESSION (Mandatory — including research-only):",
    "  1. kuma_context   → init                — Load project context",
    "  2. kuma_safety    → guard               — Safety check",
    "  3. kuma_context   → research            — Research target area",
    "  --- EDIT/READ (use native tools) ---",
    "  5. kuma_memory    → research_save       — After exploring area (creates search cache)",
    "  6. kuma_memory    → gotcha              — 🔥 IMMEDIATELY when bug found (exponential)",
    "  7. kuma_memory    → arch_flow           — 🔥 IMMEDIATELY after each flow hop (exponential)",
    "  8. kuma_memory    → decision            — When choosing (preserves rationale)",
    "  9. kuma_safety    → verify              — Run tests / confirm nothing broken",
    " 10. kuma_context   → changes             — Review session activity",
    "",
    "🔥 `arch_flow` + `gotcha` are EXPONENTIAL — each record saves 5-10 files next session.",
    "🟢 SKIP recording function/class/component nodes — grep/glob is faster.",
    "🧠 Graph is persistent — nodes/edges accumulate across sessions.",
    "",
    "ON DISCOVERY (When needed):",
    "  kuma_memory → domain_rules   — Business rules (Layer 1)",
    "  kuma_memory → context        — Additional notes",
    "  kuma_memory → todo           — Task management",
    "  kuma_memory → mine           — Historical context",
    "  kuma_memory → add_node       — Manual function/class/component node (for visualize)",
    "```",
    "",
    "## 🧠 How the Scanner Works",
    "",
    "Kuma's code scanner (`kumaCodeScanner.ts`) uses **lightweight regex-based pattern matching**",
    "for **cold start** — giving new agents basic project structure on first session.",
    "It is NOT a full AST parser (no Babel/TypeScript compiler dependency).",
    "",
    "**Scope:** TS/JS/TSX/JSX only. Non-TypeScript projects (Go, Ruby, Python, Rust, PHP, etc.)",
    "rely entirely on **AI inline recording** — the agent records what it discovers as it works.",
    "",
    "**What auto-scanner detects (line-by-line regex, TS/JS only):**",
    "- `function` declarations (named + async + generator)",
    "- Arrow function assignments (`const foo = (...) => ...`)",
    "- Typed arrow functions (`const foo: Type = (...) => ...`)",
    "- Class declarations (includes extends/implements)",
    "- React/Vue components (functions returning JSX)",
    "- API route handlers (Express + Hono patterns)",
    "- Import statements (local file imports only)",
    "- Function calls cross-file (`calls` edges)",
    "- Test files (`.test.`, `.spec.`, `__tests__/`)",
    "",
    "**Known limitations:**",
    "- Regex-based: can miss multi-line constructs or non-standard patterns",
    "- Complex generics or deeply nested syntax may not match",
    "- TypeScript advanced types may be partially parsed",
    "- Scanner runs during `kuma_context research` step 3 (max 200 files)",
    "- If scanner returns 0 structural nodes, the regex patterns didn't match your code style",
    "",
    "**Key principle: Scanner = cold start, Inline Recording = primary.**",
    "The scanner populates initial graph structure. Every subsequent session, the agent's",
    "inline recording (research_save, gotcha, arch_flow, decision) enriches the graph further.",
    "The more you use Kuma, the richer the graph becomes — persistent across sessions.",
    "",
    "---",
    "",
    "## 💾 How to Retrieve Past Research — research_save → search",
    "",
    "Kuma stores knowledge in two places. The primary retrieval method for AI agents",
    "is **`search`**, not `visualize`. Visualize is for human debugging, not agent consumption.",
    "",
    "**Flow: research_save → search (for agents)**",
    "- Save: `kuma_memory({ action: \"research_save\", scope: \"<file or area>\", confidence: 0.8 })`",
    "- Retrieve: `kuma_memory({ action: \"search\", query: \"<term>\" })`",
    "- Auto-load: `kuma_context({ action: \"research\", scope: \"<area>\" })`",
    "- List cache: `kuma_context({ action: \"researches\" })`",
    "",
    "**Key design:** `research_save` now creates BOTH research cache entries AND",
    "knowledge graph nodes (file + research scope). This means `search` finds",
    "past research even if the graph scanner didn't detect your code style.",
    "",
    "**Quick retrieval tips:**",
    "- `kuma_memory({ action: \"search\", query: \"<term>\" })` — **primary method**. Finds past research + graph nodes + codebase",
    "- `kuma_context({ action: \"research\", scope: \"<area>\" })` — deep 5-step research, auto-loads past cache",
    "- `kuma_context({ action: \"init\" })` — shows graph stats + recent research + health score",
    "- `kuma_context({ action: \"drift\" })` — check if memories are stale vs actual code",
    "- `kuma_context({ action: \"changes\" })` — view session activity log",
    "- `kuma_context({ action: \"visualize\" })` — (human debugging) Mermaid diagram of the graph",
    "",
    "---",
    "",
    "## 🔬 How Verification Works",
    "",
    "`kuma_safety({ action: \"verify\", scope: \"<area>\" })` — STEP 9",
    "",
    "**Auto-detection logic:**",
    "1. Checks `package.json` → `scripts.test` → uses npm/pnpm/yarn test",
    "2. If no test script, checks for Makefile with `test:` target",
    "3. Falls back to Python (pytest), Rust (cargo test), Go (go test)",
    "4. Last resort: `npx tsc --noEmit` (TypeScript syntax check) or `node -c`",
    "5. If nothing found: returns informative message instead of failing",
    "",
    "**Important:** Verification is NEVER auto-triggered. You must call it explicitly.",
    "The 5-layer safety guard (concurrency lock, rate limiting, staleness cache,",
    "runaway detection, hard timeout) prevents resource exhaustion.",
    "",
    "---",
    "",
    "## 🚫 What Kuma Does NOT Do (Use Agent Native Tools)",
    "",
    "| Function | Correct Tool |",
    "|----------|-------------|",
    "| Edit files | Agent native edit tools |",
    "| Search code | Agent native grep/search |",
    "| Run commands | Agent native terminal |",
    "| Create files | Agent native file creation |",
    "| Git operations | Agent native git tools |",
    "| Lint/test | Agent native run commands |",
    "",
    "---",
    "_Generated by Kuma MCP - https://github.com/plumpslabs/kuma_",
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
      "**Before coding, call `kuma_kuma_context({ action: \"init\" })`** to load project context and session memory.",
      "Project knowledge persists in `.kuma/memories/*.md` across sessions.",
      "",
      "⚠️ **MANDATORY WORKFLOW** — Follow in order every session (including research-only):",
      "",
      "  1. `kuma_kuma_context({ action: \"init\" })`                            — Load context (START HERE)",
      "  2. `kuma_kuma_safety({ action: \"guard\" })`                            — Safety check before work",
      "  3. `kuma_kuma_context({ action: \"research\", scope: \"<area>\" })`        — Research before editing",
      "  4. *(edit/read using native tools)*",
      "  5. `kuma_kuma_memory({ action: \"research_save\", ... })`               — After exploring area (creates search cache)",
      "  6. `kuma_kuma_memory({ action: \"gotcha\" })`                           — 🔥 IMMEDIATELY when bug found (exponential)",
      "  7. `kuma_kuma_memory({ action: \"arch_flow\" })`                        — 🔥 IMMEDIATELY after each flow hop (exponential)",
      "  8. `kuma_kuma_memory({ action: \"decision\" })`                         — When choosing (preserves rationale)",
      "  9. `kuma_kuma_safety({ action: \"verify\", ... })`                      — Run tests / confirm nothing broken",
      " 10. `kuma_kuma_context({ action: \"changes\" })`                         — Review session activity",
      "",
      "🔥 `arch_flow` + `gotcha` = EXPONENTIAL value. Each record saves 5-10 files next session.",
      "🟢 SKIP recording function/class/component nodes — grep/glob is faster.",
      "🧠 Graph is persistent — nodes/edges accumulate across sessions.",
      "",
      "⚠️ **OpenCode platform note:** Tool names are prefixed with `kuma_kuma_*`",
      "   (server name `kuma` + already-prefixed tool name `kuma_context`).",
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
    "> ⚠️ **WARNING:** Agent often skip steps due to \"research-only\" bias. Do NOT skip.",
    "> Follow the full 10-step workflow even for read-only investigations.",
    "",
    "## ⚠️ MANDATORY WORKFLOW",
    "",
    "Follow these steps in order every session (including research-only):",
    "",
    "  1. `[kuma_]context({ action: \"init\" })`                     — Load project context (START HERE)",
    "  2. `[kuma_]safety({ action: \"guard\" })`                     — Safety check before editing",
    "  3. `[kuma_]context({ action: \"research\", scope: \"<area>\" })` — Research before editing",
    "  4. *(edit/read using native tools)*",
  "  5. `[kuma_]memory({ action: \"research_save\", ... })`        — After exploring area (creates search cache)",
  "  6. `[kuma_]memory({ action: \"gotcha\" })`                    — 🔥 IMMEDIATELY when bug found (exponential)",
  "  7. `[kuma_]memory({ action: \"arch_flow\" })`                 — 🔥 IMMEDIATELY after each flow hop (exponential)",
  "  8. `[kuma_]memory({ action: \"decision\" })`                  — When choosing (preserves rationale)",
  "  9. `[kuma_]safety({ action: \"verify\", ... })`               — Run tests / confirm nothing broken",
  " 10. `[kuma_]context({ action: \"changes\" })`                  — Review session activity",
  "",
  "🔥 `arch_flow` + `gotcha` = EXPONENTIAL value. Each record saves 5-10 files next session.",
  "🟢 SKIP recording function/class/component nodes — grep/glob is faster.",
  "🧠 Graph is persistent — nodes/edges accumulate across sessions.",
  "",
  "⛔ Do NOT skip steps 5-10 after research — even if no code was changed.",
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
    "_(Auto-generated by `kuma init` — simplified workflow cheat sheet)_",
    "",
    "## Every Session (Mandatory — including research-only)",
    "",
    "  1. `kuma_context({ action: \"init\" })`                             — Load context",
    "  2. `kuma_safety({ action: \"guard\" })`                             — Safety check",
    "  3. `kuma_context({ action: \"research\", scope: \"<area>\" })`         — Research",
    "  4. *(edit/read using native tools)*",
    "  5. `kuma_memory({ action: \"research_save\", ... })`                — After exploring area (creates search cache)",
    "  6. `kuma_memory({ action: \"gotcha\" })`                            — 🔥 IMMEDIATELY when bug found (exponential)",
    "  7. `kuma_memory({ action: \"arch_flow\" })`                         — 🔥 IMMEDIATELY after each flow hop (exponential)",
    "  8. `kuma_memory({ action: \"decision\" })`                          — When choosing (preserves rationale)",
    "  9. `kuma_safety({ action: \"verify\", ... })`                       — Run tests / confirm nothing broken",
    " 10. `kuma_context({ action: \"changes\" })`                          — Review session activity",
    "",
    "🔥 `arch_flow` + `gotcha` = EXPONENTIAL value. Each record saves 5-10 files next session.",
    "🟢 SKIP recording function/class/component nodes — grep/glob is faster.",
    "🧠 Graph is persistent — nodes/edges accumulate across sessions.",
    "",
    "⛔ Steps 5-10 are mandatory even for research-only sessions!",
    "",
    "## Platform Tool Names",
    "",
    "- **OpenCode:** Use `kuma_kuma_*` prefix (e.g. `kuma_kuma_context`)",
    "- **Other platforms:** Use `kuma_*` directly (e.g. `kuma_context`)",
    "",
    "📖 Full rules: `.kuma/init.md`",
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
      results.push({ type: "claude", filePath: ".kuma/quickref.md", action: "skipped" });
    } else {
      fs.writeFileSync(quickrefPath, content, "utf-8");
      results.push({ type: "claude", filePath: ".kuma/quickref.md", action: "created" });
    }
  } catch (err) {
    results.push({
      type: "claude",
      filePath: ".kuma/quickref.md",
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

  // Always generate quickref.md alongside init.md
  handleQuickrefGeneration(root, results);
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
