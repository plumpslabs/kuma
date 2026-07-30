// ============================================================
// KUMA GOTCHAS — Anti-Regression Shield (Issue #21)
// ============================================================
// Builds on top of Layer 3 (KNOWN_GOTCHAS.md) to provide
// pre-edit safety alerts when agents modify files with known
// legacy quirks. Integrates with kuma_safety check pipeline.
// ============================================================

import { sessionMemory } from "./sessionMemory.js";
import { getDb, saveDb } from "./kumaDb.js";
import { getActiveGotchas, checkFileGotchas, appendToLayer } from "./domainRules.js";

// ============================================================
// GOTCHA TABLE — Structured storage alongside markdown file
// ============================================================

async function ensureGotchasSchema(): Promise<void> {
  const db = await getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS known_gotchas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL,
      description TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'medium'
        CHECK(severity IN ('low','medium','high','critical')),
      workaround TEXT,
      added_by TEXT DEFAULT 'agent',
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_gotchas_file ON known_gotchas(file_path);
    CREATE INDEX IF NOT EXISTS idx_gotchas_severity ON known_gotchas(severity);
  `);
  saveDb();
}

// ============================================================
// ADD GOTCHA
// ============================================================

export interface GotchaEntry {
  filePath: string;
  description: string;
  severity?: "low" | "medium" | "high" | "critical";
  workaround?: string;
}

/**
 * Add a known gotcha to both the structured table and the markdown file.
 */
export async function addGotcha(entry: GotchaEntry): Promise<string> {
  try {
    await ensureGotchasSchema();
    const db = await getDb();

    const severity: "low" | "medium" | "high" | "critical" = entry.severity || "medium";
    const formatted = [
      `### ${entry.filePath} — ${entry.description}`,
      `- **Issue**: ${entry.description}`,
      `- **Severity**: ${severity}`,
      entry.workaround ? `- **Workaround**: ${entry.workaround}` : "",
      `- **Added**: ${new Date().toISOString().split("T")[0]}`,
    ].filter(Boolean).join("\n");

    // Save to structured table
    db.run(
      `INSERT INTO known_gotchas (file_path, description, severity, workaround) VALUES (?, ?, ?, ?)`,
      [entry.filePath, entry.description, severity, entry.workaround || null]
    );

    // Append to Layer 3 markdown file
    const mdResult = appendToLayer("gotcha", formatted);

    // Save to graph nodes & edges to ensure graph connectedness
    try {
      const { upsertNode, addEdge, nodeId } = await import("./kumaGraph.js");
      const fileNodeId = nodeId("file", entry.filePath);
      const gotchaNodeId = `gotcha::${entry.filePath}::${entry.description.substring(0, 30)}`;

      await upsertNode({ id: fileNodeId, type: "file", name: entry.filePath });
      await upsertNode({
        id: gotchaNodeId,
        type: "gotcha",
        name: `gotcha:${entry.description.substring(0, 40)}`,
        filePath: entry.filePath,
        metadata: { severity, workaround: entry.workaround },
      });
      await addEdge({ sourceId: fileNodeId, targetId: gotchaNodeId, type: "depends_on" });
    } catch {}

    saveDb();
    sessionMemory.recordToolCall("kuma_gotcha_add", {
      filePath: entry.filePath,
      severity,
    });

    return `✅ **Gotcha recorded**: ${entry.filePath} — ${entry.description}\n${mdResult}`;
  } catch (err) {
    return `❌ Failed to add gotcha: ${err}`;
  }
}

// ============================================================
// LIST GOTCHAS
// ============================================================

export async function listGotchas(params: {
  filePath?: string;
  severity?: string;
}): Promise<string> {
  try {
    await ensureGotchasSchema();
    const db = await getDb();

    let sql = "SELECT * FROM known_gotchas WHERE 1=1";
    const bind: unknown[] = [];

    if (params.filePath) {
      sql += " AND file_path LIKE ?";
      bind.push(`%${params.filePath}%`);
    }
    if (params.severity) {
      sql += " AND severity = ?";
      bind.push(params.severity);
    }

    sql += " ORDER BY severity DESC, created_at DESC LIMIT 50";

    const stmt = db.prepare(sql);
    stmt.bind(bind);
    const results: Array<Record<string, unknown>> = [];
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();

    if (results.length === 0) {
      return "✅ **No gotchas recorded** — legacy codebase looks clean.";
    }

    const lines: string[] = [
      `⚠️ **Known Gotchas** — ${results.length} recorded`,
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "",
    ];

    for (const g of results) {
      const icon = g.severity === "critical" ? "🔴"
        : g.severity === "high" ? "🟠"
          : g.severity === "medium" ? "🟡" : "🟢";
      lines.push(`${icon} [${g.severity}] ${g.file_path}`);
      lines.push(`   📝 ${g.description?.toString().substring(0, 100)}`);
      if (g.workaround) lines.push(`   💡 ${(g.workaround as string).substring(0, 100)}`);
      lines.push("");
    }

    return lines.join("\n");
  } catch (err) {
    return `Error: ${err}`;
  }
}

// ============================================================
// SAFETY CHECK — Called during pre-edit checks
// ============================================================

/**
 * Check if a file path has known gotchas.
 * Returns formatted warnings for injection into safety check output.
 * Integrated into kumaSafetyLayer.safetyCheck().
 */
export function checkGotchasForFile(filePath: string): string[] {
  const warnings: string[] = [];
  const markdownWarnings = checkFileGotchas(filePath);

  // Also check structured table
  try {
    // Sync from markdown file to table on check
    const gotchas = getActiveGotchas();
    for (const g of gotchas) {
      if (filePath.includes(g.filePath) || g.filePath.includes(filePath)) {
        if (!markdownWarnings.some(w => w.includes(g.description))) {
          const icon = g.severity === "critical" ? "🔴"
            : g.severity === "high" ? "🟠"
              : g.severity === "medium" ? "🟡" : "🟢";
          warnings.push(`${icon} **Known Gotcha**: ${g.description} (${g.severity})`);
        }
      }
    }
  } catch { /* skip */ }

  return [...new Set([...markdownWarnings, ...warnings])];
}

// ============================================================
// SYNC MARKDOWN → DB
// ============================================================

/**
 * Sync gotchas from KNOWN_GOTCHAS.md into the structured DB table.
 */
export async function syncGotchasToDb(): Promise<{ synced: number }> {
  try {
    await ensureGotchasSchema();
    const db = await getDb();
    const gotchas = getActiveGotchas();
    let synced = 0;

    for (const g of gotchas) {
      // Check if already exists
      const checkStmt = db.prepare(
        `SELECT id FROM known_gotchas WHERE file_path = ? AND description = ?`
      );
      checkStmt.bind([g.filePath, g.description]);
      const exists = checkStmt.step();
      checkStmt.free();
      if (exists) continue;

      // Insert
      db.run(
        `INSERT INTO known_gotchas (file_path, description, severity) VALUES (?, ?, ?)`,
        [g.filePath, g.description, g.severity]
      );
      synced++;
    }

    saveDb();
    return { synced };
  } catch {
    return { synced: 0 };
  }
}
