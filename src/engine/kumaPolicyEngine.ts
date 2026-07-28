// ============================================================
// KUMA POLICY ENGINE — Policy-as-Code Engine (Issue #24)
// ============================================================
// Full policy engine for side-effect runtime interception.
// Builds on top of the basic kumaPolicy.ts with:
//   1. Runtime interception of side-effects (DB migrations, file ops)
//   2. `.kuma/POLICY.json` ingestion
//   3. Blocking unapproved package downloads or production DB drops
//   4. Require override tokens for high-risk operations
//   5. Command pattern matching against policy rules
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "../utils/pathValidator.js";
import { sessionMemory } from "./sessionMemory.js";

// ============================================================
// POLICY JSON SCHEMA (enhanced)
// ============================================================

export interface PolicyRule {
  id: string;
  description: string;
  severity: "error" | "warning";
  patterns: string[];
  action: "block" | "warn" | "log";
  requireOverride?: boolean;
}

export interface PolicyConfig {
  version: number;
  name: string;
  description?: string;
  rules: PolicyRule[];
  block_commands?: string[];
  never_touch?: string[];
  require_review?: string[];
}

// ============================================================
// DEFAULT POLICY
// ============================================================

const DEFAULT_POLICY_CONFIG: PolicyConfig = {
  version: 1,
  name: "Kuma Default Security Policy",
  description: "Default safety policy for AI coding agents",
  rules: [
    {
      id: "block-rm-rf",
      description: "Block recursive force deletion",
      severity: "error",
      patterns: ["rm -rf", "rm -fr", "rm --recursive --force"],
      action: "block",
      requireOverride: true,
    },
    {
      id: "block-git-force-push",
      description: "Block force push to git",
      severity: "error",
      patterns: ["git push --force", "git push -f"],
      action: "block",
      requireOverride: true,
    },
    {
      id: "block-npm-publish",
      description: "Block package publishing",
      severity: "error",
      patterns: ["npm publish", "yarn publish", "pnpm publish"],
      action: "block",
      requireOverride: true,
    },
    {
      id: "block-pipe-to-shell",
      description: "Block curl/wget pipe to shell",
      severity: "error",
      patterns: ["curl | bash", "curl | sh", "wget -O - | bash", "curl | sudo"],
      action: "block",
      requireOverride: true,
    },
    {
      id: "warn-destructive-db",
      description: "Warn about destructive database operations",
      severity: "warning",
      patterns: ["DROP DATABASE", "DROP TABLE", "TRUNCATE", "DELETE FROM"],
      action: "warn",
    },
    {
      id: "block-prod-deploy",
      description: "Block production deployments without override",
      severity: "error",
      patterns: ["deploy --production", "deploy --prod", "deploy:production"],
      action: "block",
      requireOverride: true,
    },
  ],
  block_commands: [
    "rm -rf",
    "rm -fr",
    "git push --force",
    "git push -f",
    "npm publish",
    "yarn publish",
    "pnpm publish",
    "curl | bash",
    "curl | sh",
  ],
  never_touch: [
    ".env",
    ".env.local",
    ".env.production",
    ".env.development",
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "node_modules/**",
  ],
};

// ============================================================
// LOAD POLICY CONFIG
// ============================================================

/**
 * Load the policy configuration from .kuma/POLICY.json.
 * Falls back to DEFAULT_POLICY_CONFIG if no file exists.
 */
export function loadPolicyConfig(): PolicyConfig {
  try {
    const root = getProjectRoot();
    const policyPath = path.join(root, ".kuma", "POLICY.json");
    if (fs.existsSync(policyPath)) {
      const content = fs.readFileSync(policyPath, "utf-8");
      const config = JSON.parse(content) as PolicyConfig;
      return { ...DEFAULT_POLICY_CONFIG, ...config };
    }

    // Also check for .kuma/policy.yml (legacy)
    const ymlPath = path.join(root, ".kuma", "policy.yml");
    if (fs.existsSync(ymlPath)) {
      console.error("[PolicyEngine] Found legacy policy.yml — consider migrating to POLICY.json");
    }
  } catch (err) {
    console.error(`[PolicyEngine] Failed to load policy config: ${err}`);
  }

  return DEFAULT_POLICY_CONFIG;
}

/**
 * Save a policy configuration to .kuma/POLICY.json.
 */
export function savePolicyConfig(config: PolicyConfig): string {
  try {
    const root = getProjectRoot();
    const policyPath = path.join(root, ".kuma", "POLICY.json");
    const dir = path.dirname(policyPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(policyPath, JSON.stringify(config, null, 2), "utf-8");
    return `✅ Policy config saved to .kuma/POLICY.json (${config.rules.length} rules)`;
  } catch (err) {
    return `❌ Failed to save policy: ${err}`;
  }
}

// ============================================================
// RULE EVALUATION
// ============================================================

export interface SideEffectVerdict {
  allowed: boolean;
  blockedBy: PolicyRule | null;
  warnings: PolicyRule[];
  requiresOverride: boolean;
  message: string;
}

/**
 * Evaluate a command against all policy rules.
 */
export function evaluateCommand(command: string): SideEffectVerdict {
  const config = loadPolicyConfig();
  const warnings: PolicyRule[] = [];
  const cmdLower = command.toLowerCase();

  for (const rule of config.rules) {
    const matches = rule.patterns.some(p => cmdLower.includes(p.toLowerCase()));
    if (!matches) continue;

    if (rule.action === "block" || rule.severity === "error") {
      return {
        allowed: false,
        blockedBy: rule,
        warnings,
        requiresOverride: rule.requireOverride ?? false,
        message: `⛔ Policy violation: "${rule.description}" (rule: ${rule.id})`,
      };
    }

    if (rule.action === "warn") {
      warnings.push(rule);
    }
  }

  // Also check block_commands
  for (const cmd of (config.block_commands || [])) {
    if (cmdLower.includes(cmd.toLowerCase())) {
      return {
        allowed: false,
        blockedBy: {
          id: "block-command",
          description: `Blocked command: ${cmd}`,
          severity: "error",
          patterns: [cmd],
          action: "block",
          requireOverride: true,
        },
        warnings,
        requiresOverride: true,
        message: `⛔ Command matches blocked pattern: "${cmd}"`,
      };
    }
  }

  return {
    allowed: true,
    blockedBy: null,
    warnings,
    requiresOverride: false,
    message: warnings.length > 0
      ? `⚠️ Command allowed with ${warnings.length} warning(s)`
      : "✅ Command allowed by policy",
  };
}

/**
 * Evaluate a file path against never_touch rules.
 */
export function evaluateFilePath(filePath: string): SideEffectVerdict {
  const config = loadPolicyConfig();
  const filesToCheck: string[] = config.never_touch || DEFAULT_POLICY_CONFIG.never_touch || [];

  for (const pattern of filesToCheck) {
    if (matchesGlob(pattern, filePath)) {
      return {
        allowed: false,
        blockedBy: {
          id: "never-touch",
          description: `File matches never_touch pattern: ${pattern}`,
          severity: "error",
          patterns: [pattern],
          action: "block",
          requireOverride: true,
        },
        warnings: [],
        requiresOverride: true,
        message: `⛔ File "${filePath}" is protected by never_touch policy (pattern: ${pattern}). Use kuma_safety({ action: 'override' }) to bypass.`,
      };
    }
  }

  return {
    allowed: true,
    blockedBy: null,
    warnings: [],
    requiresOverride: false,
    message: "✅ File allowed by policy",
  };
}

/**
 * Evaluate a database migration command.
 */
export function evaluateDatabaseAction(action: string): SideEffectVerdict {
  const cmdLower = action.toLowerCase();

  // Block production database drops
  if (
    (cmdLower.includes("drop") || cmdLower.includes("truncate")) &&
    (cmdLower.includes("database") || cmdLower.includes("table") || cmdLower.includes("schema"))
  ) {
    return {
      allowed: false,
      blockedBy: {
        id: "block-destructive-db",
        description: "Destructive database operation blocked",
        severity: "error",
        patterns: ["DROP DATABASE", "DROP TABLE", "TRUNCATE", "DELETE FROM"],
        action: "block",
        requireOverride: true,
      },
      warnings: [],
      requiresOverride: true,
      message: `⛔ Destructive database action blocked: "${action}". Use kuma_safety({ action: 'override' }) with a clear reason.`,
    };
  }

  return {
    allowed: true,
    blockedBy: null,
    warnings: [],
    requiresOverride: false,
    message: "✅ Database action allowed by policy",
  };
}

// ============================================================
// OVERRIDE CHECK
// ============================================================

export interface OverrideRequest {
  toolName: string;
  filePath?: string;
  command?: string;
  reason: string;
}

/**
 * Process an override request. Logs to audit trail.
 */
export async function processOverride(request: OverrideRequest): Promise<string> {
  const { recordAudit } = await import("./safetyAudit.js");

  await recordAudit({
    timestamp: Math.floor(Date.now() / 1000),
    toolName: request.toolName,
    action: "policy_override",
    filePath: request.filePath,
    riskLevel: "high",
    policyViolations: 1,
    allowed: true,
    durationMs: 0,
    metadata: {
      override: true,
      reason: request.reason,
      command: request.command,
    },
  });

  // Log to session
  sessionMemory.recordToolCall("kuma_policy_override", {
    toolName: request.toolName,
    reason: request.reason,
    filePath: request.filePath,
    command: request.command,
  });

  return [
    `⚠️ **Policy Override** — ${request.toolName}`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    "",
    `📝 Reason: ${request.reason}`,
    request.filePath ? `📄 File: ${request.filePath}` : "",
    request.command ? `💻 Command: ${request.command}` : "",
    "",
    "🔴 This override is recorded in the safety audit trail.",
    "🔴 Overrides reduce project safety — use sparingly.",
  ].filter(Boolean).join("\n");
}

// ============================================================
// FORMATTING
// ============================================================

/**
 * Format the current policy configuration for display.
 */
export function formatPolicyStatus(): string {
  const config = loadPolicyConfig();

  const lines: string[] = [
    "📜 **Policy-as-Code Engine**",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
    `📋 Policy: ${config.name}`,
    `🔢 Version: ${config.version}`,
    `📝 Rules: ${config.rules.length}`,
    "",
    "**Rules:**",
  ];

  for (const rule of config.rules) {
    const icon = rule.action === "block" ? "🔴" : rule.action === "warn" ? "🟡" : "🟢";
    const override = rule.requireOverride ? " 🔑 override" : "";
    lines.push(`  ${icon} [${rule.action}] ${rule.description}${override}`);
    lines.push(`     Patterns: ${rule.patterns.slice(0, 3).join(", ")}`);
  }

  const neverTouch = config.never_touch || [];
  if (neverTouch.length > 0) {
    lines.push("", "**Protected Files (never_touch):**");
    for (const p of neverTouch) {
      lines.push(`  🛡️ ${p}`);
    }
  }

  return lines.join("\n");
}

// ============================================================
// GLOB MATCHING
// ============================================================

function matchesGlob(pattern: string, filePath: string): boolean {
  const normalizedPattern = pattern.replace(/\\/g, "/");
  const normalizedPath = filePath.replace(/\\/g, "/");

  let regexStr = "^";
  for (let i = 0; i < normalizedPattern.length; i++) {
    const ch = normalizedPattern[i];
    if (ch === "*" && normalizedPattern[i + 1] === "*" && normalizedPattern[i + 2] === "/") {
      regexStr += "(.+/)?";
      i += 2;
    } else if (ch === "*") {
      regexStr += "[^/]*";
    } else if (ch === "?") {
      regexStr += "[^/]";
    } else {
      regexStr += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  regexStr += "$";

  try {
    return new RegExp(regexStr).test(normalizedPath);
  } catch {
    return false;
  }
}
