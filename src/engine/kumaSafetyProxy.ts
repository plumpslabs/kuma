// ============================================================
// KUMA SAFETY PROXY — Safety middleware for all Kuma tools
// ============================================================
// Wraps any tool handler with:
//   1. Pre-execution: policy check, path validation, risk assessment
//   2. Audit logging: every call recorded in safety_audit table
//   3. Post-execution: verification suggestions
//
// Usage:
//   const safeHandler = wrapWithSafety("tool_name", originalHandler, options);
//
// This is the core of Safety AI Layer (Phase 8.4) — every tool
// automatically passes through the safety layer without opt-in.
// ============================================================

import { loadPolicy, checkFilePathPolicy } from "../tools/kumaPolicy.js";
import { validateFilePath } from "../utils/pathValidator.js";
import { sessionMemory } from "./sessionMemory.js";
import { getDb } from "./kumaDb.js";

interface SafetyOptions {
  extractFilePath?: (params: Record<string, unknown>) => string | undefined;
  extractCommand?: (params: Record<string, unknown>) => string | undefined;
  blockOnViolation?: boolean;
  blockRiskThreshold?: "medium" | "high" | "critical";
}

export interface SafetyVerdict {
  allowed: boolean;
  riskLevel: "low" | "medium" | "high" | "critical";
  policyViolations: number;
  messages: string[];
}

// ============================================================
// PRE-CHECK
// ============================================================

/**
 * Run pre-execution safety checks on a tool call.
 * Returns a verdict: allowed + risk level + policy violations.
 */
export async function preCheck(
  _toolName: string,
  params: Record<string, unknown>,
  opts: SafetyOptions = {}
): Promise<SafetyVerdict> {
  const messages: string[] = [];
  let policyViolations = 0;
  let highestRisk: "low" | "medium" | "high" | "critical" = "low";
  const blockThreshold = opts.blockRiskThreshold || "high";

  // 1. Path validation
  const filePath = opts.extractFilePath?.(params);
  if (filePath) {
    const validation = validateFilePath(filePath);
    if (!validation.valid) {
      messages.push(`🚫 Path blocked: ${validation.error.message}`);
      policyViolations++;
      highestRisk = "critical";
    }
  }

  // 2. Policy check
  const policy = loadPolicy();
  if (filePath) {
    const { violations, warnings } = checkFilePathPolicy(filePath, policy);
    policyViolations += violations.length;

    for (const v of violations) {
      messages.push(`📜 Policy violation (${v.rule}): ${v.message}`);
      highestRisk = "critical";
    }
    for (const w of warnings) {
      messages.push(`⚠️ Policy warning (${w.rule}): ${w.message}`);
      if (highestRisk === "low") highestRisk = "medium";
    }
  }

  // 3. Command safety check
  const command = opts.extractCommand?.(params);
  if (command) {
    const dangerousPatterns = [
      "rm -rf", "rm -fr", "git push", "git commit",
      "npm publish", "yarn publish", "pnpm publish",
      "| bash", "| sh", "eval ", "exec ",
      "mkfs", "dd if=", "shred",
    ];
    const matched = dangerousPatterns.find((p) => command.toLowerCase().includes(p));
    if (matched) {
      messages.push(`🚫 Command blocked: contains dangerous pattern "${matched}"`);
      policyViolations++;
      highestRisk = "critical";
    }
  }

  // 4. Check for research done (V3: research should precede changes)
  try {
    const db = await getDb();
    const researchCount = (db.exec("SELECT COUNT(*) as c FROM research_cache")[0]?.values[0][0] as number) ?? 0;
    const action = (params.action as string) || "";
    if (researchCount === 0 && (action === "edit" || action === "impact" || action === "navigate")) {
      messages.push("💡 No research cached — run kuma_context({ action: 'research', scope: '...' }) first");
      if (highestRisk === "low") highestRisk = "medium";
    }
  } catch {}

  // 5. Goal drift check
  try {
    const summary = sessionMemory.getSummary();
    const goal = summary.currentGoal as string;
    if (!goal) {
      messages.push("💡 No goal set — kuma_context({ action: 'init' }) sets one automatically");
    }
  } catch {} 

  // Determine verdict
  const riskLevel = highestRisk;
  const thresholdLevels = ["low", "medium", "high", "critical"];
  const thresholdIndex = thresholdLevels.indexOf(blockThreshold);
  const riskIndex = thresholdLevels.indexOf(riskLevel);
  const allowed = opts.blockOnViolation !== false
    ? riskIndex < thresholdIndex
    : policyViolations === 0;

  return { allowed, riskLevel, policyViolations, messages };
}


