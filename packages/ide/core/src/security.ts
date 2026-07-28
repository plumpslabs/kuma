// ============================================================
// KUMA IDE CORE — Security Findings Queries
// ============================================================

import { safeQueryAll, safeCount } from "./db.js";
import type { KumaSecurityFinding, KumaHealthSnapshot } from "./types.js";

const SEC_TABLE = "security_findings";
const HEALTH_TABLE = "health_snapshots";

/**
 * Get all security findings, most recent first.
 */
export function getSecurityFindings(db: any): KumaSecurityFinding[] {
  return safeQueryAll(
    db,
    SEC_TABLE,
    `SELECT * FROM ${SEC_TABLE} ORDER BY created_at DESC`
  ) as KumaSecurityFinding[];
}

/**
 * Get unremediated security findings.
 */
export function getOpenSecurityFindings(db: any): KumaSecurityFinding[] {
  return safeQueryAll(
    db,
    SEC_TABLE,
    `SELECT * FROM ${SEC_TABLE} WHERE remediated = 0 ORDER BY created_at DESC`
  ) as KumaSecurityFinding[];
}

/**
 * Get the latest health snapshot.
 */
export function getLatestHealthSnapshot(db: any): KumaHealthSnapshot | null {
  const rows = safeQueryAll(
    db,
    HEALTH_TABLE,
    `SELECT * FROM ${HEALTH_TABLE} ORDER BY created_at DESC LIMIT 1`
  );
  return rows.length > 0 ? (rows[0] as KumaHealthSnapshot) : null;
}

/**
 * Get security summary.
 */
export function getSecuritySummary(db: any): {
  total: number;
  open: number;
  remediated: number;
  highestSeverity: string | null;
} {
  const total = safeCount(db, SEC_TABLE);
  const open = safeCount(db, SEC_TABLE, "remediated = 0");
  const remediated = total - open;

  const worst = safeQueryAll(
    db,
    SEC_TABLE,
    `SELECT severity FROM ${SEC_TABLE} WHERE remediated = 0 ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 END ASC LIMIT 1`
  );

  return {
    total,
    open,
    remediated,
    highestSeverity: worst.length > 0 ? (worst[0].severity as string) : null,
  };
}
