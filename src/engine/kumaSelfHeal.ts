// ============================================================
// KUMA SELF-HEAL — Self-Healing Context (Phase 3.4)
// ============================================================
// Detects stale entries in the Knowledge Graph (files renamed,
// functions moved) and repairs them through git history.
// ============================================================

import { getDb, saveDb } from "./kumaDb.js";
import { getProjectRoot } from "../utils/pathValidator.js";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

interface StaleEntry {
  nodeId: string;
  type: string;
  name: string;
  oldPath: string;
  newPath: string | null;
  issue: "file-missing" | "symbol-missing" | "path-changed";
}

/**
 * Scan the Knowledge Graph for stale nodes (files that no longer exist).
 */
export async function detectStaleNodes(): Promise<StaleEntry[]> {
  const stale: StaleEntry[] = [];
  try {
    const db = await getDb();
    const root = getProjectRoot();

    const stmt = db.prepare(`
      SELECT id, type, name, file_path FROM nodes
      WHERE type = 'file' AND file_path IS NOT NULL
      ORDER BY updated_at DESC LIMIT 200
    `);

    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      const filePath = row.file_path as string;
      const fullPath = path.join(root, filePath);

      if (!fs.existsSync(fullPath)) {
        // Try to find via git history
        const newPath = findRenamedPath(filePath);
        stale.push({
          nodeId: row.id as string,
          type: row.type as string,
          name: row.name as string,
          oldPath: filePath,
          newPath,
          issue: newPath ? "path-changed" : "file-missing",
        });
      }
    }
    stmt.free();
  } catch (err) {
    console.error(`[KumaSelfHeal] Failed to detect stale nodes: ${err}`);
  }
  return stale;
}

/**
 * Use git log --follow to find renamed files.
 */
function findRenamedPath(oldPath: string): string | null {
  try {
    const root = getProjectRoot();
    const output = execSync(
      `git log --follow --diff-filter=R --name-only --format="" -1 -- "${oldPath}"`,
      { cwd: root, encoding: "utf-8", maxBuffer: 1024 * 1024, timeout: 5000 }
    ).trim();

    if (output) {
      // Output contains the new path(s) found via rename detection
      const lines = output.split("\n").filter(Boolean);
      return lines[lines.length - 1] || null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Heal a stale node by updating its file_path or marking it.
 */
export async function healStaleNode(entry: StaleEntry): Promise<boolean> {
  try {
    const db = await getDb();

    if (entry.newPath) {
      // Update file_path to new location
      db.run(`UPDATE nodes SET file_path = ?, updated_at = strftime('%s','now') WHERE id = ?`,
        [entry.newPath, entry.nodeId]);

      // Also update edges metadata
      db.run(`UPDATE edges SET metadata = json_set(metadata, '$.healed', 1) WHERE source_id = ? OR target_id = ?`,
        [entry.nodeId, entry.nodeId]);

      saveDb();
      return true;
    }

    // File truly missing — mark as stale
    db.run(`UPDATE nodes SET metadata = json_set(COALESCE(NULLIF(metadata,''), '{}'), '$.stale', 1) WHERE id = ?`,
      [entry.nodeId]);
    saveDb();
    return false;
  } catch (err) {
    console.error(`[KumaSelfHeal] Failed to heal node ${entry.nodeId}: ${err}`);
    return false;
  }
}

/**
 * Auto-heal all stale nodes.
 */
export async function autoHeal(): Promise<{ healed: number; missing: number; total: number }> {
  const stale = await detectStaleNodes();
  let healed = 0;
  let missing = 0;

  for (const entry of stale) {
    const success = await healStaleNode(entry);
    if (success) healed++;
    else missing++;
  }

  return { healed, missing, total: stale.length };
}

/**
 * Format self-healing report.
 */
export function formatHealReport(result: { healed: number; missing: number; total: number }): string {
  if (result.total === 0) {
    return "✅ **Self-Heal Check** — No stale entries found. Knowledge Graph is fresh.";
  }

  const lines: string[] = [
    `🩺 **Self-Heal Report**`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━`,
    "",
    `📊 ${result.total} stale entr${result.total > 1 ? "ies" : "y"} found`,
    `✅ ${result.healed} healed (file renamed → path updated)`,
    `❌ ${result.missing} missing (file deleted — marked as stale)`,
    "",
  ];

  if (result.healed > 0) {
    lines.push("💡 Healed entries had their file paths updated via git rename detection.");
  }
  if (result.missing > 0) {
    lines.push("⚠️ Missing entries were marked as stale. The Knowledge Graph will deprioritize them.");
  }

  return lines.join("\n");
}
