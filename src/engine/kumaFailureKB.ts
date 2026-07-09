// ============================================================
// KUMA FAILURE KB — Failure Knowledge Base (Phase 8.1)
// ============================================================
// Every AI failure is saved and becomes a learning.
// Categorizes by type, symbol, and error pattern.
// ============================================================

import { getDb, saveDb } from "./kumaDb.js";

interface FailureRecord {
  type: "rename" | "type_error" | "test_failure" | "build_error" | "runtime_error" | "circular_dep" | "other";
  symbol?: string;
  filePath?: string;
  errorMessage: string;
  solution?: string;
  timestamp: number;
}

/**
 * Record a failure in the knowledge base.
 */
export async function recordFailure(failure: Omit<FailureRecord, "timestamp">): Promise<string> {
  try {
    const db = await getDb();
    db.run(`CREATE TABLE IF NOT EXISTS failure_kb (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      symbol TEXT,
      file_path TEXT,
      error_message TEXT NOT NULL,
      solution TEXT,
      timestamp INTEGER DEFAULT (strftime('%s','now')),
      resolved INTEGER DEFAULT 0
    )`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_failure_type ON failure_kb(type)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_failure_symbol ON failure_kb(symbol)`);

    db.run(`INSERT INTO failure_kb (type, symbol, file_path, error_message, solution) VALUES (?, ?, ?, ?, ?)`,
      [failure.type, failure.symbol || null, failure.filePath || null, failure.errorMessage.substring(0, 500), failure.solution || null]);

    saveDb(db);
    return `✅ Failure recorded: ${failure.type} — ${failure.errorMessage.substring(0, 100)}`;
  } catch (err) {
    return `Error recording failure: ${err}`;
  }
}

/**
 * Query failure knowledge base for similar patterns.
 */
export async function queryFailures(query: string, limit = 10): Promise<string> {
  try {
    const db = await getDb();
    const terms = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);

    // Search across type, symbol, and error message
    const results: Array<Record<string, unknown>> = [];
    for (const term of terms.slice(0, 5)) {
      const stmt = db.prepare(`
        SELECT type, symbol, file_path, error_message, solution, timestamp, resolved
        FROM failure_kb
        WHERE type LIKE ? OR symbol LIKE ? OR error_message LIKE ? OR file_path LIKE ?
        ORDER BY timestamp DESC LIMIT ?
      `);
      stmt.bind([`%${term}%`, `%${term}%`, `%${term}%`, `%${term}%`, limit]);
      while (stmt.step()) results.push(stmt.getAsObject());
      stmt.free();
    }

    // Deduplicate
    const seen = new Set<number>();
    const unique = results.filter(r => {
      const key = r.error_message as string;
      if (seen.has(hashStr(key))) return false;
      seen.add(hashStr(key));
      return true;
    }).slice(0, limit);

    if (unique.length === 0) {
      return `🔍 **Failure KB** — No failures found for "${query}". Use kuma_failure({ action: 'record', ... }) to build the database.`;
    }

    const lines: string[] = [
      `🔍 **Failure KB** — ${unique.length} result(s) for "${query}"`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━`,
      "",
    ];
    for (const r of unique) {
      const emoji = r.type === "test_failure" ? "🧪" : r.type === "type_error" ? "📐" : r.type === "build_error" ? "🏗️" : r.type === "circular_dep" ? "🔄" : r.type === "runtime_error" ? "💥" : "⚠️";
      lines.push(`${emoji} **${r.type}**${r.symbol ? ` — \`${r.symbol}\`` : ""}`);
      lines.push(`   ${(r.error_message as string).substring(0, 200)}`);
      if (r.solution) lines.push(`   ✅ Solution: ${(r.solution as string).substring(0, 200)}`);
      if (r.file_path) lines.push(`   📍 ${r.file_path}`);
      lines.push("");
    }

    lines.push("💡 Failures are learned automatically. Use kuma_failure({ action: 'record' }) to save new ones.");
    return lines.join("\n");
  } catch (err) {
    return `Error querying failures: ${err}`;
  }
}

/**
 * Get failure statistics.
 */
export async function failureStats(): Promise<string> {
  try {
    const db = await getDb();
    const byType = db.exec(`SELECT type, COUNT(*) as cnt FROM failure_kb GROUP BY type ORDER BY cnt DESC`);
    const total = (db.exec("SELECT COUNT(*) as c FROM failure_kb")[0]?.values[0][0] as number) || 0;
    const resolved = (db.exec("SELECT COUNT(*) as c FROM failure_kb WHERE resolved = 1")[0]?.values[0][0] as number) || 0;

    const lines: string[] = [
      `📊 **Failure KB Stats**`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━`,
      "",
      `📚 ${total} failures | ✅ ${resolved} resolved (${total > 0 ? Math.round(resolved / total * 100) : 0}%)`,
      "",
    ];
    if (byType[0]?.values) {
      lines.push("**By Type:**");
      for (const row of byType[0].values) {
        lines.push(`  • ${row[0]}: ${row[1]}`);
      }
    }
    return lines.join("\n");
  } catch (err) {
    return `Error getting failure stats: ${err}`;
  }
}

function hashStr(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}
