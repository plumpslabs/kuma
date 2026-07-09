// ============================================================
// SAFETY AUDIT — Centralized audit trail for all operations
// ============================================================
// Every tool call that passes through the safety proxy gets
// recorded here: timestamp, tool name, parameters, risk level,
// policy verdict, and outcome.
//
// Stored in the SQLite database (kuma.db) in a `safety_audit` table.
// Queryable via kuma_analytics or direct SQL.
// ============================================================

import { getDb, saveDb } from "./kumaDb.js";

export interface AuditEntry {
  id?: number;
  timestamp: number;
  toolName: string;
  action: string;
  filePath?: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  policyViolations: number;
  allowed: boolean;
  durationMs: number;
  metadata?: Record<string, unknown>;
}

// ============================================================
// SCHEMA — Ensure safety_audit table exists
// ============================================================

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS safety_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    tool_name TEXT NOT NULL,
    action TEXT NOT NULL,
    file_path TEXT,
    risk_level TEXT NOT NULL DEFAULT 'low',
    policy_violations INTEGER DEFAULT 0,
    allowed INTEGER NOT NULL DEFAULT 1,
    duration_ms INTEGER DEFAULT 0,
    metadata TEXT DEFAULT '{}'
  );
  CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON safety_audit(timestamp);
  CREATE INDEX IF NOT EXISTS idx_audit_tool ON safety_audit(tool_name);
  CREATE INDEX IF NOT EXISTS idx_audit_risk ON safety_audit(risk_level);
  CREATE INDEX IF NOT EXISTS idx_audit_allowed ON safety_audit(allowed);
`;

let schemaEnsured = false;

async function ensureSchema(): Promise<void> {
  if (schemaEnsured) return;
  try {
    const db = await getDb();
    db.exec(SCHEMA_SQL);
    saveDb();
    schemaEnsured = true;
  } catch (err) {
    console.error(`[SafetyAudit] Failed to ensure schema: ${err}`);
  }
}

// ============================================================
// RECORD
// ============================================================

/**
 * Record a safety-checked operation in the audit trail.
 * Called by the safety proxy after every tool execution.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await ensureSchema();
    const db = await getDb();
    db.run(`
      INSERT INTO safety_audit (timestamp, tool_name, action, file_path, risk_level, policy_violations, allowed, duration_ms, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      entry.timestamp,
      entry.toolName,
      entry.action,
      entry.filePath || null,
      entry.riskLevel,
      entry.policyViolations,
      entry.allowed ? 1 : 0,
      entry.durationMs,
      JSON.stringify(entry.metadata || {}),
    ]);
    saveDb();
  } catch (err) {
    console.error(`[SafetyAudit] Failed to record audit: ${err}`);
  }
}

// ============================================================
// QUERY
// ============================================================

/**
 * Query the audit trail with optional filters.
 */
export async function queryAudit(params: {
  toolName?: string;
  riskLevel?: string;
  allowed?: boolean;
  limit?: number;
  since?: number;
}): Promise<string> {
  try {
    await ensureSchema();
    const db = await getDb();
    const { toolName, riskLevel, allowed, limit = 20, since } = params;

    let sql = "SELECT * FROM safety_audit WHERE 1=1";
    const bindParams: unknown[] = [];

    if (toolName) { sql += " AND tool_name = ?"; bindParams.push(toolName); }
    if (riskLevel) { sql += " AND risk_level = ?"; bindParams.push(riskLevel); }
    if (allowed !== undefined) { sql += " AND allowed = ?"; bindParams.push(allowed ? 1 : 0); }
    if (since) { sql += " AND timestamp >= ?"; bindParams.push(since); }

    sql += " ORDER BY timestamp DESC LIMIT ?";
    bindParams.push(limit);

    const stmt = db.prepare(sql);
    stmt.bind(bindParams);
    const results: Array<Record<string, unknown>> = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();

    if (results.length === 0) {
      return "📋 **Safety Audit** — No records found for the given filters.";
    }

    const lines: string[] = [
      `📋 **Safety Audit** — ${results.length} record(s)`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━`,
      "",
    ];

    for (const r of results) {
      const riskIcon = r.risk_level === "critical" ? "🔴" : r.risk_level === "high" ? "🟠" : r.risk_level === "medium" ? "🟡" : "🟢";
      const allowIcon = r.allowed ? "✅" : "⛔";
      const time = new Date((r.timestamp as number) * 1000).toLocaleTimeString();
      lines.push(`${allowIcon} ${riskIcon} **${r.tool_name}** — ${r.action}`);
      if (r.file_path) lines.push(`   📍 ${r.file_path}`);
      lines.push(`   🕐 ${time} | ${r.duration_ms}ms | ${r.policy_violations} policy violation(s)`);
      lines.push("");
    }

    return lines.join("\n");
  } catch (err) {
    return `Error querying audit: ${err}`;
  }
}

/**
 * Get audit statistics.
 */
export async function auditStats(): Promise<string> {
  try {
    await ensureSchema();
    const db = await getDb();

    const total = ((db.exec("SELECT COUNT(*) as c FROM safety_audit"))[0]?.values[0][0] as number) ?? 0;
    const blocked = ((db.exec("SELECT COUNT(*) as c FROM safety_audit WHERE allowed = 0"))[0]?.values[0][0] as number) ?? 0;
    const critical = ((db.exec("SELECT COUNT(*) as c FROM safety_audit WHERE risk_level IN ('high','critical')"))[0]?.values[0][0] as number) ?? 0;

    // Top blocked tools
    let topBlocked: Array<Record<string, unknown>> = [];
    try {
      const stmt = db.prepare("SELECT tool_name, COUNT(*) as cnt FROM safety_audit WHERE allowed = 0 GROUP BY tool_name ORDER BY cnt DESC LIMIT 5");
      while (stmt.step()) {
        topBlocked.push(stmt.getAsObject());
      }
      stmt.free();
    } catch {}

    const lines: string[] = [
      `📊 **Safety Audit Stats**`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━`,
      "",
      `📝 Total operations: ${total}`,
      `⛔ Blocked: ${blocked} (${total > 0 ? ((blocked / total) * 100).toFixed(1) : 0}%)`,
      `🔴 High/Critical risk: ${critical}`,
      "",
    ];

    if (topBlocked.length > 0) {
      lines.push("**Most blocked tools:**");
      for (const t of topBlocked) {
        lines.push(`  • ${t.tool_name}: ${t.cnt}x blocked`);
      }
    }

    return lines.join("\n");
  } catch (err) {
    return `Error getting audit stats: ${err}`;
  }
}
