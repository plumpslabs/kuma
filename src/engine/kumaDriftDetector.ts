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
import { execSync } from "node:child_process";
import { getDb, saveDb } from "./kumaDb.js";
import { getProjectRoot } from "../utils/pathValidator.js";

interface StaleRecord {
  id: number;
  source: string;       // e.g., "research_cache", "file_summaries"
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
  } catch (err) {
    console.error(`[DriftDetector] Error: ${err}`);
  }

  return records;
}

/**
 * Compute a stable hash for a research scope or project state by inspecting
 * git status, git HEAD, and key subdirectories (src, lib, backend, packages, etc.).
 */
export function computeScopeHash(scope: string): string | null {
  try {
    const root = getProjectRoot();
    let gitHead = "";
    let gitStatus = "";
    try {
      gitHead = execSync("git rev-parse HEAD", {
        cwd: root,
        encoding: "utf-8",
        timeout: 1500,
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      gitStatus = execSync("git status --porcelain", {
        cwd: root,
        encoding: "utf-8",
        timeout: 2000,
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
    } catch {
      // Not a git repository or git command timed out
    }

    const hash = crypto.createHash("sha256");
    hash.update(scope);
    let found = false;

    if (gitHead || gitStatus) {
      hash.update(gitHead);
      hash.update(gitStatus);
      found = true;
    } else {
      // Fallback: search root and common code subdirectories
      const checkDirs = [
        root,
        path.join(root, "src"),
        path.join(root, "lib"),
        path.join(root, "backend"),
        path.join(root, "packages"),
        path.join(root, "app"),
      ];
      for (const dir of checkDirs) {
        if (fs.existsSync(dir)) {
          try {
            const files = fs.readdirSync(dir).slice(0, 30);
            for (const f of files) {
              try {
                const fullPath = path.join(dir, f);
                const stat = fs.statSync(fullPath);
                if (stat.isFile()) {
                  hash.update(`${f}:${stat.mtimeMs}`);
                  found = true;
                }
              } catch {}
            }
          } catch {}
        }
      }
    }

    // Also hash the research cache scope file if it exists
    const researchDir = path.join(root, ".kuma", "research");
    if (fs.existsSync(researchDir)) {
      const scopeFile = path.join(researchDir, `${scope}.json`);
      if (fs.existsSync(scopeFile)) {
        try {
          const content = fs.readFileSync(scopeFile, "utf-8");
          hash.update(content);
          found = true;
        } catch {}
      }
    }

    if (!found) return null;
    return hash.digest("hex").substring(0, 16);
  } catch {
    return null;
  }
}

export const computeProjectHash = (scope: string): string => computeScopeHash(scope) || Date.now().toString(16);

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

// ============================================================
// ACTIONABLE DRIFT REPORT — Issue #44 (live work-queue, not wallpaper)
// ============================================================
// Counts are noise without items. Each tick writes a bounded report so
// an agent can open ONE file, see every stale item with reason +
// suggested action, act, and watch the count decrease next tick
// (the report is recomputed — resolved items drop off by construction).

export const DRIFT_REPORT_FILE = ".kuma/drift.json";
export const DRIFT_REPORT_MAX_ITEMS = 20;

export interface DriftActionItem {
  id: string;
  kind: string;
  target: string;
  reason: string;
  action: string;
}

/** Map one stale record to an actionable item (exported for tests). */
export function toDriftActionItem(r: StaleRecord): DriftActionItem {
  const stale = r.severity === "stale";
  const missing = r.severity === "missing";
  const action =
    r.source === "research_cache"
      ? `re-run kuma_context({ action: 'research', scope: '${r.description}' })`
      : r.filePath
        ? `rescan '${r.filePath}' (touch via any context call) or run heal`
        : `run kuma_memory({ action: 'heal' }) to repair`;
  return {
    id: `${r.source}#${r.id}`,
    kind: r.source,
    target: r.filePath || r.description,
    reason: missing
      ? "source gone (file/record missing)"
      : `content hash mismatch vs current (age ${r.age})`,
    action: stale || missing ? action : "monitor",
  };
}

/** Recompute + persist the report. Returns item count. */
export async function writeDriftReport(maxItems = DRIFT_REPORT_MAX_ITEMS): Promise<{ items: number; path: string }> {
  const fp = path.join(getProjectRoot(), DRIFT_REPORT_FILE);
  const records = await detectDrift();
  const actionable = records.filter((r) => r.severity === "stale" || r.severity === "missing");
  const items = actionable.slice(0, maxItems).map(toDriftActionItem);
  try {
    fs.writeFileSync(
      fp,
      JSON.stringify({ generatedAt: new Date().toISOString(), count: actionable.length, items }, null, 2),
      "utf-8",
    );
  } catch { /* non-critical */ }
  return { items: items.length, path: fp };
}

/** Read the last persisted report (for agents that want items, not counts). */
export function readDriftReport(): { generatedAt: string; count: number; items: DriftActionItem[] } | null {
  try {
    const fp = path.join(getProjectRoot(), DRIFT_REPORT_FILE);
    if (!fs.existsSync(fp)) return null;
    return JSON.parse(fs.readFileSync(fp, "utf-8"));
  } catch {
    return null;
  }
}
