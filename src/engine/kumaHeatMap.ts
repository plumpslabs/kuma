// ============================================================
// KUMA HEATMAP — Activity Heat Map (Phase 5.4)
// ============================================================
// Shows which parts of the codebase AI works on most,
// aggregated from session memory tool calls.
// ============================================================

import { sessionMemory } from "./sessionMemory.js";
import { getDb } from "./kumaDb.js";
import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "../utils/pathValidator.js";

interface HeatMapEntry {
  dir: string;
  editCount: number;
  readCount: number;
  failureCount: number;
  totalActivity: number;
  score: number;        // 0-100 activity intensity
  files: number;        // Number of files in this directory
}

interface HeatMapReport {
  entries: HeatMapEntry[];
  totalEdits: number;
  totalReads: number;
  totalFailures: number;
  mostActiveDir: string;
  leastActiveDir: string;
}

/**
 * Compute the activity heat map from session data and SQLite graph.
 */
export async function computeHeatMap(): Promise<HeatMapReport> {
  const history = sessionMemory.getToolCallHistory(100);
  const db = await getDb();

  // Aggregate by directory
  const dirData = new Map<string, { edits: number; reads: number; failures: number }>();

  for (const call of history) {
    const p = call.params as Record<string, unknown>;
    const fp = p.filePath as string || p.file as string || "";
    if (!fp) continue;

    const dir = path.dirname(fp).split("/")[0] || ".";
    const entry = dirData.get(dir) || { edits: 0, reads: 0, failures: 0 };

    if (call.toolName === "precise_diff_editor" || call.toolName === "batch_file_writer") {
      entry.edits++;
      if (p.success === false) entry.failures++;
    }
    if (call.toolName === "smart_file_picker" || call.toolName === "read_files") {
      entry.reads++;
    }
    dirData.set(dir, entry);
  }

  // Also get file counts from SQLite graph
  const dirFileCounts = new Map<string, number>();
  try {
    const stmt = db.prepare(`
      SELECT file_path FROM nodes WHERE type IN ('file', 'function')
    `);
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      const fp = row.file_path as string;
      if (fp) {
        const dir = fp.split("/")[0] || ".";
        dirFileCounts.set(dir, (dirFileCounts.get(dir) || 0) + 1);
      }
    }
    stmt.free();
  } catch {}

  // Also count actual files on disk in src/
  const root = getProjectRoot();
  const srcDir = path.join(root, "src");
  if (fs.existsSync(srcDir)) {
    try {
      for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
        if (entry.isDirectory() && !entry.name.startsWith(".")) {
          const count = countFiles(path.join(srcDir, entry.name));
          if (!dirFileCounts.has(entry.name) || dirFileCounts.get(entry.name)! < count) {
            dirFileCounts.set(entry.name, count);
          }
        }
      }
    } catch {}
  }

  // Build entries with scores
  const entries: HeatMapEntry[] = [];
  let maxActivity = 0;

  for (const [dir, data] of dirData) {
    const activity = data.edits * 3 + data.reads + data.failures * 5;
    if (activity > maxActivity) maxActivity = activity;
    entries.push({
      dir,
      editCount: data.edits,
      readCount: data.reads,
      failureCount: data.failures,
      totalActivity: activity,
      score: 0, // will compute after we know max
      files: dirFileCounts.get(dir) || 1,
    });
  }

  // Compute scores (0-100)
  for (const e of entries) {
    e.score = maxActivity > 0 ? Math.round((e.totalActivity / maxActivity) * 100) : 0;
  }

  entries.sort((a, b) => b.totalActivity - a.totalActivity);

  const totalEdits = entries.reduce((s, e) => s + e.editCount, 0);
  const totalReads = entries.reduce((s, e) => s + e.readCount, 0);
  const totalFailures = entries.reduce((s, e) => s + e.failureCount, 0);

  return {
    entries,
    totalEdits,
    totalReads,
    totalFailures,
    mostActiveDir: entries[0]?.dir || "—",
    leastActiveDir: entries[entries.length - 1]?.dir || "—",
  };
}

/**
 * Get session-level activity stats (from SQLite sessions table).
 */
export async function getSessionActivity(): Promise<{
  totalSessions: number;
  avgEditsPerSession: number;
  totalAllEdits: number;
}> {
  try {
    const db = await getDb();
    const result = db.exec(`
      SELECT 
        COUNT(*) as totalSessions,
        COALESCE(AVG(edits), 0) as avgEdits,
        COALESCE(SUM(edits), 0) as totalEdits
      FROM sessions
    `);
    if (result[0]?.values[0]) {
      return {
        totalSessions: result[0].values[0][0] as number,
        avgEditsPerSession: Math.round((result[0].values[0][1] as number) * 10) / 10,
        totalAllEdits: result[0].values[0][2] as number,
      };
    }
  } catch {}
  return { totalSessions: 0, avgEditsPerSession: 0, totalAllEdits: 0 };
}

/**
 * Format heat map as human-readable output with visual bars.
 */
export function formatHeatMap(report: HeatMapReport): string {
  const lines: string[] = [
    `🔥 **Activity Heat Map**`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━`,
    "",
    `📊 Total: ✏️ ${report.totalEdits} edits | 📖 ${report.totalReads} reads | ❌ ${report.totalFailures} failures`,
    `🎯 Most active: \`${report.mostActiveDir}\` | Least active: \`${report.leastActiveDir}\``,
    "",
  ];

  if (report.entries.length === 0) {
    lines.push("No activity data yet. Start working with AI to populate the heat map.");
    return lines.join("\n");
  }

  lines.push("**Directory Activity:**");
  lines.push("");

  for (const e of report.entries) {
    const bar = "█".repeat(Math.round(e.score / 10)) + "░".repeat(Math.round(10 - e.score / 10));
    const heatEmoji = e.score >= 70 ? "🔴" : e.score >= 40 ? "🟡" : e.score >= 20 ? "🟠" : "🟢";
    const label = `${e.dir} (${e.files} files)`;

    lines.push(`  ${heatEmoji} **${label}**`);
    lines.push(`     ${bar} ${e.score}% intensity`);
    lines.push(`     ✏️ ${e.editCount} edits | 📖 ${e.readCount} reads | ❌ ${e.failureCount} failures`);
    lines.push("");
  }

  // Analysis
  if (report.totalFailures > 0) {
    const highFailDirs = report.entries.filter(e => e.failureCount > 2);
    if (highFailDirs.length > 0) {
      lines.push("**⚠️ High Failure Areas:**");
      for (const d of highFailDirs) {
        lines.push(`  • \`${d.dir}\` — ${d.failureCount} failures with ${d.editCount} edits (${Math.round(d.failureCount / d.editCount * 100)}% failure rate)`);
      }
      lines.push("");
    }
  }

  const lowActivity = report.entries.filter(e => e.score < 10);
  if (lowActivity.length > 0 && report.entries.length > 3) {
    lines.push("**💤 Low Activity Areas:**");
    for (const d of lowActivity.slice(0, 3)) {
      lines.push(`  • \`${d.dir}\` — only ${d.editCount} edits`);
    }
    lines.push("");
  }

  lines.push("💡 Use kuma_health() for code health scoring, or kuma_diagram({ type: 'architecture' }) for visual output.");

  return lines.join("\n");
}

/**
 * Count source files recursively in a directory.
 */
function countFiles(dir: string): number {
  let count = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        count += countFiles(full);
      } else if (/\.(ts|tsx|js|jsx|go|rs|py|java|kt)$/.test(entry.name)) {
        count++;
      }
    }
  } catch {}
  return count;
}
