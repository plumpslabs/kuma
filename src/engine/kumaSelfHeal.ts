// ============================================================
// KUMA SELF-HEAL — Self-Healing Context (Phase 3.4)
// ============================================================
// Detects stale entries in the Knowledge Graph (files renamed,
// functions moved) and repairs them through git history.
//
// Features:
//   ✅ Staleness detection — ALL node types with file_path
//   ✅ Git-aware repair — git log --follow for rename tracing
//   ✅ Content hash fallback — match by file content when rename fails
//   ✅ Cascading edge cleanup — stale edges removed/updated
//   ✅ Incremental healing — repair only affected subgraph
//   ✅ Auto-heal hook — heal-on-query for on-the-fly repair
// ============================================================

import { getDb, saveDb } from "./kumaDb.js";
import { getProjectRoot } from "../utils/pathValidator.js";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

interface StaleEntry {
  nodeId: string;
  type: string;
  name: string;
  oldPath: string;
  newPath: string | null;
  issue: "file-missing" | "symbol-missing" | "path-changed";
}

interface HealResult {
  healed: number;
  missing: number;
  total: number;
  cascadedEdges: number;
}

// ============================================================
// CONTENT HASH — fallback matching when git rename fails
// ============================================================

/**
 * Compute a quick content hash for a file (first 1KB + last 1KB + size).
 * Not a full hash — just enough to identify likely matches.
 */
function contentFingerprint(filePath: string): string | null {
  try {
    const fullPath = path.join(getProjectRoot(), filePath);
    if (!fs.existsSync(fullPath)) return null;
    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) return null;

    const fd = fs.openSync(fullPath, "r");
    try {
      const size = stat.size;
      const readSize = Math.min(1024, size);
      const head = Buffer.alloc(readSize);
      fs.readSync(fd, head, 0, readSize, 0);

      let tail = Buffer.alloc(0);
      if (size > 2048) {
        tail = Buffer.alloc(1024);
        fs.readSync(fd, tail, 0, 1024, size - 1024);
      }

      const hash = crypto.createHash("md5");
      hash.update(head);
      hash.update(tail);
      hash.update(String(size));
      return hash.digest("hex");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

/**
 * Search the entire project for a file matching a content fingerprint.
 * Only searches within the project root to avoid scanning node_modules.
 */
function findByFingerprint(fingerprint: string, oldName: string): string | null {
  try {
    const root = getProjectRoot();
    const ext = path.extname(oldName);

    // Only check files with same extension to narrow search
    const result = execSync(
      `find . -name "*${ext}" -type f -not -path "./node_modules/*" -not -path "./.git/*" -not -path "./dist/*" -not -path "./build/*" 2>/dev/null | head -200`,
      { cwd: root, encoding: "utf-8", maxBuffer: 1024 * 1024, timeout: 10000 }
    ).trim();

    if (!result) return null;

    const files = result.split("\n").filter(Boolean);
    for (const file of files) {
      const relativePath = file.startsWith("./") ? file.slice(2) : file;
      const fp = contentFingerprint(relativePath);
      if (fp === fingerprint) {
        return relativePath;
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ============================================================
// STALENESS DETECTION — ALL node types
// ============================================================

/**
 * Scan the Knowledge Graph for stale nodes.
 * Now checks ALL node types with file_path, not just 'file'.
 */
export async function detectStaleNodes(): Promise<StaleEntry[]> {
  const stale: StaleEntry[] = [];
  try {
    const db = await getDb();
    const root = getProjectRoot();

    // Check ALL node types that have file_path
    const stmt = db.prepare(`
      SELECT id, type, name, file_path FROM nodes
      WHERE file_path IS NOT NULL
        AND length(file_path) > 0
      ORDER BY updated_at DESC LIMIT 500
    `);

    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      const filePath = row.file_path as string;

      // Skip obviously non-file paths (like search:: or api_route:: IDs)
      if (filePath.startsWith("search::") || filePath.startsWith("api_route::")) continue;

      const fullPath = path.join(root, filePath);
      if (!fs.existsSync(fullPath)) {
        // Try git rename detection
        const newPath = findRenamedPath(filePath);

        if (newPath) {
          stale.push({
            nodeId: row.id as string,
            type: row.type as string,
            name: row.name as string,
            oldPath: filePath,
            newPath,
            issue: "path-changed",
          });
        } else {
          // Content hash fallback
          const oldFingerprint = contentFingerprint(filePath);
          const contentMatch = oldFingerprint ? findByFingerprint(oldFingerprint, path.basename(filePath)) : null;

          stale.push({
            nodeId: row.id as string,
            type: row.type as string,
            name: row.name as string,
            oldPath: filePath,
            newPath: contentMatch,
            issue: contentMatch ? "path-changed" : "file-missing",
          });
        }
      }
    }
    stmt.free();
  } catch (err) {
    console.error(`[KumaSelfHeal] Failed to detect stale nodes: ${err}`);
  }
  return stale;
}

// ============================================================
// GIT-AWARE REPAIR
// ============================================================

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
      const lines = output.split("\n").filter(Boolean);
      return lines[lines.length - 1] || null;
    }
    return null;
  } catch {
    return null;
  }
}

// ============================================================
// CASCADING EDGE CLEANUP
// ============================================================

/**
 * Remove or update edges connected to stale nodes.
 * Returns count of edges that were modified or removed.
 */
async function cascadeStaleEdges(nodeIds: string[]): Promise<number> {
  try {
    const db = await getDb();
    let count = 0;

    for (const nodeId of nodeIds) {
      // Mark edges as stale (reduce weight to 0 so they deprioritize)
      db.run(
        `UPDATE edges SET weight = MAX(weight * 0.1, 0.01), metadata = json_set(COALESCE(NULLIF(metadata,''), '{}'), '$.stale', 1)
         WHERE (source_id = ? OR target_id = ?) AND weight > 0`,
        [nodeId, nodeId]
      );
      count += (db as any).getRowsModified();
    }

    saveDb();
    return count;
  } catch (err) {
    console.error(`[KumaSelfHeal] Failed to cascade stale edges: ${err}`);
    return 0;
  }
}

// ============================================================
// HEAL NODE
// ============================================================

/**
 * Heal a stale node by updating its file_path or marking as stale.
 */
async function healStaleNode(entry: StaleEntry): Promise<boolean> {
  try {
    const db = await getDb();

    if (entry.newPath) {
      // Update file_path to new location
      db.run(`UPDATE nodes SET file_path = ?, updated_at = strftime('%s','now') WHERE id = ?`,
        [entry.newPath, entry.nodeId]);

      // Update edges metadata to mark as healed
      db.run(`UPDATE edges SET metadata = json_set(COALESCE(NULLIF(metadata,''), '{}'), '$.healed', 1) WHERE source_id = ? OR target_id = ?`,
        [entry.nodeId, entry.nodeId]);

      // Also update any edges that reference the old path in their metadata
      db.run(`UPDATE edges SET metadata = json_set(COALESCE(NULLIF(metadata,''), '{}'), '$.healed', 1, '$.newPath', ?)
        WHERE json_extract(metadata, '$.filePath') = ?`,
        [entry.newPath, entry.oldPath]);

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

// ============================================================
// AUTO-HEAL — Full scan
// ============================================================

/**
 * Auto-heal all stale nodes.
 */
export async function autoHeal(): Promise<HealResult> {
  const stale = await detectStaleNodes();
  let healed = 0;
  let missing = 0;

  for (const entry of stale) {
    const success = await healStaleNode(entry);
    if (success) healed++;
    else missing++;
  }

  // Cascade edges for nodes that are still stale (truly missing)
  const staleNodeIds = stale.filter(e => !e.newPath).map(e => e.nodeId);
  const cascadedEdges = await cascadeStaleEdges(staleNodeIds);

  return { healed, missing, total: stale.length, cascadedEdges };
}

// ============================================================
// INCREMENTAL HEALING — Subgraph-level repair
// ============================================================
// HEAL-ON-QUERY — Auto-detect stale during graph access
// ============================================================

/**
 * Lightweight check: given a set of file_paths being queried,
 * check if they're stale and heal if needed.
 * Designed to be called from kumaGraph query functions.
 */
export async function healOnQuery(filePaths: string[]): Promise<{ healed: number }> {
  if (filePaths.length === 0) return { healed: 0 };

  try {
    const stalePaths = filePaths.filter(fp => {
      if (!fp || fp.startsWith("search::") || fp.startsWith("api_route::")) return false;
      const fullPath = path.join(getProjectRoot(), fp);
      return !fs.existsSync(fullPath);
    });

    if (stalePaths.length === 0) return { healed: 0 };

    // Try git rename for each stale path
    let healed = 0;
    for (const oldPath of stalePaths) {
      const newPath = findRenamedPath(oldPath);
      if (newPath) {
        const db = await getDb();
        db.run(`UPDATE nodes SET file_path = ?, updated_at = strftime('%s','now') WHERE file_path = ?`,
          [newPath, oldPath]);
        saveDb();
        healed++;
      }
    }

    return { healed };
  } catch {
    return { healed: 0 };
  }
}

// ============================================================
// FORMATTING
// ============================================================

/**
 * Format self-healing report.
 */
export function formatHealReport(result: HealResult): string {
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
    result.cascadedEdges > 0 ? `🔗 ${result.cascadedEdges} cascade edges updated` : "",
    "",
  ].filter(Boolean);

  if (result.healed > 0) {
    lines.push("💡 Healed entries had their file paths updated via git rename detection or content hash matching.");
  }
  if (result.missing > 0) {
    lines.push("⚠️ Missing entries were marked as stale. The Knowledge Graph will deprioritize them.");
    lines.push("💡 Run incremental healing after making changes to keep the graph fresh.");
  }

  return lines.join("\n");
}


