// ============================================================
// KUMA IDE CORE — Checkpoint Queries
// ============================================================

import { safeQueryAll } from "./db.js";
import type { KumaCheckpoint } from "./types.js";

const TABLE = "checkpoints";

/**
 * Get all checkpoints, most recent first.
 */
export function getCheckpoints(db: any): KumaCheckpoint[] {
  return safeQueryAll(
    db,
    TABLE,
    `SELECT * FROM ${TABLE} ORDER BY created_at DESC`
  ) as KumaCheckpoint[];
}

/**
 * Get a checkpoint by label.
 */
export function getCheckpointByLabel(db: any, label: string): KumaCheckpoint | null {
  const rows = safeQueryAll(db, TABLE, `SELECT * FROM ${TABLE} WHERE label = ?`, [label]);
  return rows.length > 0 ? (rows[0] as KumaCheckpoint) : null;
}

/**
 * Get the latest checkpoint.
 */
export function getLatestCheckpoint(db: any): KumaCheckpoint | null {
  const rows = safeQueryAll(
    db,
    TABLE,
    `SELECT * FROM ${TABLE} ORDER BY created_at DESC LIMIT 1`
  );
  return rows.length > 0 ? (rows[0] as KumaCheckpoint) : null;
}

/**
 * Count checkpoints created in the last N hours.
 */
export function getRecentCheckpointCount(db: any, hours = 24): number {
  const cutoff = Math.floor(Date.now() / 1000) - hours * 3600;
  const rows = safeQueryAll(
    db,
    TABLE,
    `SELECT COUNT(*) as c FROM ${TABLE} WHERE created_at >= ?`,
    [cutoff]
  );
  return (rows[0]?.c as number) ?? 0;
}
