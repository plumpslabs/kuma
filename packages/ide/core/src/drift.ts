// ============================================================
// KUMA IDE CORE — Drift Detection Queries
// ============================================================

import { safeQueryAll } from "./db.js";
import type { KumaDriftRecord } from "./types.js";

const TABLE = "drift_records";

/**
 * Get all drift records, most recent first.
 */
export function getDriftRecords(db: any): KumaDriftRecord[] {
  return safeQueryAll(
    db,
    TABLE,
    `SELECT * FROM ${TABLE} ORDER BY created_at DESC`
  ) as KumaDriftRecord[];
}

/**
 * Get drift records for a specific file.
 */
export function getDriftForFile(db: any, filePath: string): KumaDriftRecord[] {
  return safeQueryAll(
    db,
    TABLE,
    `SELECT * FROM ${TABLE} WHERE file_path = ? ORDER BY created_at DESC`,
    [filePath]
  ) as KumaDriftRecord[];
}

/**
 * Get the most recent drift record timestamp.
 */
export function getLastDriftCheck(db: any): number | null {
  const rows = safeQueryAll(
    db,
    TABLE,
    `SELECT created_at FROM ${TABLE} ORDER BY created_at DESC LIMIT 1`
  );
  return rows.length > 0 ? (rows[0].created_at as number) : null;
}

/**
 * Count active drift issues (not yet resolved).
 */
export function getActiveDriftCount(db: any): number {
  const rows = safeQueryAll(
    db,
    TABLE,
    `SELECT COUNT(*) as c FROM ${TABLE} WHERE actual_hash != expected_hash`
  );
  return (rows[0]?.c as number) ?? 0;
}
