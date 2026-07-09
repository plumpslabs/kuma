// ============================================================
// KUMA EXPERIENCE — Tool call Experience Graph
// ============================================================
// Records every tool call outcome (success/failure/duration),
// learns sequential patterns, and predicts next-best actions.
// Stored in SQLite alongside the Knowledge Graph.
//
// Key concepts:
//   - experience: single tool call with outcome + context
//   - pattern: antecedent tool → consequent tool sequence learned from history
//   - suggestion: next action recommendation based on current context
// ============================================================

import crypto from "node:crypto";
import { getDb, saveDb } from "./kumaDb.js";

interface ExperienceRecord {
  toolName: string;
  params: Record<string, unknown>;
  success: boolean;
  durationMs: number;
  errorPattern?: string;
  contextFile?: string;
  contextAction?: string;
}

interface PatternSuggestion {
  consequentTool: string;
  confidence: number;
  count: number;
  successRate: number;
  avgDurationMs: number;
}

interface ToolStats {
  totalCalls: number;
  successCount: number;
  failCount: number;
  successRate: number;
  avgDurationMs: number;
  lastCalledAt: number | null;
}

/**
 * Hash tool params to a stable string for pattern matching.
 * Normalizes key order so semantically identical calls match.
 */
function hashParams(params: Record<string, unknown>): string {
  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(params).sort()) {
    const val = params[key];
    // Normalize: convert arrays/objects to JSON, trim strings
    if (typeof val === "string") normalized[key] = val.trim().substring(0, 100);
    else if (Array.isArray(val)) normalized[key] = val.length;
    else if (typeof val === "object" && val !== null) normalized[key] = JSON.stringify(val).substring(0, 100);
    else normalized[key] = val;
  }
  const str = JSON.stringify(normalized);
  return crypto.createHash("sha256").update(str).digest("hex").substring(0, 16);
}

/**
 * Extract contextual info from tool params for better pattern matching.
 */
function extractContext(toolName: string, params: Record<string, unknown>): { file?: string; action?: string } {
  if (params.filePath && typeof params.filePath === "string") {
    const filePath = params.filePath;
    const action = toolName === "precise_diff_editor" ? "edit" :
      toolName === "smart_grep" ? "search" :
      toolName === "lsp_query" ? params.action as string || "query" :
      "use";
    return { file: filePath, action };
  }
  if (params.files && Array.isArray(params.files) && params.files.length > 0) {
    return { file: String(params.files[0]), action: "batch-create" };
  }
  if (params.query && typeof params.query === "string") {
    return { file: params.query.substring(0, 60), action: "search" };
  }
  return {};
}

/**
 * Record a tool call experience — outcome, duration, context.
 * Automatically learns sequential patterns.
 */
export async function recordExperience(exp: ExperienceRecord): Promise<void> {
  try {
    const db = await getDb();
    const pHash = hashParams(exp.params);
    const context = extractContext(exp.toolName, exp.params);
    const errorPattern = exp.errorPattern
      ? exp.errorPattern.replace(/["'].*?["']/g, "\"…\"").substring(0, 200)
      : null;

    // 1. Insert experience record
    db.run(`
      INSERT INTO experiences (tool_name, params_hash, success, duration_ms, error_pattern, context_file, context_action, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%s','now'))
    `, [
      exp.toolName, pHash, exp.success ? 1 : 0, exp.durationMs,
      errorPattern, context.file || null, context.action || null,
    ]);

    // 2. Learn pattern from previous experience
    // Find the most recent experience (excluding current) and create/update pattern
    const prevStmt = db.prepare(`
      SELECT tool_name, params_hash FROM experiences
      WHERE id < last_insert_rowid()
      ORDER BY id DESC LIMIT 1
    `);
    if (prevStmt.step()) {
      const prev = prevStmt.getAsObject() as Record<string, unknown>;
      prevStmt.free();

      const antecedentTool = prev.tool_name as string;
      const antecedentHash = prev.params_hash as string;

      // Upsert pattern: antecedent + hash → current tool
      db.run(`
        INSERT INTO experience_patterns (antecedent_tool, antecedent_hash, consequent_tool, confidence, count, avg_duration_ms, success_rate, last_seen_at)
        VALUES (?, ?, ?, 0.5, 1, ?, ?)
        ON CONFLICT(antecedent_tool, antecedent_hash, consequent_tool) DO UPDATE SET
          count = count + 1,
          avg_duration_ms = (avg_duration_ms * (count - 1) + ?) / count,
          success_rate = (success_rate * (count - 1) + ?) / count,
          confidence = MIN(0.95, (count + 1.0) / (count + 10.0)),
          last_seen_at = strftime('%s','now')
      `, [
        antecedentTool, antecedentHash, exp.toolName,
        exp.durationMs, exp.success ? 1.0 : 0.0,
        exp.durationMs, exp.success ? 1.0 : 0.0,
      ]);
    } else {
      prevStmt.free();
    }

    saveDb(db);
  } catch (err) {
    console.error(`[KumaExperience] Failed to record experience: ${err}`);
  }
}

/**
 * Get suggestions for the next tool call based on the last tool call context.
 * Returns ranked suggestions with confidence scores.
 */
export async function getExperienceSuggestions(context: {
  lastToolName: string;
  lastParams: Record<string, unknown>;
  currentFile?: string;
}): Promise<PatternSuggestion[]> {
  try {
    const db = await getDb();
    const lastHash = hashParams(context.lastParams);
    const recentTime = Math.floor(Date.now() / 1000) - 86400; // last 24h

    // Get patterns matching antecedent + hash, filtered by recency
    const stmt = db.prepare(`
      SELECT consequent_tool, confidence, count, success_rate, avg_duration_ms
      FROM experience_patterns
      WHERE antecedent_tool = ? AND antecedent_hash = ?
        AND last_seen_at > ?
      ORDER BY confidence DESC, count DESC
      LIMIT 5
    `);
    stmt.bind([context.lastToolName, lastHash, recentTime]);

    const results: PatternSuggestion[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      results.push({
        consequentTool: row.consequent_tool as string,
        confidence: +(row.confidence as number).toFixed(3),
        count: row.count as number,
        successRate: +(row.success_rate as number).toFixed(3),
        avgDurationMs: Math.round(row.avg_duration_ms as number),
      });
    }
    stmt.free();

    // If no specific hash match, try broader tool-level patterns
    if (results.length === 0) {
      const broadStmt = db.prepare(`
        SELECT consequent_tool, SUM(count) as total_count,
          AVG(success_rate) as avg_success, AVG(avg_duration_ms) as avg_dur
        FROM experience_patterns
        WHERE antecedent_tool = ?
        GROUP BY consequent_tool
        ORDER BY total_count DESC
        LIMIT 5
      `);
      broadStmt.bind([context.lastToolName]);
      while (broadStmt.step()) {
        const row = broadStmt.getAsObject() as Record<string, unknown>;
        const totalCount = row.total_count as number;
        results.push({
          consequentTool: row.consequent_tool as string,
          confidence: Math.min(0.7, (totalCount + 1) / (totalCount + 10)),
          count: totalCount,
          successRate: +(row.avg_success as number).toFixed(3),
          avgDurationMs: Math.round(row.avg_dur as number),
        });
      }
      broadStmt.free();
    }

    return results;
  } catch (err) {
    console.error(`[KumaExperience] Failed to get suggestions: ${err}`);
    return [];
  }
}

/**
 * Get success rate statistics for a specific tool.
 */
export async function getToolStats(toolName?: string): Promise<ToolStats | Record<string, ToolStats>> {
  try {
    const db = await getDb();

    if (toolName) {
      const stmt = db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes,
          SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failures,
          AVG(duration_ms) as avg_dur,
          MAX(created_at) as last_seen
        FROM experiences
        WHERE tool_name = ?
      `);
      stmt.bind([toolName]);
      let stats: ToolStats = {
        totalCalls: 0, successCount: 0, failCount: 0,
        successRate: 0, avgDurationMs: 0, lastCalledAt: null,
      };
      if (stmt.step()) {
        const row = stmt.getAsObject() as Record<string, unknown>;
        const total = (row.total as number) || 0;
        const successes = (row.successes as number) || 0;
        stats = {
          totalCalls: total,
          successCount: successes,
          failCount: (row.failures as number) || 0,
          successRate: total > 0 ? +(successes / total).toFixed(3) : 0,
          avgDurationMs: Math.round((row.avg_dur as number) || 0),
          lastCalledAt: (row.last_seen as number) || null,
        };
      }
      stmt.free();
      return stats;
    }

    // All tools
    const stmt = db.prepare(`
      SELECT tool_name,
        COUNT(*) as total,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes,
        AVG(duration_ms) as avg_dur
      FROM experiences
      GROUP BY tool_name
      ORDER BY total DESC
    `);
    const results: Record<string, ToolStats> = {};
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      const total = (row.total as number) || 0;
      const successes = (row.successes as number) || 0;
      results[row.tool_name as string] = {
        totalCalls: total,
        successCount: successes,
        failCount: total - successes,
        successRate: total > 0 ? +(successes / total).toFixed(3) : 0,
        avgDurationMs: Math.round((row.avg_dur as number) || 0),
        lastCalledAt: null,
      };
    }
    stmt.free();
    return results;
  } catch (err) {
    console.error(`[KumaExperience] Failed to get tool stats: ${err}`);
    return {};
  }
}

/**
 * Get common error patterns for a tool.
 */
export async function getErrorPatterns(toolName: string, limit: number = 5): Promise<string[]> {
  try {
    const db = await getDb();
    const stmt = db.prepare(`
      SELECT error_pattern, COUNT(*) as cnt
      FROM experiences
      WHERE tool_name = ? AND success = 0 AND error_pattern IS NOT NULL
      GROUP BY error_pattern
      ORDER BY cnt DESC
      LIMIT ?
    `);
    stmt.bind([toolName, limit]);
    const patterns: string[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      patterns.push(`${row.error_pattern} (${row.cnt}x)`);
    }
    stmt.free();
    return patterns;
  } catch {
    return [];
  }
}

/**
 * Get a human-readable experience report.
 */
export async function formatExperienceReport(
  toolName?: string,
  suggestions?: PatternSuggestion[]
): Promise<string> {
  try {
    const stats = await getToolStats(toolName);

    const lines: string[] = [
      `📊 **Experience Graph Report**${toolName ? ` — ${toolName}` : ""}`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━`,
      "",
    ];

    if (toolName && !Array.isArray(stats)) {
      const s = stats as ToolStats;
      lines.push(
        `📞 **${s.totalCalls} calls** | ✅ ${s.successCount} success | ❌ ${s.failCount} fail`,
        `📈 **Success rate:** ${(s.successRate * 100).toFixed(1)}%`,
        `⏱️ **Avg duration:** ${s.avgDurationMs}ms`,
        s.lastCalledAt ? `🕐 **Last called:** ${new Date(s.lastCalledAt * 1000).toISOString()}` : "",
        "",
      );

      const errors = await getErrorPatterns(toolName);
      if (errors.length > 0) {
        lines.push("**Common errors:**");
        for (const e of errors) lines.push(`  ❌ ${e}`);
        lines.push("");
      }

      if (suggestions && suggestions.length > 0) {
        lines.push("**Suggested next actions:**");
        for (const sug of suggestions) {
          lines.push(
            `  → **${sug.consequentTool}** (confidence: ${(sug.confidence * 100).toFixed(0)}%, ` +
            `success: ${(sug.successRate * 100).toFixed(0)}%, avg: ${sug.avgDurationMs}ms, seen: ${sug.count}x)`
          );
        }
        lines.push("");
      }
    } else {
      const allStats = stats as Record<string, ToolStats>;
      const entries = Object.entries(allStats);
      if (entries.length === 0) {
        lines.push("No experience data recorded yet. Use tools to build the experience graph.");
      } else {
        lines.push(`**${entries.length} tools tracked**`);
        lines.push("");
        for (const [name, s] of entries) {
          const bar = "█".repeat(Math.round(s.successRate * 10)) + "░".repeat(Math.round((1 - s.successRate) * 10));
          lines.push(`  **${name}** — ${bar} ${(s.successRate * 100).toFixed(0)}% (${s.totalCalls} calls, ${s.avgDurationMs}ms avg)`);
        }
        lines.push("");
      }

      if (suggestions && suggestions.length > 0) {
        lines.push("**Global suggestions** (based on last tool call):");
        for (const sug of suggestions) {
          lines.push(`  → **${sug.consequentTool}** (confidence: ${(sug.confidence * 100).toFixed(0)}%)`);
        }
      }
    }

    lines.push(
      "💡 Experience Graph learns from every tool call. Patterns improve with usage.",
      "💡 Use kuma_experience_query({ toolName: '...' }) for tool-specific stats.",
    );

    return lines.join("\n");
  } catch (err) {
    return `Error formatting experience report: ${err}`;
  }
}

/**
 * Prune old experiences (keep only recent N records per tool).
 */
export async function pruneExperiences(keepPerTool: number = 50): Promise<void> {
  try {
    const db = await getDb();

    // Delete old experiences beyond keepPerTool per tool
    db.run(`
      DELETE FROM experiences WHERE id IN (
        SELECT e.id FROM experiences e
        WHERE e.id NOT IN (
          SELECT id FROM experiences e2
          WHERE e2.tool_name = e.tool_name
          ORDER BY e2.created_at DESC
          LIMIT ?
        )
      )
    `, [keepPerTool]);

    // Prune patterns older than 30 days with low count
    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 86400;
    db.run(`DELETE FROM experience_patterns WHERE last_seen_at < ? AND count < 3`, [thirtyDaysAgo]);

    saveDb();
  } catch (err) {
    console.error(`[KumaExperience] Failed to prune experiences: ${err}`);
  }
}
