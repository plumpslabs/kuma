// ============================================================
// KUMA GOTCHAS — Anti-Regression Shield (Issue #21)
// ============================================================
// Builds on top of Layer 3 (KNOWN_GOTCHAS.md) to provide
// pre-edit safety alerts when agents modify files with known
// legacy quirks. Integrates with kuma_safety check pipeline.
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { sessionMemory } from "./sessionMemory.js";
import { getDb, saveDb, rebuildFtsIndex } from "./kumaDb.js";
import { getProjectRoot } from "../utils/pathValidator.js";
import { getActiveGotchas, checkFileGotchas, appendToLayer } from "./domainRules.js";
import { hashFileContent } from "./kumaInject.js";

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
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      content_hash TEXT,
      trigger_command TEXT,
      status TEXT NOT NULL DEFAULT 'active'
        CHECK(status IN ('active','resolved')),
      last_verified_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_gotchas_file ON known_gotchas(file_path);
    CREATE INDEX IF NOT EXISTS idx_gotchas_severity ON known_gotchas(severity);
  `);

  // F3/F3b (Roadmap): migrations for legacy DBs missing the newer columns
  try {
    const info = db.exec("PRAGMA table_info(known_gotchas)");
    const cols = (info[0]?.values ?? []).map((v: unknown[]) => String(v[1]));
    if (!cols.includes("content_hash")) {
      db.run(`ALTER TABLE known_gotchas ADD COLUMN content_hash TEXT`);
    }
    if (!cols.includes("trigger_command")) {
      db.run(`ALTER TABLE known_gotchas ADD COLUMN trigger_command TEXT`);
    }
    if (!cols.includes("status")) {
      db.run(`ALTER TABLE known_gotchas ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`);
    }
    if (!cols.includes("last_verified_at")) {
      db.run(`ALTER TABLE known_gotchas ADD COLUMN last_verified_at INTEGER`);
    }
  } catch { /* non-critical */ }

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
  /** I2: optional command that triggers this gotcha (e.g. "npm run seed"). */
  triggerCommand?: string;
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

    // F3: hash the file content when the gotcha is recorded, so freshness can be verified later
    const contentHash = hashFileContent(entry.filePath);

    const formatted = [
      `### ${entry.filePath} — ${entry.description}`,
      `- **Issue**: ${entry.description}`,
      `- **Severity**: ${severity}`,
      entry.workaround ? `- **Workaround**: ${entry.workaround}` : "",
      entry.triggerCommand ? `- **Trigger**: when running \`${entry.triggerCommand}\`` : "",
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
      // Update existing gotcha — also refresh the hash (the file may have changed/fixed)
      db.run(
        `UPDATE known_gotchas SET severity = ?, workaround = ?, content_hash = ?, trigger_command = ?, status = 'active', updated_at = strftime('%s','now') WHERE id = ?`,
        [severity, entry.workaround || null, contentHash, entry.triggerCommand || null, existingId]
      );
    } else {
      // Insert new gotcha
      db.run(
        `INSERT INTO known_gotchas (file_path, description, severity, workaround, content_hash, trigger_command) VALUES (?, ?, ?, ?, ?, ?)`,
        [entry.filePath, entry.description, severity, entry.workaround || null, contentHash, entry.triggerCommand || null]
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
    sql += " AND status = 'active'";

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
      if (g.trigger_command) lines.push(`   ⌨️ when running: \`${(g.trigger_command as string).substring(0, 80)}\``);
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

// ============================================================
// I1 — GOTCHA LIFECYCLE (auto-resolve on verified fix)
// ============================================================

/**
 * I1: mark gotchas as RESOLVED when verification passes for a scope
 * AND the underlying file changed since the gotcha was recorded
 * (content_hash mismatch → the code was modified, likely fixed).
 * Returns the number of gotchas resolved.
 */
export async function resolveGotchasForScope(scope: string): Promise<{ resolved: number }> {
  try {
    await ensureGotchasSchema();
    const db = await getDb();
    const stmt = db.prepare(
      `SELECT id, file_path, content_hash FROM known_gotchas
       WHERE status = 'active' AND file_path LIKE ? AND content_hash IS NOT NULL`
    );
    stmt.bind([`%${scope}%`]);
    const rows: Array<{ id: number; file_path: string; content_hash: string | null }> = [];
    while (stmt.step()) rows.push(stmt.getAsObject() as any);
    stmt.free();

    let resolved = 0;
    for (const r of rows) {
      const current = hashFileContent(r.file_path);
      // File changed since recording AND still exists → fix likely landed
      if (current && current !== r.content_hash) {
        db.run(
          `UPDATE known_gotchas SET status = 'resolved', last_verified_at = strftime('%s','now') WHERE id = ?`,
          [r.id]
        );
        resolved++;
      }
    }
    if (resolved > 0) saveDb();
    return { resolved };
  } catch {
    return { resolved: 0 };
  }
}

// ============================================================
// I2 — COMMAND-TRIGGER GOTCHAS
// ============================================================

/**
 * I2: fetch active gotchas whose trigger_command matches a shell command
 * (e.g. running "npm run seed" → gotchas about the seed script).
 * Used by the Bash PreToolUse hook (`kuma hook pre-bash`).
 */
export async function getActiveGotchasForCommand(command: string): Promise<Array<{
  filePath: string;
  description: string;
  severity: string;
  workaround: string | null;
  triggerCommand: string;
}>> {
  try {
    await ensureGotchasSchema();
    const db = await getDb();
    const stmt = db.prepare(
      `SELECT file_path, description, severity, workaround, trigger_command
       FROM known_gotchas
       WHERE status = 'active' AND trigger_command IS NOT NULL AND length(trigger_command) > 0
       ORDER BY
         CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END
       LIMIT 30`
    );
    const rows: Array<Record<string, unknown>> = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();

    const cmd = command.toLowerCase();
    return rows
      .filter((r) => {
        const trigger = String(r.trigger_command || "").toLowerCase();
        // Substring match both ways: "pnpm run seed --x" hits "npm run seed",
        // and a bare "seed" trigger hits "npm run seed". No first-token guessing.
        return cmd.includes(trigger) || trigger.includes(cmd);
      })
      .map((r) => ({
        filePath: r.file_path as string,
        description: r.description as string,
        severity: r.severity as string,
        workaround: (r.workaround as string | null) ?? null,
        triggerCommand: r.trigger_command as string,
      }));
  } catch {
    return [];
  }
}

/**
 * I4: record a shadow-memory injection for metrics.
 * Appends to an append-only JSONL file (.kuma/injections.jsonl) instead of the
 * shared DB — the hook process must never do read-modify-write on kuma.db while
 * the MCP server holds it (lost-update race). Append + fsync is atomic enough.
 */
export async function recordInjection(params: {
  filePath?: string;
  command?: string;
  kind?: "edit" | "command";
}): Promise<void> {
  try {
    const fp = path.join(getProjectRoot(), ".kuma", "injections.jsonl");
    if (!fs.existsSync(path.dirname(fp))) fs.mkdirSync(path.dirname(fp), { recursive: true });
    const line = JSON.stringify({
      filePath: params.filePath || null,
      command: params.command || null,
      kind: params.kind || "edit",
      savedMs: 5000, // conservative estimate: avoided re-research / re-discovery
      at: Date.now(),
    });
    fs.appendFileSync(fp, line + "\n", "utf-8");
  } catch { /* non-critical */ }
}

/**
 * I4: aggregate injection metrics from the JSONL log within the last N hours.
 */
export function getInjectionStats(hours = 24): { count: number; savedMs: number } {
  try {
    const fp = path.join(getProjectRoot(), ".kuma", "injections.jsonl");
    if (!fs.existsSync(fp)) return { count: 0, savedMs: 0 };
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    const lines = fs.readFileSync(fp, "utf-8").split("\n");
    let count = 0;
    let savedMs = 0;
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if ((entry.at || 0) >= cutoff) {
          count++;
          savedMs += Number(entry.savedMs) || 0;
        }
      } catch { /* skip corrupt line */ }
    }
    return { count, savedMs };
  } catch {
    return { count: 0, savedMs: 0 };
  }
}
