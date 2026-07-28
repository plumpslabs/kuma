// ============================================================
// KUMA IDE CORE — Public API
// ============================================================

// Database
export { openDb, findKumaDb, queryAll, queryOne, getDbStats, hasKumaDb } from "./db.js";

// Graph
export {
  getNodes,
  getEdges,
  searchNodes,
  getNode,
  getNodeEdges,
  generateMermaid,
  getGraphExport,
} from "./graph.js";

// Gotchas
export { getGotchas, getGotchaSummary, getGotchasForFile } from "./gotchas.js";

// Trajectories & Skills
export {
  getTrajectories,
  getTrajectoriesBySuccess,
  getSkills,
  getTrajectoryTimeline,
} from "./trajectory.js";

// Checkpoints
export {
  getCheckpoints,
  getCheckpointByLabel,
  getLatestCheckpoint,
  getRecentCheckpointCount,
} from "./checkpoint.js";

// Drift
export {
  getDriftRecords,
  getDriftForFile,
  getLastDriftCheck,
  getActiveDriftCount,
} from "./drift.js";

// Blackboard
export {
  getBlackboardEvents,
  getBlackboardSummary,
} from "./blackboard.js";

// Security
export {
  getSecurityFindings,
  getOpenSecurityFindings,
  getLatestHealthSnapshot,
  getSecuritySummary,
} from "./security.js";

// Health
export { computeHealthScore, getStatusReport } from "./health.js";

// Types
export type * from "./types.js";

// ============================================================
// Convenience: load all dashboard data at once
// ============================================================
import { getNodes, getEdges, getGraphExport } from "./graph.js";
import { getGotchas } from "./gotchas.js";
import { getTrajectories, getSkills } from "./trajectory.js";
import { getCheckpoints } from "./checkpoint.js";
import { getDriftRecords } from "./drift.js";
import { getBlackboardEvents } from "./blackboard.js";
import { getSecurityFindings } from "./security.js";
import { computeHealthScore } from "./health.js";
import type { KumaDashboardData } from "./types.js";

/**
 * Load all dashboard data in a single call.
 */
export function loadDashboard(
  db: any,
  options?: { maxGraphNodes?: number }
): KumaDashboardData {
  return {
    graph: getGraphExport(db, { maxNodes: options?.maxGraphNodes }),
    gotchas: getGotchas(db),
    trajectories: getTrajectories(db),
    skills: getSkills(db),
    checkpoints: getCheckpoints(db),
    blackboardEvents: getBlackboardEvents(db),
    securityFindings: getSecurityFindings(db),
    driftRecords: getDriftRecords(db),
    healthScore: computeHealthScore(db),
    nodeCount: getNodes(db).length,
    edgeCount: getEdges(db).length,
  };
}
