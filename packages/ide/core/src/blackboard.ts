// ============================================================
// KUMA IDE CORE — Blackboard Event Queries
// ============================================================

import { safeQueryAll } from "./db.js";
import type { KumaBlackboardEvent } from "./types.js";

const TABLE = "blackboard_events";

/**
 * Get recent blackboard events.
 */
export function getBlackboardEvents(
  db: any,
  options?: { limit?: number; severity?: string; topic?: string }
): KumaBlackboardEvent[] {
  const conditions: string[] = [];
  const params: any[] = [];

  if (options?.severity) {
    conditions.push("severity = ?");
    params.push(options.severity);
  }
  if (options?.topic) {
    conditions.push("topic LIKE ?");
    params.push(`%${options.topic}%`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = options?.limit ?? 50;

  return safeQueryAll(
    db,
    TABLE,
    `SELECT * FROM ${TABLE} ${whereClause} ORDER BY created_at DESC LIMIT ?`,
    [...params, limit]
  ) as KumaBlackboardEvent[];
}

/**
 * Get event counts grouped by severity.
 */
export function getBlackboardSummary(db: any): {
  total: number;
  info: number;
  warning: number;
  critical: number;
} {
  const summary = { total: 0, info: 0, warning: 0, critical: 0 };
  const rows = safeQueryAll(
    db,
    TABLE,
    `SELECT severity, COUNT(*) as count FROM ${TABLE} GROUP BY severity`
  );

  for (const row of rows) {
    const sev = row.severity as string;
    const count = row.count as number;
    summary.total += count;
    if (sev in summary) {
      (summary as any)[sev] = count;
    }
  }
  return summary;
}
