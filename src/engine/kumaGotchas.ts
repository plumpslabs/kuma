// ============================================================
// KUMA GOTCHAS — Anti-Regression Shield (Issue #21)
// ============================================================
// Builds on top of Layer 3 (KNOWN_GOTCHAS.md) to provide
// pre-edit safety alerts when agents modify files with known
// legacy quirks. Integrates with kuma_safety check pipeline.
// ============================================================

import { sessionMemory } from "./sessionMemory.js";
import { getDb, saveDb, rebuildFtsIndex } from "./kumaDb.js";
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
 * Add a known gotcha to the structured table (single source of truth).
 * Graph nodes are derived — sync via syncGotchasGraph() when needed.
 * Automatically links to related arch_flow and decision nodes via causes edges.
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

    // Upsert: update if same file_path + description exists, otherwise insert
    const checkStmt = db.prepare(
      `SELECT id FROM known_gotchas WHERE file_path = ? AND description LIKE ?`
    );
    checkStmt.bind([entry.filePath, `${entry.description.substring(0, 30)}%`]);
    const existing = checkStmt.step();
    let existingId: number | null = null;
    if (existing) {
      const row = checkStmt.getAsObject() as { id: number };
      existingId = row.id;
    }
    checkStmt.free();

    if (existingId !== null) {
      // Update existing gotcha
      db.run(
        `UPDATE known_gotchas SET severity = ?, workaround = ?, updated_at = strftime('%s','now') WHERE id = ?`,
        [severity, entry.workaround || null, existingId]
      );
    } else {
      // Insert new gotcha
      db.run(
        `INSERT INTO known_gotchas (file_path, description, severity, workaround) VALUES (?, ?, ?, ?)`,
        [entry.filePath, entry.description, severity, entry.workaround || null]
      );
    }

    // Append to Layer 3 markdown file
    const mdResult = appendToLayer("gotcha", formatted);

    saveDb();
    rebuildFtsIndex();
    sessionMemory.recordToolCall("kuma_gotcha_add", {
      filePath: entry.filePath,
      severity,
    });

    // Auto-link to related arch_flow and decision nodes via causes edges
    let linkedCount = 0;
    try {
      const { addEdge } = await import("./kumaGraph.js");
      // Find arch_flow nodes that reference this file in their hops
      const stmt = db.prepare(`
        SELECT id FROM nodes WHERE type = 'arch_flow'
        AND (metadata LIKE ? OR file_path = ?)
        LIMIT 5
      `);
      stmt.bind([`%${entry.filePath}%`, entry.filePath]);
      while (stmt.step()) {
        const row = stmt.getAsObject() as { id: string };
        const gotchaNodeId = `gotcha::${entry.filePath}::${entry.description.substring(0, 30)}`;
        try { await addEdge({ sourceId: gotchaNodeId, targetId: row.id, type: "triggers" }); linkedCount++; } catch {}
      }
      stmt.free();
    } catch {}

    const action = existingId !== null ? "updated" : "recorded";
    return `✅ **Gotcha ${action}**: ${entry.filePath} — ${entry.description}${linkedCount > 0 ? ` (linked to ${linkedCount} flow(s))` : ""}\n${mdResult}`;
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

/**
 * Sync gotcha graph nodes from known_gotchas table (single source of truth).
 * Derives graph nodes + edges so visualization stays consistent.
 */
export async function syncGotchasGraph(): Promise<{ created: number }> {
  try {
    await ensureGotchasSchema();
    const { upsertNode, addEdge } = await import("./kumaGraph.js");
    const db = await getDb();
    let created = 0;

    const stmt = db.prepare(
      `SELECT file_path, description, severity, workaround FROM known_gotchas`
    );
    const rows: Array<{ file_path: string; description: string; severity: string; workaround: string | null }> = [];
    while (stmt.step()) rows.push(stmt.getAsObject() as any);
    stmt.free();

    for (const g of rows) {
      const fileNodeId = `file::${g.file_path}`;
      const gotchaNodeId = `gotcha::${g.file_path}::${g.description.substring(0, 30)}`;

      await upsertNode({ id: fileNodeId, type: "file", name: g.file_path });
      await upsertNode({
        id: gotchaNodeId,
        type: "gotcha",
        name: `gotcha:${g.description.substring(0, 40)}`,
        filePath: g.file_path,
        metadata: { severity: g.severity, workaround: g.workaround || undefined },
      });
      await addEdge({ sourceId: fileNodeId, targetId: gotchaNodeId, type: "depends_on" });
      created++;
    }

    return { created };
  } catch {
    return { created: 0 };
  }
}
