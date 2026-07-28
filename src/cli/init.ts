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
  opencode: "OpenCode (opencode.json + skills)",
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
    case "opencode": return "opencode.json";
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
  "Kuma MCP tools are installed. All behavioral rules are in `.kuma/init.md`.",
  "**Before coding, call `kuma_init()`** to load project context and session memory.",
  "Project knowledge persists in `.kuma/memories/*.md` across sessions.",
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
    "**Before coding, load project context via `kuma_init()`.**",
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
    "  - \"*\"",
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

/** OpenCode opencode.json template */
function opencodeTemplate(): string {
  const config = {
    $schema: "https://opencode-ai.github.io/schema.json",
    mcp: {
      kuma: {
        type: "local",
        command: ["npx", "-y", "@plumpslabs/kuma"],
        enabled: true,
      },
    },
    instructions: [".kuma/init.md"],
  };
  return JSON.stringify(config, null, 2) + "\n";
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
// .kuma/init.md — Full behavioral rules (one source of truth)
// ============================================================

/** Generate .kuma/init.md content — full rules, not thin bootstrap */
export function generateInitMdContent(): string {
  return [
    "# Kuma Init — Behavioral Rules",
    "",
    "_(Auto-generated by \`kuma init\` — edit this file directly to customize rules)_",
    "",
    "## Kuma V3 — 3 Coarse-Grained Tools",
    "",
    "Kuma provides 3 pipeline-driven tools. Each action triggers a multi-step deterministic workflow internally.",
    "",
    "### 🧠 kuma_context — Context & Research (call FIRST every session)",
    "",
    "- `kuma_context({ action: \"init\" })` — Load project brief, detect stack, show structure",
    "- **`kuma_context({ action: \"research\", scope: \"...\" })` — WAJIB before editing unfamiliar code**",
    "  - 5-step pipeline: load cache → check staleness → query graph → impact analysis → decision lookup",
    "- `kuma_context({ action: \"impact\", target: \"symbol\" })` — Analyze change effects",
    "- `kuma_context({ action: \"navigate\", target: \"flow\" })` — Trace code flow",
    "- `kuma_context({ action: \"changes\" })` — View session change log",
    "- `kuma_context({ action: \"health\" })` — Project health score 0-100",
    "",
    "### 📝 kuma_memory — Decision & Knowledge",
    "",
    "- `kuma_memory({ action: \"research_save\", scope: \"...\", ... })` — Save research results",
    "- `kuma_memory({ action: \"decision\", decisionAction: \"record\", ... })` — ADR-style decision",
    "- **`kuma_memory({ action: \"mine\", scope: \"...\" })` — Mine historical decisions from git log & comments**",
    "- `kuma_memory({ action: \"session\" })` — Session summary",
    "- `kuma_memory({ action: \"heal\" })` — Self-heal knowledge graph",
    "- `kuma_memory({ action: \"search\", query: \"...\" })` — Search memories + graph",
    "- `kuma_memory({ action: \"changes\" })` — View change log",
    "",
    "### 🛡️ kuma_safety — Safety & Policy",
    "",
    "- `kuma_safety({ action: \"guard\", guardGoal: \"...\" })` — Anti-pattern, drift, loop detection",
    "- **`kuma_safety({ action: \"verify\", scope: \"...\" })` — Auto-run scoped tests & verify correctness**",
    "- `kuma_safety({ action: \"check\", ... })` — Pre-execution safety check",
    "- `kuma_safety({ action: \"audit\" })` — Query safety audit trail",
    "- `kuma_safety({ action: \"lock\", lockAction: \"acquire\", ... })` — Multi-agent file lock",
    "- `kuma_safety({ action: \"health\" })` — Safety score 0-100",
    "- `kuma_safety({ action: \"override\", ... })` — Logged safety bypass",
    "",
    "## Mandatory Research Pipeline",
    "",
    "**Before editing any unfamiliar code, you MUST call:**",
    "",
    "    kuma_context({ action: \"research\", scope: \"<area>\" })",
    "",
    "This runs: cache load → staleness check → graph query → impact analysis → decision lookup.",
    "Only after reviewing the structured result should you make changes.",
    "",
    "After editing, save what you learned:",
    "",
    "    kuma_memory({ action: \"research_save\", scope: \"<area>\", confidence: 0-1 })",
    "",
    "## General Rules",
    "",
    "- **Call `kuma_context({ action: \"init\" })` at session start** — always",
    "- **Research before edit** — always call `kuma_context({ action: \"research\" })` first",
    "- **Save after research** — use `kuma_memory({ action: \"research_save\" })` to persist",
    "- **Record decisions** — use `kuma_memory({ action: \"decision\" })` for significant changes",
    "- **Verify with guard** — use `kuma_safety({ action: \"guard\" })` after editing",
    "- **Check changes** — use `kuma_context({ action: \"changes\" })` to track what you modified",
    "",
    "## What Kuma Does NOT Do (Use Agent Native Tools)",
    "",
    "- Editing files — use your AI agent's native edit tools",
    "- Searching code — use your agent's native grep/search",
    "- Running commands — use your agent's native terminal",
    "- Creating files — use your agent's native file creation",
    "- Git operations — use your agent's native git tools",
    "- Linting/testing — use your agent's native run commands",
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
  opencode: opencodeTemplate,
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
      "Kuma MCP tools are installed. All behavioral rules are in `.kuma/init.md`.",
      "**Before coding, call `kuma_init()` to load project context and session memory.**",
      "Project knowledge persists in `.kuma/memories/*.md` across sessions.",
      "",
      "MCP server configured in `opencode.json`.",
    ].join("\n");

    if (fs.existsSync(skillPath)) {
      const existing = fs.readFileSync(skillPath, "utf-8");
      if (existing.includes("kuma-mcp")) {
        results.push({ type: "opencode", filePath: ".agents/skills/kuma/SKILL.md", action: "skipped" });
        return;
      }
      results.push({ type: "opencode", filePath: ".agents/skills/kuma/SKILL.md", action: "skipped" });
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
const AGENTS_MD_TYPES: ConfigType[] = ["codex", "qwen", "copilot"];

function getAgentsMdHeader(): string {
  return [
    "# Kuma MCP - Combined Agent Instructions",
    "",
    "This file contains instructions for AI coding agents that read AGENTS.md.",
    "Each section applies to a specific agent. Unused sections can be safely removed.",
    "",
    "---",
    "_Generated by Kuma MCP - https://github.com/plumpslabs/kuma_",
    "",
  ].join("\n");
}

/** Generate combined AGENTS.md content from selected types */
function getCombinedAgentsMd(selectedTypes: Set<ConfigType>): string {
  const sections: string[] = [getAgentsMdHeader()];
  const agentOrder: ConfigType[] = ["codex", "qwen", "copilot"];
  for (const t of agentOrder) {
    if (selectedTypes.has(t)) {
      sections.push(TEMPLATES[t]());
    }
  }
  return sections.join("\n\n---\n\n");
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

/** Generate .kuma/init.md — full behavioral rules, single source of truth */
function handleInitMdGeneration(root: string, results: InitResult[]): void {
  const initMdPath = path.resolve(root, ".kuma/init.md");

  try {
    const kumaDir = path.dirname(initMdPath);
    if (!fs.existsSync(kumaDir)) fs.mkdirSync(kumaDir, { recursive: true });

    if (fs.existsSync(initMdPath)) {
      const existing = fs.readFileSync(initMdPath, "utf-8");
      if (existing.includes("_Generated by Kuma MCP_")) {
        results.push({ type: "claude", filePath: ".kuma/init.md", action: "skipped" });
        return;
      }
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
        } else if (type === "opencode") {
          handleOpencodeSecondary(root, results);
        }
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
