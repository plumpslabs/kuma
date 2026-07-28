// ============================================================
// KUMA IDE CORE — Health & Status Queries
// ============================================================

import { safeQueryAll, safeCount, tableExists } from "./db.js";
import { getNodes, getEdges } from "./graph.js";
import { getGotchaSummary } from "./gotchas.js";
import { getTrajectoryTimeline } from "./trajectory.js";
import { getBlackboardSummary } from "./blackboard.js";
import { getSecuritySummary } from "./security.js";

/**
 * Compute a composite health score (0-100) from the database.
 */
export function computeHealthScore(db: any): number {
  let score = 100;

  // Penalize: no nodes
  const nodeCount = safeCount(db, "nodes");
  if (nodeCount === 0) score -= 20;
  else if (nodeCount < 5) score -= 10;

  // Reward: trajectories with high success rate
  if (tableExists(db, "trajectories")) {
    const successRate = (safeQueryAll(db, "trajectories", "SELECT AVG(success_rate) as avg FROM trajectories")[0]?.avg as number) ?? 0;
    if (successRate >= 0.8) score += 5;
    else if (successRate < 0.3 && successRate > 0) score -= 10;
  }

  if (tableExists(db, "security_findings")) {
    // Penalize: open security findings
    const openFindings = safeCount(db, "security_findings", "remediated = 0");
    score -= openFindings * 5;
  }

  if (tableExists(db, "known_gotchas")) {
    // Penalize: critical gotchas
    const criticalGotchas = safeCount(db, "known_gotchas", "severity = 'critical'");
    score -= criticalGotchas * 10;
    const highGotchas = safeCount(db, "known_gotchas", "severity = 'high'");
    score -= highGotchas * 5;
  }

  if (tableExists(db, "drift_records")) {
    // Penalize: active drift
    const driftCount = safeCount(db, "drift_records", "actual_hash != expected_hash");
    score -= driftCount * 3;
  }

  if (tableExists(db, "checkpoints")) {
    // Reward: checkpoints (shows good practices)
    const cpCount = safeCount(db, "checkpoints");
    if (cpCount >= 3) score += 5;
    else if (cpCount >= 1) score += 2;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Generate a comprehensive status report.
 */
export function getStatusReport(db: any): string {
  const nodes = getNodes(db);
  const edges = getEdges(db);
  const gotchaSummary = getGotchaSummary(db);
  const trajectoryInfo = getTrajectoryTimeline(db);
  const blackboardSummary = getBlackboardSummary(db);
  const securitySummary = getSecuritySummary(db);
  const healthScore = computeHealthScore(db);

  const lines: string[] = [
    "╔══════════════════════════════════════╗",
    "║        KUMA DASHBOARD STATUS         ║",
    "╚══════════════════════════════════════╝",
    "",
    `📊 Health Score: ${healthScore}/100`,
    "",
    "── Knowledge Graph ──",
    `   Nodes: ${nodes.length}`,
    `   Edges: ${edges.length}`,
    "",
    "── Gotchas ──",
    `   Total: ${gotchaSummary.total}`,
    `   🔴 Critical: ${gotchaSummary.critical}`,
    `   🟠 High: ${gotchaSummary.high}`,
    `   🟡 Medium: ${gotchaSummary.medium}`,
    `   🟢 Low: ${gotchaSummary.low}`,
    "",
    "── Trajectories ──",
    `   Total: ${trajectoryInfo.totalTrajectories}`,
    `   Skills: ${trajectoryInfo.totalSkills}`,
    `   Avg Success: ${(trajectoryInfo.avgSuccessRate * 100).toFixed(1)}%`,
    `   Avg Duration: ${trajectoryInfo.avgDurationMs.toFixed(0)}ms`,
    "",
    "── Blackboard Events ──",
    `   Total: ${blackboardSummary.total}`,
    `   Info: ${blackboardSummary.info} | Warning: ${blackboardSummary.warning} | Critical: ${blackboardSummary.critical}`,
    "",
    "── Security ──",
    `   Total: ${securitySummary.total} | Open: ${securitySummary.open}`,
    `   Highest Severity: ${securitySummary.highestSeverity ?? "None"}`,
    "",
    "── Checkpoints ──",
    `   ${safeCount(db, "checkpoints")} total`,
    "",
    `📁 DB: .kuma/kuma.db`,
  ];

  return lines.join("\n");
}
