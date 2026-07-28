// ============================================================
// KUMA IDE CORE — Gotcha Queries
// ============================================================

import { safeQueryAll } from "./db.js";
import type { KumaGotcha } from "./types.js";

const TABLE = "known_gotchas";

/**
 * Get all known gotchas, optionally filtered by file path or severity.
 */
export function getGotchas(
  db: any,
  options?: { filePath?: string; severity?: string }
): KumaGotcha[] {
  const conditions: string[] = [];
  const params: any[] = [];

  if (options?.filePath) {
    conditions.push("file_path LIKE ?");
    params.push(`%${options.filePath}%`);
  }
  if (options?.severity) {
    conditions.push("severity = ?");
    params.push(options.severity);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return safeQueryAll(
    db,
    TABLE,
    `SELECT * FROM ${TABLE} ${whereClause} ORDER BY severity DESC, created_at DESC`,
    params
  ) as KumaGotcha[];
}

/**
 * Get gotcha counts grouped by severity.
 */
export function getGotchaSummary(db: any): {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
} {
  const summary = { total: 0, critical: 0, high: 0, medium: 0, low: 0 };
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

/**
 * Get gotchas for a specific file path.
 */
export function getGotchasForFile(db: any, filePath: string): KumaGotcha[] {
  return getGotchas(db, { filePath });
}
