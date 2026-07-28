// ============================================================
// KUMA IDE CORE — Trajectory & Skill Queries
// ============================================================

import { safeQueryAll, safeCount, tableExists } from "./db.js";
import type { KumaTrajectory, KumaDistilledSkill } from "./types.js";

const TRAJ_TABLE = "trajectories";
const SKILL_TABLE = "distilled_skills";

/**
 * Get all trajectories, most recent first.
 */
export function getTrajectories(db: any, limit = 20): KumaTrajectory[] {
  return safeQueryAll(
    db,
    TRAJ_TABLE,
    `SELECT * FROM ${TRAJ_TABLE} ORDER BY created_at DESC LIMIT ?`,
    [limit]
  ) as KumaTrajectory[];
}

/**
 * Get trajectories by success rate range.
 */
export function getTrajectoriesBySuccess(
  db: any,
  minRate = 0,
  maxRate = 1.0
): KumaTrajectory[] {
  return safeQueryAll(
    db,
    TRAJ_TABLE,
    `SELECT * FROM ${TRAJ_TABLE} WHERE success_rate >= ? AND success_rate <= ? ORDER BY success_rate DESC`,
    [minRate, maxRate]
  ) as KumaTrajectory[];
}

/**
 * Get all distilled skills.
 */
export function getSkills(db: any): KumaDistilledSkill[] {
  return safeQueryAll(
    db,
    SKILL_TABLE,
    `SELECT * FROM ${SKILL_TABLE} ORDER BY success_count DESC, last_used_at DESC`
  ) as KumaDistilledSkill[];
}

/**
 * Get trajectory timeline summary.
 */
export function getTrajectoryTimeline(db: any): {
  totalTrajectories: number;
  totalSkills: number;
  avgSuccessRate: number;
  avgDurationMs: number;
  mostComplex: string;
} {
  const totalTrajectories = safeCount(db, TRAJ_TABLE);
  const totalSkills = safeCount(db, SKILL_TABLE);

  // Only attempt aggregates if table exists
  let avgSuccessRate = 0;
  let avgDurationMs = 0;
  let mostComplex = "N/A";

  if (tableExists(db, TRAJ_TABLE)) {
    const avg = safeQueryAll(db, TRAJ_TABLE, `SELECT AVG(success_rate) as avg FROM ${TRAJ_TABLE}`);
    const avgDuration = safeQueryAll(db, TRAJ_TABLE, `SELECT AVG(total_duration_ms) as avg FROM ${TRAJ_TABLE}`);
    const complexRows = safeQueryAll(db, TRAJ_TABLE, `SELECT goal FROM ${TRAJ_TABLE} ORDER BY complexity DESC LIMIT 1`);

    avgSuccessRate = avg.length > 0 ? (avg[0].avg as number) ?? 0 : 0;
    avgDurationMs = avgDuration.length > 0 ? (avgDuration[0].avg as number) ?? 0 : 0;
    mostComplex = complexRows.length > 0 ? (complexRows[0].goal as string) : "N/A";
  }

  return { totalTrajectories, totalSkills, avgSuccessRate, avgDurationMs, mostComplex };
}
