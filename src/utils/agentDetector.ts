// ============================================================
// AGENT DETECTOR — Detect active AI agent from config files
// ============================================================
// Scans the project root for agent-specific configuration files
// to determine which AI coding agent is being used.
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "./pathValidator.js";

export type AgentType =
  | "claude"
  | "cursor"
  | "cline"
  | "antigravity"
  | "codex"
  | "opencode"
  | "aider"
  | "windsurf"
  | "copilot"
  | "qwen"
  | "kiro"
  | "openclaw"
  | "codewhale";

export interface AgentDetection {
  detected: AgentType[];
  primary: AgentType | null;
  confidence: "high" | "medium" | "low";
}

interface AgentDetector {
  type: AgentType;
  checkFiles: string[];
  checkDirs: string[];
  priority: number; // higher = more specific / higher confidence
  label: string;
}

// Ordered by specificity (more specific checks first)
const AGENT_DETECTORS: AgentDetector[] = [
  {
    type: "cursor",
    checkFiles: [],
    checkDirs: [".cursor"],
    priority: 90,
    label: "Cursor (.cursor/)",
  },
  {
    type: "claude",
    checkFiles: ["CLAUDE.md"],
    checkDirs: [".claude"],
    priority: 85,
    label: "Claude Code (CLAUDE.md / .claude/)",
  },
  {
    type: "cline",
    checkFiles: [],
    checkDirs: [".clinerules"],
    priority: 80,
    label: "Cline (.clinerules/)",
  },
  {
    type: "antigravity",
    checkFiles: [],
    checkDirs: [".agents"],
    priority: 75,
    label: "Antigravity CLI (.agents/)",
  },
  {
    type: "windsurf",
    checkFiles: [".windsurfrules"],
    checkDirs: [],
    priority: 70,
    label: "Windsurf (.windsurfrules)",
  },
  {
    type: "opencode",
    checkFiles: ["opencode.json"],
    checkDirs: [],
    priority: 65,
    label: "OpenCode (opencode.json)",
  },
  {
    type: "kiro",
    checkFiles: [],
    checkDirs: [".kiro"],
    priority: 60,
    label: "Kiro (.kiro/)",
  },
  {
    type: "aider",
    checkFiles: [".aider.conf.yml", ".aider.conf.yaml"],
    checkDirs: [],
    priority: 55,
    label: "Aider (.aider.conf.yml)",
  },
  {
    type: "copilot",
    checkFiles: [],
    checkDirs: [".github/skills"],
    priority: 50,
    label: "GitHub Copilot Editor (.github/skills/)",
  },
  {
    type: "codex",
    checkFiles: [".codex/config.toml"],
    checkDirs: [".codex"],
    priority: 45,
    label: "Codex CLI (.codex/)",
  },
  {
    type: "qwen",
    checkFiles: ["settings.json"],
    checkDirs: [],
    priority: 40,
    label: "Qwen Code (settings.json)",
  },
  {
    type: "openclaw",
    checkFiles: ["skills/kuma/SKILL.md"],
    checkDirs: ["skills"],
    priority: 35,
    label: "OpenClaw (skills/kuma/SKILL.md)",
  },
  {
    type: "codewhale",
    checkFiles: [],
    checkDirs: [".codewhale"],
    priority: 30,
    label: "CodeWhale (.codewhale/)",
  },
];

/**
 * Check if a specific config file exists in the project root.
 */
function checkFile(root: string, filePath: string): boolean {
  try {
    return fs.existsSync(path.join(root, filePath));
  } catch {
    return false;
  }
}

/**
 * Check if a specific directory exists in the project root.
 */
function checkDir(root: string, dirPath: string): boolean {
  try {
    const fullPath = path.join(root, dirPath);
    return fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Detect AI agents from project config files.
 * Returns detected agents sorted by confidence.
 */
export function detectAgent(projectRoot?: string): AgentDetection {
  const root = projectRoot ?? getProjectRoot();
  const detected: AgentType[] = [];

  for (const detector of AGENT_DETECTORS) {
    // Check files
    const hasFile = detector.checkFiles.some((f) => checkFile(root, f));
    // Check directories
    const hasDir = detector.checkDirs.some((d) => checkDir(root, d));

    if (hasFile || hasDir) {
      detected.push(detector.type);
    }
  }

  // Sort by priority (highest first)
  const sorted = detected
    .map((t) => ({ type: t, priority: AGENT_DETECTORS.find((d) => d.type === t)?.priority ?? 0 }))
    .sort((a, b) => b.priority - a.priority);

  const primary = sorted.length > 0 ? sorted[0].type : null;

  // Determine confidence
  let confidence: "high" | "medium" | "low" = "low";
  if (sorted.length > 0) {
    const topPriority = sorted[0].priority;
    if (topPriority >= 70) confidence = "high";
    else if (topPriority >= 50) confidence = "medium";
    else confidence = "low";
  }

  return {
    detected: sorted.map((s) => s.type),
    primary,
    confidence,
  };
}

/**
 * Get the skill path for a specific agent type.
 */
export function getSkillPath(type: AgentType): string {
  switch (type) {
    case "claude":
      return ".claude/skills/kuma/SKILL.md";
    case "cursor":
      return ".cursor/rules/kuma.mdc";
    case "cline":
      return ".clinerules/kuma.md";
    case "antigravity":
      return ".agents/skills/kuma/SKILL.md";
    case "codex":
      return ".agents/skills/kuma/SKILL.md"; // Same path as Antigravity
    case "opencode":
      return "opencode.json";
    case "aider":
      return "CONVENTIONS.md";
    case "windsurf":
      return ".windsurfrules";
    case "copilot":
      return ".github/skills/kuma/SKILL.md";
    case "qwen":
      return "AGENTS.md";
    case "kiro":
      return ".kiro/steering/kuma.md";
    case "openclaw":
      return "skills/kuma/SKILL.md";
    case "codewhale":
      return "skills/kuma/SKILL.md";
  }
}

/**
 * Get human-readable agent label.
 */
export function getAgentLabel(type: AgentType): string {
  const detector = AGENT_DETECTORS.find((d) => d.type === type);
  return detector?.label ?? type;
}

/**
 * Check if a skill file already exists for an agent type.
 */
export function skillExists(type: AgentType, projectRoot?: string): boolean {
  const root = projectRoot ?? getProjectRoot();
  const skillPath = getSkillPath(type);
  return fs.existsSync(path.join(root, skillPath));
}
