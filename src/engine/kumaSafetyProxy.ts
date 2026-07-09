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
import { recordAudit } from "./safetyAudit.js";
import { sessionMemory } from "./sessionMemory.js";
import { getDb } from "./kumaDb.js";

export interface SafetyOptions {
  /** Extract a file path from the params for path-based checks */
  extractFilePath?: (params: Record<string, unknown>) => string | undefined;

  /** Extract a command string from the params for command-based checks */
  extractCommand?: (params: Record<string, unknown>) => string | undefined;

  /** Block execution entirely if policy violations exist (default: true) */
  blockOnViolation?: boolean;

  /** Risk threshold to block: 'high' blocks high+critical, 'critical' blocks only critical */
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
  toolName: string,
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

  // 4. Check for recent failures (risk assessment)
  try {
    const db = await getDb();
    const recentFailures = (db.exec("SELECT COUNT(*) as c FROM failure_kb WHERE resolved = 0")[0]?.values[0][0] as number) ?? 0;
    if (recentFailures > 3 && (toolName.includes("edit") || toolName === "precise_diff_editor")) {
      messages.push(`⚠️ ${recentFailures} unresolved failures — consider fixing them before editing`);
      if (highestRisk === "low") highestRisk = "medium";
    }
  } catch {}

  // 5. Goal drift check
  try {
    const summary = sessionMemory.getSummary();
    const goal = summary.currentGoal as string;
    if (!goal && (toolName === "precise_diff_editor" || toolName === "batch_file_writer")) {
      messages.push("💡 No goal set — consider setting a goal with setGoal() to track intent");
    }
  } catch {
    // sessionMemory might not be available — skip goal check
  }

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

// ============================================================
// WRAPPER
// ============================================================

/**
 * Wrap a tool handler with safety middleware.
 * Automatically runs pre-checks, records audit, and blocks if needed.
 *
 * @param toolName - Name of the tool (for audit logging)
 * @param handler - The original tool handler function
 * @param opts - Safety options (path/command extraction, thresholds)
 * @returns A wrapped handler that applies safety checks before execution
 */
export function wrapWithSafety<T = Record<string, unknown>>(
  toolName: string,
  handler: (params: T) => Promise<string>,
  opts: SafetyOptions = {}
): (params: T) => Promise<string> {
  return async (params: T): Promise<string> => {
    const startTime = Date.now();
    const p = params as unknown as Record<string, unknown>;
    const action = (p.action as string) || "execute";

    try {
      // 1. Pre-execution safety check
      const verdict = await preCheck(toolName, p, opts);

      // 2. Record pre-execution audit
      const filePath = opts.extractFilePath?.(p);

      // 3. Block if not allowed
      if (!verdict.allowed) {
        await recordAudit({
          timestamp: Math.floor(startTime / 1000),
          toolName,
          action,
          filePath,
          riskLevel: verdict.riskLevel,
          policyViolations: verdict.policyViolations,
          allowed: false,
          durationMs: Date.now() - startTime,
          metadata: { blocked: true, messages: verdict.messages },
        });

        return formatBlocked(verdict, toolName);
      }

      // 4. Execute the original handler
      const result = await handler(params);
      const durationMs = Date.now() - startTime;

      // 5. Record post-execution audit
      await recordAudit({
        timestamp: Math.floor(startTime / 1000),
        toolName,
        action,
        filePath,
        riskLevel: verdict.riskLevel,
        policyViolations: verdict.policyViolations,
        allowed: true,
        durationMs,
        metadata: { success: true },
      });

      // 6. Append safety context if there were warnings
      if (verdict.messages.length > 0) {
        const warnings = verdict.messages
          .filter((m) => m.startsWith("⚠️") || m.startsWith("💡"))
          .join("\n");
        if (warnings) {
          return `${result}\n\n🛡️ **Safety Context:**\n${warnings}`;
        }
      }

      return result;
    } catch (err) {
      const durationMs = Date.now() - startTime;
      await recordAudit({
        timestamp: Math.floor(startTime / 1000),
        toolName,
        action,
        riskLevel: "critical",
        policyViolations: 0,
        allowed: false,
        durationMs,
        metadata: { error: String(err) },
      });
      return `⚠️ **Safety Proxy Error** — ${toolName} failed safety check:\n${err}`;
    }
  };
}

// ============================================================
// FORMATTING
// ============================================================

function formatBlocked(verdict: SafetyVerdict, toolName: string): string {
  const icon = verdict.riskLevel === "critical" ? "🔴" : verdict.riskLevel === "high" ? "🟠" : "🟡";
  const lines: string[] = [
    `${icon} **Safety AI Layer — ⛔ Blocked**`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    "",
    `🎯 Tool: **${toolName}**`,
    `⚠️ Risk Level: **${verdict.riskLevel.toUpperCase()}**`,
    `📜 Policy Violations: ${verdict.policyViolations}`,
    "",
    ...verdict.messages,
    "",
    "💡 **Resolution steps:**",
    "  1. Review the policy violations above",
    "  2. If editing: use precise_diff_editor with proper params",
    "  3. If command: avoid dangerous patterns",
    "  4. To bypass: kuma_safety({ action: 'override', tool: '...' })",
  ];
  return lines.join("\n");
}

/**
 * Generate safety context summary (appended to successful operations).
 */
export function formatSafetyAdvisory(verdict: SafetyVerdict): string {
  if (verdict.messages.length === 0) return "";
  const warnings = verdict.messages.filter((m) => !m.startsWith("🚫"));
  if (warnings.length === 0) return "";
  return `🛡️ **Safety Advisory:**\n${warnings.join("\n")}`;
}
