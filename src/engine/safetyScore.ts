import fs from "node:fs";
import path from "node:path";
import { sessionMemory } from "./sessionMemory.js";
import {
  getSessionStats,
  getGitDiffStat,
  getUnresolvedCount,
} from "../utils/kumaShared.js";
import { getProjectRoot, getKumaBackupsDir } from "../utils/pathValidator.js";

// ============================================================
// SAFETY SCORE — Aggregate project health into 0-100 score
// ============================================================

export interface SafetyCheck {
  label: string;
  status: "pass" | "warn" | "fail";
  message: string;
  weight: number; // contribution to total score
}

export interface SafetyScoreReport {
  score: number;
  maxScore: number;
  risk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  checks: SafetyCheck[];
  summary: string;
  timestamp: string;
}

/**
 * Compute a safety score by aggregating all available signals.
 * Returns a structured report with individual check results.
 */
export function computeSafetyScore(inputGoal?: string): SafetyScoreReport {
  const stats = getSessionStats(inputGoal);
  const checks: SafetyCheck[] = [];
  let totalScore = 0;
  const maxScore = 100;

  // 1. Git status (weight: 20)
  const gitStat = getGitDiffStat();
  if (gitStat) {
    const lines = gitStat.split("\n").filter(Boolean).length;
    if (lines === 0) {
      checks.push({
        label: "Git Clean",
        status: "pass",
        message: "Working tree is clean",
        weight: 20,
      });
      totalScore += 20;
    } else if (lines <= 3) {
      checks.push({
        label: "Git Clean",
        status: "warn",
        message: `${lines} file(s) modified`,
        weight: 15,
      });
      totalScore += 15;
    } else {
      checks.push({
        label: "Git Clean",
        status: "warn",
        message: `${lines} file(s) modified — consider committing or stashing`,
        weight: 10,
      });
      totalScore += 10;
    }
  } else {
    checks.push({
      label: "Git Status",
      status: "pass",
      message: "Not a git repository or git unavailable",
      weight: 20,
    });
    totalScore += 20;
  }

  // 2. Backup availability (weight: 10)
  const backupDir = getKumaBackupsDir();
  if (fs.existsSync(backupDir)) {
    const backupCount = fs.readdirSync(backupDir).filter((d) => /^\d+$/.test(d)).length;
    checks.push({
      label: "Backup Available",
      status: "pass",
      message: `${backupCount} backup snapshot(s) available`,
      weight: 10,
    });
    totalScore += 10;
  } else {
    checks.push({
      label: "Backup Available",
      status: "warn",
      message: "No backups found — first edit will create one",
      weight: 5,
    });
    totalScore += 5;
  }

  // 3. LSP availability (weight: 10) — check via optionalDependencies, not npx
  try {
    const lspPath = path.join(getProjectRoot(), "node_modules", ".bin", "typescript-language-server");
    if (fs.existsSync(lspPath)) {
      checks.push({
        label: "LSP Available",
        status: "pass",
        message: "TypeScript language server installed",
        weight: 10,
      });
      totalScore += 10;
    } else {
      checks.push({
        label: "LSP Available",
        status: "warn",
        message: "LSP not installed — lsp_query will use regex fallback",
        weight: 5,
      });
      totalScore += 5;
    }
  } catch {
    checks.push({
      label: "LSP Available",
      status: "warn",
      message: "LSP not installed — lsp_query will use regex fallback",
      weight: 5,
    });
    totalScore += 5;
  }

  // 4. Tests status (weight: 15)
  const unresolvedCount = getUnresolvedCount(stats.failedFiles);
  const allFailures = stats.failedFiles.flatMap((f) => f.failures);
  const testFailures = allFailures.filter((f) => f.error.toLowerCase().includes("test") || f.error.toLowerCase().includes("fail"));
  const hasRunTests = stats.hasRunTests;

  if (!hasRunTests) {
    checks.push({
      label: "Tests Status",
      status: "warn",
      message: "No tests run yet this session",
      weight: 10,
    });
    totalScore += 10;
  } else if (testFailures.length === 0 && unresolvedCount === 0) {
    checks.push({
      label: "Tests Status",
      status: "pass",
      message: "All tests passing",
      weight: 15,
    });
    totalScore += 15;
  } else if (testFailures.length <= 2) {
    checks.push({
      label: "Tests Status",
      status: "warn",
      message: `${testFailures.length} test failure(s) — needs attention`,
      weight: 8,
    });
    totalScore += 8;
  } else {
    checks.push({
      label: "Tests Status",
      status: "fail",
      message: `${testFailures.length} test failure(s) — fix before proceeding`,
      weight: 3,
    });
    totalScore += 3;
  }

  // 5. Modified files count (weight: 15)
  const modifiedCount = stats.modifiedFiles.length;
  if (modifiedCount === 0) {
    checks.push({
      label: "Modified Files",
      status: "pass",
      message: "No files modified yet",
      weight: 15,
    });
    totalScore += 15;
  } else if (modifiedCount <= 3) {
    checks.push({
      label: "Modified Files",
      status: "warn",
      message: `${modifiedCount} file(s) modified`,
      weight: 12,
    });
    totalScore += 12;
  } else if (modifiedCount <= 8) {
    checks.push({
      label: "Modified Files",
      status: "warn",
      message: `${modifiedCount} file(s) modified — consider a checkpoint`,
      weight: 8,
    });
    totalScore += 8;
  } else {
    checks.push({
      label: "Modified Files",
      status: "fail",
      message: `${modifiedCount} file(s) modified — create a snapshot with kuma_context`,
      weight: 4,
    });
    totalScore += 4;
  }

  // 6. Loop detection (weight: 10)
  const loop = sessionMemory.detectLoop();
  if (loop.isLooping) {
    checks.push({
      label: "Loop Detection",
      status: "fail",
      message: loop.message || "Potential tool call loop detected",
      weight: 0,
    });
  } else {
    checks.push({
      label: "Loop Detection",
      status: "pass",
      message: "No loops detected",
      weight: 10,
    });
    totalScore += 10;
  }

  // 7. Unresolved failures (weight: 10)
  if (unresolvedCount === 0) {
    checks.push({
      label: "Unresolved Failures",
      status: "pass",
      message: "No unresolved failures",
      weight: 10,
    });
    totalScore += 10;
  } else if (unresolvedCount <= 2) {
    checks.push({
      label: "Unresolved Failures",
      status: "warn",
      message: `${unresolvedCount} unresolved failure(s)`,
      weight: 6,
    });
    totalScore += 6;
  } else {
    checks.push({
      label: "Unresolved Failures",
      status: "fail",
      message: `${unresolvedCount} unresolved failure(s) — fix before continuing`,
      weight: 2,
    });
    totalScore += 2;
  }

  // 8. Project conventions detected (weight: 5)
  const hasConventions = !!sessionMemory.getConventions();
  if (hasConventions) {
    checks.push({
      label: "Project Detected",
      status: "pass",
      message: "Framework, test runner, and conventions detected",
      weight: 5,
    });
    totalScore += 5;
  } else {
    checks.push({
      label: "Project Detected",
      status: "warn",
      message: "Run project_conventions() to detect stack",
      weight: 2,
    });
    totalScore += 2;
  }

  // 9. Goal is set (weight: 5)
  const goal = inputGoal || (sessionMemory.getSummary().currentGoal as string) || "";
  if (goal) {
    checks.push({
      label: "Goal Set",
      status: "pass",
      message: `Current goal: "${goal.substring(0, 60)}"`,
      weight: 5,
    });
    totalScore += 5;
  } else {
    checks.push({
      label: "Goal Set",
      status: "warn",
      message: "No goal set — use goal parameter or setGoal to track intent",
      weight: 2,
    });
    totalScore += 2;
  }

  // Compute risk level
  let risk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  if (totalScore >= 85) risk = "LOW";
  else if (totalScore >= 65) risk = "MEDIUM";
  else if (totalScore >= 40) risk = "HIGH";
  else risk = "CRITICAL";

  // Summary
  const passCount = checks.filter((c) => c.status === "pass").length;
  const warnCount = checks.filter((c) => c.status === "warn").length;
  const failCount = checks.filter((c) => c.status === "fail").length;

  const summaryParts: string[] = [];
  if (passCount > 0) summaryParts.push(`${passCount} check(s) passed`);
  if (warnCount > 0) summaryParts.push(`${warnCount} warning(s)`);
  if (failCount > 0) summaryParts.push(`${failCount} failure(s)`);

  return {
    score: totalScore,
    maxScore,
    risk,
    checks,
    summary: summaryParts.join(", "),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Format safety score as human-readable text with emoji icons.
 */
export function formatSafetyScore(report: SafetyScoreReport): string {
  const barLength = 20;
  const filledBars = Math.round((report.score / report.maxScore) * barLength);
  const emptyBars = barLength - filledBars;
  const bar = "█".repeat(filledBars) + "░".repeat(emptyBars);

  const riskEmoji =
    report.risk === "LOW" ? "🟢" :
    report.risk === "MEDIUM" ? "🟡" :
    report.risk === "HIGH" ? "🟠" : "🔴";

  const lines: string[] = [
    `🛡️ **Safety Score: ${report.score}/${report.maxScore}** ${riskEmoji}`,
    `   ${bar}`,
    `   Risk: **${report.risk}** — ${report.summary}`,
    "",
    "**Checks:**",
  ];

  for (const check of report.checks) {
    const icon =
      check.status === "pass" ? "✅" :
      check.status === "warn" ? "⚠️" : "❌";
    lines.push(`  ${icon} **${check.label}:** ${check.message}`);
  }

  lines.push(
    "",
    "💡 Run kuma_safety_score() at any time to re-evaluate project health.",
  );

  return lines.join("\n");
}

/**
 * Format safety score as structured JSON for AI consumption.
 */
export function formatSafetyScoreJSON(report: SafetyScoreReport): string {
  return JSON.stringify(report, null, 2);
}
