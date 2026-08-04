// ============================================================
// KUMA SELF-HEAL — Incremental heal & gotcha staleness
// ============================================================
// Survives from the original Self-Healing engine (Phase 3.4):
//   ✅ heal-on-query — auto-detect stale paths during graph queries
//   ✅ Gotcha staleness — verify gotchas still reference real code
//
// The full autoHeal/detectStaleNodes scan was removed in the
// gimmick cleanup — no production caller existed for it.
// ============================================================

import { getDb, saveDb } from "./kumaDb.js";
import { getProjectRoot } from "../utils/pathValidator.js";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// ============================================================
// GIT-AWARE RENAME DETECTION
// ============================================================

/**
 * Use git log --follow to find renamed files.
 * Falls back to basename search if git doesn't have rename info.
 */
function findRenamedPath(oldPath: string): string | null {
  const root = getProjectRoot();
  const basename = path.basename(oldPath);

  // Try git rename detection first
  try {
    const output = execSync(
      `git log --follow --diff-filter=R --name-only --format="" -1 -- "${oldPath}"`,
      { cwd: root, encoding: "utf-8", maxBuffer: 1024 * 1024, timeout: 5000 }
    ).trim();

    if (output) {
      const lines = output.split("\n").filter(Boolean);
      return lines[lines.length - 1] || null;
    }
  } catch {}

  // Fallback: find files with same basename in the project
  try {
    const result = execSync(
      `find . -name "${basename}" -type f -not -path "./node_modules/*" -not -path "./.git/*" -not -path "./dist/*" 2>/dev/null | head -5`,
      { cwd: root, encoding: "utf-8", maxBuffer: 1024 * 1024, timeout: 5000 }
    ).trim();

    if (result) {
      const candidates = result.split("\n").filter(Boolean);
      // Return the first candidate that's different from the old path
      for (const c of candidates) {
        const relative = c.startsWith("./") ? c.slice(2) : c;
        if (relative !== oldPath) return relative;
      }
    }
  } catch {}

  return null;
}

// ============================================================
// HEAL-ON-QUERY — Incremental subgraph-level repair
// ============================================================

/**
 * Lightweight check: given a set of file_paths being queried,
 * check if they're stale and heal if needed.
 * Called from kumaGraph query functions.
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
// GOTCHA STALENESS — Verify file/symbol references still exist
// ============================================================

/**
 * Verify that gotchas still reference valid files.
 * Returns list of stale gotchas with details.
 */
export async function verifyGotchaStaleness(): Promise<Array<{
  gotchaId: string;
  file_path: string;
  issue: "file_missing" | "symbol_missing";
}>> {
  const db = await getDb();
  const stale: Array<{ gotchaId: string; file_path: string; issue: "file_missing" | "symbol_missing" }> = [];

  try {
    const rows = db.exec(`
      SELECT id, metadata FROM nodes WHERE type = 'gotcha'
    `);
    if (rows.length === 0) return stale;

    const columns = rows[0].columns;
    const filePathIdx = columns.indexOf("metadata");

    for (const row of rows[0].values) {
      const nodeId = row[0] as string;
      let metadata: Record<string, unknown> = {};
      try { metadata = JSON.parse(row[filePathIdx] as string); } catch {}

      const filePath = metadata.file_path as string;
      if (!filePath || filePath.startsWith("search::") || filePath.startsWith("api_route::")) continue;

      const fullPath = path.join(getProjectRoot(), filePath);
      if (!fs.existsSync(fullPath)) {
        stale.push({ gotchaId: nodeId, file_path: filePath, issue: "file_missing" });
      } else {
        // File exists — check if referenced symbol exists (if description mentions a specific function/class)
        const desc = (metadata.description as string) || "";
        const symbolMatch = desc.match(/\b(function|class|method|const|let|var|export)\s+(\w+)/i);
        if (symbolMatch) {
          const symbolName = symbolMatch[2];
          try {
            const content = fs.readFileSync(fullPath, "utf-8");
            if (!content.includes(symbolName)) {
              stale.push({ gotchaId: nodeId, file_path: filePath, issue: "symbol_missing" });
            }
          } catch {}
        }
      }
    }
  } catch {}

  return stale;
}

/**
 * Format gotcha staleness report.
 */
export function formatGotchaStalenessReport(stale: Awaited<ReturnType<typeof verifyGotchaStaleness>>): string {
  if (stale.length === 0) {
    return "✅ **Gotcha Staleness Check** — All gotcha references are valid.";
  }

  const fileMissing = stale.filter(s => s.issue === "file_missing");
  const symbolMissing = stale.filter(s => s.issue === "symbol_missing");

  const lines: string[] = [
    `⚠️ **Gotcha Staleness Report**`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    "",
    `📊 ${stale.length} stale gotcha${stale.length > 1 ? "s" : ""} found`,
    fileMissing.length > 0 ? `  🗑️ ${fileMissing.length} reference${fileMissing.length > 1 ? "s" : ""} deleted file` : "",
    symbolMissing.length > 0 ? `  🔍 ${symbolMissing.length} reference${symbolMissing.length > 1 ? "s" : ""} missing symbol` : "",
    "",
  ];

  for (const s of fileMissing.slice(0, 5)) {
    lines.push(`  🗑️ \`${s.gotchaId}\` → file missing: \`${s.file_path}\``);
  }
  for (const s of symbolMissing.slice(0, 5)) {
    lines.push(`  🔍 \`${s.gotchaId}\` → symbol missing in \`${s.file_path}\``);
  }

  if (stale.length > 5) lines.push(`  ... and ${stale.length - 5} more`);

  lines.push("");
  lines.push("💡 Use `kuma_memory({ action: 'delete_node', target: '<gotchaId>' })` to remove obsolete gotchas.");

  return lines.join("\n");
}
