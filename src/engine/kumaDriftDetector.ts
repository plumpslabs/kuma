// ============================================================
// KUMA DRIFT DETECTOR — Memory Staleness & Code Drift (Issue #20)
// ============================================================
// Detects when Kuma memory records become outdated relative to
// source code modifications. Uses file content hashing to compare
// current files against stored memory hashes.
//
// Features:
//   1. Hash target source files linked to memory records
//   2. Compare current file hashes against stored hashes
//   3. Auto-flag stale memory records with "stale: true" status
// ============================================================

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getDb, saveDb } from "./kumaDb.js";
import { getProjectRoot } from "../utils/pathValidator.js";

interface StaleRecord {
  id: number;
  source: string;       // e.g., "research_cache", "decision_log", "file_summaries"
  description: string;   // e.g., scope name, decision title, file path
  filePath: string | null;
  oldHash: string;
  currentHash: string;
  age: string;           // human-readable age
  severity: "fresh" | "warning" | "stale" | "missing";
}

// ============================================================
// HASHING
// ============================================================

/**
 * Compute a stable SHA-256 hash of a file's content.
 * Returns hex string, or null if file doesn't exist.
 */
export function hashFile(filePath: string): string | null {
  try {
    const root = getProjectRoot();
    const fullPath = path.resolve(root, filePath);
    if (!fs.existsSync(fullPath)) return null;
    const content = fs.readFileSync(fullPath, "utf-8");
    return crypto.createHash("sha256").update(content).digest("hex");
  } catch {
    return null;
  }
}

// ============================================================
// DRIFT DETECTION
// ============================================================

/**
 * Scan all knowledge sources for stale records relative to file changes.
 */
export async function detectDrift(): Promise<StaleRecord[]> {
  const records: StaleRecord[] = [];
  const now = Math.floor(Date.now() / 1000);

  try {
    const db = await getDb();

    // 1. Check research_cache against file content hashes
    const rcStmt = db.prepare(
      "SELECT id, scope, content_hash, updated_at FROM research_cache WHERE content_hash IS NOT NULL AND length(content_hash) > 0 LIMIT 100"
    );
    while (rcStmt.step()) {
      const row = rcStmt.getAsObject() as Record<string, unknown>;
      const scope = row.scope as string;
      const storedHash = row.content_hash as string;
      const updatedAt = row.updated_at as number;
      const age = Math.floor((now - updatedAt) / 86400); // days

      // For research cache, check if relevant files changed
      const currentHash = computeScopeHash(scope);
      const stale = currentHash && currentHash !== storedHash;

      records.push({
        id: row.id as number,
        source: "research_cache",
        description: scope,
        filePath: null,
        oldHash: storedHash,
        currentHash: currentHash || "",
        age: `${age}d`,
        severity: !currentHash ? "fresh"
          : stale ? "stale"
          : age > 30 ? "warning"
          : "fresh",
      });
    }
    rcStmt.free();

    // 2. Check file_summaries against actual file content
    const fsStmt = db.prepare(
      "SELECT id, file_path, content_hash FROM file_summaries WHERE content_hash IS NOT NULL AND length(content_hash) > 0 LIMIT 100"
    );
    while (fsStmt.step()) {
      const row = fsStmt.getAsObject() as Record<string, unknown>;
      const filePath = row.file_path as string;
      const storedHash = row.content_hash as string;
      const currentHash = hashFile(filePath);

      if (currentHash === null) {
        records.push({
          id: row.id as number,
          source: "file_summaries",
          description: filePath,
          filePath,
          oldHash: storedHash,
          currentHash: "",
          age: "—",
          severity: "missing",
        });
      } else if (currentHash !== storedHash) {
        records.push({
          id: row.id as number,
          source: "file_summaries",
          description: filePath,
          filePath,
          oldHash: storedHash,
          currentHash,
          age: "—",
          severity: "stale",
        });
      }
    }
    fsStmt.free();

    // 3. Check decision_log entries that reference files
    const dlStmt = db.prepare(
      "SELECT id, title, file_paths, created_at FROM decision_log WHERE file_paths IS NOT NULL ORDER BY created_at DESC LIMIT 50"
    );
    while (dlStmt.step()) {
      const row = dlStmt.getAsObject() as Record<string, unknown>;
      const filePaths: string[] = [];
      try { filePaths.push(...JSON.parse(row.file_paths as string)); } catch { /* skip */ }

      let hasStaleFile = false;
      for (const fp of filePaths) {
        if (!fp) continue;
        const fullPath = path.resolve(getProjectRoot(), fp);
        if (!fs.existsSync(fullPath)) {
          hasStaleFile = true;
          break;
        }
      }

      if (hasStaleFile) {
        records.push({
          id: row.id as number,
          source: "decision_log",
          description: row.title as string,
          filePath: filePaths[0] || null,
          oldHash: "",
          currentHash: "",
          age: "—",
          severity: "stale",
        });
      }
    }
    dlStmt.free();
  } catch (err) {
    console.error(`[DriftDetector] Error: ${err}`);
  }

  return records;
}

/**
 * Compute a hash for a research scope by hashing related files.
 */
function computeScopeHash(scope: string): string | null {
  try {
    const hash = crypto.createHash("sha256");
    const root = getProjectRoot();
    hash.update(scope);

    // Hash files matching the scope name
    let found = false;
    try {
      const files = fs.readdirSync(root);
      for (const file of files) {
        if (file.toLowerCase().includes(scope.toLowerCase())) {
          try {
            if (fs.statSync(path.join(root, file)).isFile()) {
              const content = fs.readFileSync(path.join(root, file), "utf-8");
              hash.update(file);
              hash.update(content.substring(0, 10000));
              found = true;
            }
          } catch { /* skip */ }
        }
      }
    } catch { /* skip */ }

    // Also hash the research cache scope file if it exists
    const researchDir = path.join(root, ".kuma", "research");
    if (fs.existsSync(researchDir)) {
      const scopeFile = path.join(researchDir, `${scope}.json`);
      if (fs.existsSync(scopeFile)) {
        const content = fs.readFileSync(scopeFile, "utf-8");
        hash.update(content);
        found = true;
      }
    }

    if (!found) return null;
    return hash.digest("hex").substring(0, 16);
  } catch {
    return null;
  }
}

// ============================================================
// AUTO-STALE FLAGGING
// ============================================================

/**
 * Mark stale records in the database with metadata flags.
 * Called during kuma_bootstrap().
 */
export async function flagStaleRecords(): Promise<{ flagged: number; total: number }> {
  const staleRecords = await detectDrift();
  let flagged = 0;

  try {
    const db = await getDb();

    for (const record of staleRecords) {
      if (record.severity !== "stale" && record.severity !== "missing") continue;

      if (record.source === "research_cache") {
        db.run(
          `UPDATE research_cache SET confidence = MAX(confidence * 0.5, 0.1) WHERE id = ?`,
          [record.id]
        );
        flagged++;
      } else if (record.source === "file_summaries") {
        db.run(
          `UPDATE file_summaries SET content_hash = '' WHERE id = ?`,
          [record.id]
        );
        flagged++;
      } else if (record.source === "decision_log") {
        db.run(
          `UPDATE decision_log SET status = 'deprecated' WHERE id = ?`,
          [record.id]
        );
        flagged++;
      }
    }

    saveDb();
  } catch (err) {
    console.error(`[DriftDetector] Flag error: ${err}`);
  }

  return { flagged, total: staleRecords.length };
}

// ============================================================
// FORMATTING
// ============================================================

/**
 * Format drift detection results as a human-readable string.
 */
export function formatDriftReport(records: StaleRecord[]): string {
  if (records.length === 0) {
    return "✅ **Drift Detection** — All memory records are fresh. No code drift detected.";
  }

  const fresh = records.filter(r => r.severity === "fresh").length;
  const warning = records.filter(r => r.severity === "warning").length;
  const stale = records.filter(r => r.severity === "stale").length;
  const missing = records.filter(r => r.severity === "missing").length;

  const lines: string[] = [
    "🔍 **Code Drift Detection Report**",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
    `📊 ${records.length} total records checked: ${fresh} fresh, ${warning} aging, ${stale} stale, ${missing} missing`,
    "",
  ];

  if (stale > 0 || missing > 0) {
    lines.push("**Stale/Missing Records:**");
    for (const r of records) {
      if (r.severity === "stale" || r.severity === "missing") {
        const icon = r.severity === "missing" ? "❌" : "⚠️";
        lines.push(`  ${icon} [${r.source}] ${r.description}`);
        if (r.filePath) lines.push(`     📍 ${r.filePath}`);
      }
    }
    lines.push("");
    lines.push("💡 Run kuma_memory({ action: 'heal' }) to repair stale graph entries.");
    lines.push("💡 Run kuma_context({ action: 'research', scope: '<stale-scope>' }) to refresh.");
  }

  return lines.join("\n");
}

/**
 * Get a formatted drift summary for inclusion in sync/digest output.
 */
export async function getDriftSummary(): Promise<string> {
  const records = await detectDrift();
  if (records.length === 0) return "✅ No code drift detected";

  const staleCount = records.filter(r => r.severity === "stale" || r.severity === "missing").length;
  if (staleCount === 0) return "✅ All records fresh";

  return `⚠️ ${staleCount} stale record(s) detected. Use kuma_memory({ action: 'heal' }) to repair.`;
}
