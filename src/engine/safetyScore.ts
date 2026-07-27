import { sessionMemory } from "./sessionMemory.js";
import {
  getSessionStats,
  getGitDiffStat,
  getUnresolvedCount,
} from "../utils/kumaShared.js";

// ============================================================
// SAFETY SCORE — Aggregate project health into 0-100 score
// ============================================================

interface SafetyCheck {
  label: string;
  status: "pass" | "warn" | "fail";
  message: string;
  weight: number; // contribution to total score
}

interface SafetyScoreReport {
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
export async function computeSafetyScore(inputGoal?: string): Promise<SafetyScoreReport> {
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

  // 2. Graph health (weight: 10) — V3: knowledge graph confidence
  try {
    const { getDb } = await import("./kumaDb.js");
    const db = await getDb();
    const nodeCount = (db.exec("SELECT COUNT(*) as c FROM nodes")[0]?.values[0][0] as number) ?? 0;
    const edgeCount = (db.exec("SELECT COUNT(*) as c FROM edges")[0]?.values[0][0] as number) ?? 0;
    if (nodeCount > 0) {
      checks.push({
        label: "Graph Health",
        status: "pass",
        message: `${nodeCount} nodes, ${edgeCount} edges`,
        weight: 10,
      });
      totalScore += 10;
    } else {
      checks.push({
        label: "Graph Health",
        status: "warn",
        message: "Empty knowledge graph — run research first",
        weight: 5,
      });
      totalScore += 5;
    }
  } catch {
    checks.push({
      label: "Graph Health",
      status: "warn",
      message: "Could not check graph health",
      weight: 5,
    });
    totalScore += 5;
  }

  // 3. Research cached (weight: 10) — V3: has research been done?
  try {
    const { getDb } = await import("./kumaDb.js");
    const db = await getDb();
    const researchCount = (db.exec("SELECT COUNT(*) as c FROM research_cache")[0]?.values[0][0] as number) ?? 0;
    checks.push({
      label: "Research Cached",
      status: researchCount > 0 ? "pass" : "warn",
      message: researchCount > 0 ? `${researchCount} research scope(s) cached` : "No research cached — run kuma_context research first",
      weight: 10,
    });
    totalScore += researchCount > 0 ? 10 : 5;
  } catch {
    checks.push({
      label: "Research Cached",
      status: "warn",
      message: "Could not check research cache",
      weight: 5,
    });
    totalScore += 5;
  }

  // 4. Tests status (weight: 15)
  const unresolvedCount = getUnresolvedCount(stats.failedFiles);
  const allFailures = stats.failedFiles.flatMap((f) => f.failures);
  const testFailures = allFailures.filter((f) => f.error.toLowerCase().includes("test") || f.error.toLowerCase().includes("fail"));
  const hasRunTests = stats.hasRunTests;

  let latestVerif: { passed: boolean; scope: string; runner: string } | null = null;
  try {
    const { getLatestVerifications } = await import("./kumaDb.js");
    const verifs = await getLatestVerifications(1);
    if (verifs.length > 0) latestVerif = verifs[0];
  } catch {}

  if (!hasRunTests && !latestVerif) {
    checks.push({
      label: "Tests Status",
      status: "warn",
      message: "No tests run yet this session — run kuma_safety({ action: 'verify' })",
      weight: 10,
    });
    totalScore += 10;
  } else if (latestVerif) {
    if (latestVerif.passed) {
      checks.push({
        label: "Tests Status",
        status: "pass",
        message: `Auto-verified passed (${latestVerif.scope})`,
        weight: 15,
      });
      totalScore += 15;
    } else {
      checks.push({
        label: "Tests Status",
        status: "fail",
        message: `Auto-verification failed (${latestVerif.scope}) — fix before shipping`,
        weight: 0,
      });
    }
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
      message: `${modifiedCount} file(s) modified — consider committing`,
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


