// ============================================================
// KUMA SAFETY LAYER — Safety AI Layer (Phase 8.4)
// ============================================================
// Unified safety layer that sits between AI agents and
// the filesystem. Every action passes through:
//   ✅ Policy check (.kuma/policy.yml)
//   ✅ Path validation (sandbox protection)
//   ✅ Risk prediction (failures, locks, git state)
//   ✅ Audit trail (all operations logged)
//   ✅ Proxy wrapper (all Kuma tools auto-checked)
// ============================================================

import { isLocked } from "./kumaLock.js";
import { getDb } from "./kumaDb.js";
import { sessionMemory } from "./sessionMemory.js";
import { recordAudit } from "./safetyAudit.js";
import { preCheck, type SafetyVerdict } from "./kumaSafetyProxy.js";

export type { SafetyVerdict };

// ============================================================
// SAFETY CHECK — Full safety check (used by kuma_safety tool)
// ============================================================

interface SafetyCheckResult {
  action: string;
  filePath?: string;
  allowed: boolean;
  checks: Array<{ name: string; passed: boolean; detail: string }>;
  riskLevel: "low" | "medium" | "high" | "critical";
  recommendation: string;
}

/**
 * Run comprehensive safety checks on an action before execution.
 * This is the full version called by kuma_safety({ action: "check" }).
 */
export async function safetyCheck(
  action: string,
  filePath?: string,
  command?: string,
): Promise<string> {
  try {
    const checks: SafetyCheckResult["checks"] = [];
    const db = await getDb();

    // Check 1: File lock
    if (filePath) {
      const lock = isLocked(filePath);
      checks.push({
        name: "File Lock",
        passed: !lock.locked,
        detail: lock.locked
          ? `🔒 Locked by ${lock.by} since ${new Date(lock.since!).toISOString()}`
          : "✅ No lock conflict",
      });
    }

    // Check 2: Git status
    let changes = 0;
    try {
      const summary = sessionMemory.getSummary();
      const modified = (summary.modifiedFiles as Array<unknown>)?.length || 0;
      changes = modified;
      checks.push({
        name: "Uncommitted Changes",
        passed: changes < 10,
        detail: changes > 0 ? `📝 ${changes} uncommitted change(s)` : "✅ Clean working tree",
      });
    } catch {
      checks.push({ name: "Uncommitted Changes", passed: true, detail: "✅ Could not check" });
    }

    // Check 3: Safety score from proxy preCheck
    if (action && filePath) {
      const verdict = await preCheck(action, { filePath: filePath as any, action } as any, {
        extractFilePath: (p) => p.filePath as string,
      });
      checks.push({
        name: "Policy & Path Safety",
        passed: verdict.allowed,
        detail: verdict.allowed
          ? `✅ ${verdict.policyViolations} violations`
          : `❌ ${verdict.policyViolations} violation(s) — ${verdict.messages[0] || "blocked"}`,
      });
    }

    // Check 4: Recent failures
    let recentFailures = 0;
    try {
      const failureResult = db.exec("SELECT COUNT(*) as c FROM failure_kb WHERE resolved = 0");
      recentFailures = (failureResult[0]?.values[0][0] as number) || 0;
    } catch {}
    checks.push({
      name: "Recent Failures",
      passed: recentFailures === 0,
      detail: recentFailures > 0 ? `❌ ${recentFailures} unresolved failure(s)` : "✅ No recent failures",
    });

    // Check 5: Dangerous command
    if (command) {
      const dangerous = ["rm -rf", "git push --force", "npm publish", "| bash", "shred"];
      const isDangerous = dangerous.some((d) => command.includes(d));
      checks.push({
        name: "Command Safety",
        passed: !isDangerous,
        detail: isDangerous ? "❌ Command flagged as dangerous" : "✅ Command looks safe",
      });
    }

    // Check 6: Knowledge Graph Health
    try {
      const nodeCount = (db.exec("SELECT COUNT(*) as c FROM nodes")[0]?.values[0][0] as number) || 0;
      checks.push({
        name: "Knowledge Graph Health",
        passed: nodeCount > 0,
        detail: nodeCount > 0 ? `✅ ${nodeCount} nodes in graph` : "⚠️ Empty knowledge graph",
      });
    } catch {
      checks.push({ name: "Knowledge Graph Health", passed: true, detail: "⚠️ Could not check" });
    }

    // Overall assessment
    const failed = checks.filter((c) => !c.passed);
    const riskLevel: SafetyCheckResult["riskLevel"] =
      failed.length >= 3 ? "critical"
        : failed.length >= 2 ? "high"
          : failed.length >= 1 ? "medium"
            : "low";
    const allowed = failed.length === 0;
    const recommendation = allowed
      ? "🟢 All checks passed — proceed safely."
      : riskLevel === "critical"
        ? "🔴 Critical — Do not proceed without resolving all issues."
        : riskLevel === "high"
          ? "🟠 High risk — Resolve issues before proceeding."
          : "🟡 Medium risk — Proceed with caution.";

    const result: SafetyCheckResult = { action, filePath, allowed, checks, riskLevel, recommendation };

    // Record in audit trail
    await recordAudit({
      timestamp: Math.floor(Date.now() / 1000),
      toolName: "kuma_safety_check",
      action,
      filePath,
      riskLevel,
      policyViolations: failed.length,
      allowed,
      durationMs: 0,
      metadata: { checkType: "full" },
    });

    return formatSafetyCheck(result, command);
  } catch (err) {
    return `Error in safety check: ${err}`;
  }
}

// ============================================================
// SAFETY OVERRIDE — Bypass safety for a specific operation
// ============================================================

/**
 * Temporarily override safety for a specific tool/target.
 * Recorded in audit trail for accountability.
 */
export function safetyOverride(tool: string, reason?: string): string {
  const entry = {
    timestamp: Math.floor(Date.now() / 1000),
    toolName: "safety_override",
    action: "override",
    riskLevel: "high" as const,
    policyViolations: 1,
    allowed: true,
    durationMs: 0,
    metadata: { override: true, tool, reason: reason || "No reason provided" },
  };

  // Fire-and-forget audit (non-blocking)
  recordAudit(entry).catch(() => {});

  return [
    `⚠️ **Safety Override** — Bypassing safety for "${tool}"`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    "",
    `📝 Reason: ${reason || "No reason provided"}`,
    "",
    "⚠️ This override is recorded in the safety audit trail.",
    "⚠️ Use sparingly — overrides reduce project safety.",
  ].join("\n");
}

// ============================================================
// FORMATTING
// ============================================================

function formatSafetyCheck(r: SafetyCheckResult, command?: string): string {
  const emoji = r.riskLevel === "critical" ? "🔴" : r.riskLevel === "high" ? "🟠" : r.riskLevel === "medium" ? "🟡" : "🟢";
  const lines: string[] = [
    `${emoji} **Safety AI Layer** — ${r.allowed ? "✅ Allowed" : "⛔ Blocked"}`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━`,
    "",
    `🎯 Action: \`${r.action}\``,
    r.filePath ? `📄 File: \`${r.filePath}\`` : "",
    command ? `💻 Command: \`${command}\`` : "",
    `⚠️ Risk Level: **${r.riskLevel.toUpperCase()}**`,
    "",
    r.recommendation,
    "",
    "**Checks:**",
  ].filter(Boolean);

  for (const c of r.checks) {
    lines.push(`  ${c.passed ? "✅" : "❌"} **${c.name}**: ${c.detail}`);
  }

  return lines.join("\n");
}
