// ============================================================
// KUMA CONTEXT ENGINE — Context Engine (Phase 3.3)
// ============================================================
// Maps AI intents/goals to relevant codebase context.
// Uses Knowledge Graph for distance-based relevance,
// session memory for recency, and failure history for risk.
// ============================================================

import { execSync } from "node:child_process";
import { getDb } from "./kumaDb.js";
import { sessionMemory } from "./sessionMemory.js";
import { scoreMemoryRelevance } from "./kumaMemory.js";

interface ContextItem {
  type: "file" | "symbol" | "memory" | "failure" | "graph";
  label: string;
  detail: string;
  priority: number; // 0-100
}

/**
 * Stop words that add no semantic value to context matching.
 */
const STOP_WORDS = new Set([
  "the", "this", "that", "with", "from", "what", "which",
  "fix", "bug", "bikin", "buat", "add", "new", "need",
  "make", "want", "can", "get", "set", "use", "using",
  "would", "could", "should", "have", "has", "had",
  "for", "and", "not", "but", "are", "was", "were",
  "all", "any", "each", "every", "some", "find", "show",
  "list", "create", "update", "delete", "remove", "change",
]);

/**
 * Extract meaningful terms from a goal string.
 * Filters stop words, deduplicates, and limits length.
 */
function extractTerms(goal: string): string[] {
  const words = goal.toLowerCase().split(/[\s_\/-]+/).filter(w => w.length > 2);
  const filtered = words.filter(w => !STOP_WORDS.has(w));
  const unique = [...new Set(filtered)];
  return unique.slice(0, 10); // Max 10 terms
}

/**
 * Try FTS5 full-text search for more accurate matching.
 * Falls back to LIKE if FTS5 is not available.
 */
async function searchNodesFts(
  db: any,
  terms: string[]
): Promise<Array<{ id: string; type: string; name: string; file_path: string | null; rank: number }>> {
  const results: Array<{ id: string; type: string; name: string; file_path: string | null; rank: number }> = [];

  if (terms.length === 0) return results;

  // Try FTS5 first
  try {
    const escaped = terms.map(t => t.replace(/"/g, '""'));
    const ftsQuery = escaped.map(t => '"' + t + '"').join(" OR ");
    const stmt = db.prepare(`
      SELECT n.id, n.type, n.name, n.file_path, rank
      FROM nodes_fts f
      JOIN nodes n ON n.rowid = f.rowid
      WHERE nodes_fts MATCH ?
      ORDER BY rank
      LIMIT 10
    `);
    stmt.bind([ftsQuery]);
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      results.push({
        id: row.id as string,
        type: row.type as string,
        name: row.name as string,
        file_path: row.file_path as string | null,
        rank: (row.rank as number) || 0,
      });
    }
    stmt.free();
    return results;
  } catch {
    // FTS5 not available — fall through to LIKE
  }

  // Fallback: LIKE search (less accurate, but always works)
  const seen = new Set<string>();
  for (const term of terms) {
    try {
      const stmt = db.prepare(`
        SELECT id, type, name, file_path FROM nodes
        WHERE name LIKE ? OR file_path LIKE ?
        ORDER BY updated_at DESC LIMIT 5
      `);
      stmt.bind([`%${term}%`, `%${term}%`]);
      while (stmt.step()) {
        const row = stmt.getAsObject() as Record<string, unknown>;
        const id = row.id as string;
        if (!seen.has(id)) {
          seen.add(id);
          results.push({
            id,
            type: row.type as string,
            name: row.name as string,
            file_path: row.file_path as string | null,
            rank: 0,
          });
        }
      }
      stmt.free();
    } catch {}
  }

  return results.slice(0, 10);
}

/**
 * Check recency: how many seconds ago was a file last committed?
 * Uses git log to find last commit timestamp.
 */
function getFileRecencySeconds(filePath: string): number | null {
  try {
    const escapedPath = filePath.replace(/"/g, '\\"');
    const result = execSync(
      'git log -1 --format=%ct -- "' + escapedPath + '" 2>/dev/null || echo 0',
      { encoding: "utf-8", timeout: 2000 }
    );
    const timestamp = parseInt(result.trim(), 10);
    if (!timestamp || timestamp === 0) return null;
    return Math.floor(Date.now() / 1000) - timestamp;
  } catch {
    return null;
  }
}

/**
 * Calculate priority score based on multiple factors:
 * - Higher base for failures (they need attention)
 * - Higher for recently modified files
 * - Higher for exact name matches vs partial
 */
function calculatePriority(
  type: "file" | "failure" | "graph" | "memory",
  label: string,
  terms: string[],
  recencySeconds: number | null
): number {
  let score = 0;

  // Base priority by type
  switch (type) {
    case "failure": score = 90; break;
    case "file": score = 60; break;
    case "graph": score = 50; break;
    case "memory": score = 40; break;
  }

  // Bonus for exact term match in label
  const lower = label.toLowerCase();
  for (const term of terms) {
    if (lower === term) {
      score += 30; // Exact match
    } else if (lower.includes(term)) {
      score += 15; // Partial match
    }
  }

  // Recency bonus: files modified in last hour get +20
  if (recencySeconds !== null) {
    if (recencySeconds < 3600) score += 20;       // < 1 hour
    else if (recencySeconds < 86400) score += 10;  // < 1 day
    else if (recencySeconds < 604800) score += 5;  // < 1 week
  }

  return Math.min(score, 100); // Cap at 100
}

/**
 * Build relevant context for a given goal/intent.
 * Aggregates from Knowledge Graph, session memory, and memories.
 * Uses FTS5 full-text search when available, falls back to LIKE.
 */
export async function buildContextForGoal(goal: string): Promise<{
  context: ContextItem[];
  summary: string;
}> {
  const items: ContextItem[] = [];
  const terms = extractTerms(goal);

  // If no meaningful terms after filtering, show all modified files
  if (terms.length === 0) {
    const modifiedFiles = sessionMemory.getModifiedFiles();
    for (const mf of modifiedFiles) {
      items.push({
        type: "file",
        label: mf.filePath,
        detail: "Modified (" + mf.status + ")",
        priority: calculatePriority("file", mf.filePath, [], null),
      });
    }
    return { context: items.slice(0, 15), summary: "\uD83D\uDCCB No specific terms in goal. Showing " + Math.min(items.length, 15) + " modified file(s)." };
  }

  try {
    // 1. Search Knowledge Graph via FTS5 (or LIKE fallback)
    const db = await getDb();
    const nodeResults = await searchNodesFts(db, terms);
    const seenNodes = new Set<string>();

    for (const node of nodeResults) {
      if (seenNodes.has(node.id)) continue;
      seenNodes.add(node.id);
      const recency = node.file_path ? getFileRecencySeconds(node.file_path) : null;
      const priority = calculatePriority("graph", node.name, terms, recency);
      items.push({
        type: "graph",
        label: node.name,
        detail: node.type + ": " + (node.file_path || node.id),
        priority,
      });

      // Fetch related edges for top matches
      if (nodeResults.indexOf(node) < 3) {
        try {
          const edgeStmt = db.prepare(`
            SELECT e.type, e.weight, n.name, n.file_path
            FROM edges e
            JOIN nodes n ON n.id = e.target_id
            WHERE e.source_id = ?
            ORDER BY e.weight DESC LIMIT 3
          `);
          edgeStmt.bind([node.id]);
          while (edgeStmt.step()) {
            const row = edgeStmt.getAsObject() as Record<string, unknown>;
            const edgeName = (row.name as string) || "";
            const edgeKey = "edge:" + edgeName;
            if (!seenNodes.has(edgeKey)) {
              seenNodes.add(edgeKey);
              items.push({
                type: "graph",
                label: edgeName,
                detail: row.type + " (weight: " + row.weight + ")",
                priority: calculatePriority("graph", edgeName, terms, null) - 10,
              });
            }
          }
          edgeStmt.free();
        } catch {}
      }
    }
  } catch {}

  // 2. Find modified files matching goal
  const modifiedFiles = sessionMemory.getModifiedFiles();
  for (const mf of modifiedFiles) {
    if (terms.some(t => mf.filePath.toLowerCase().includes(t))) {
      const recency = getFileRecencySeconds(mf.filePath);
      const priority = calculatePriority("file", mf.filePath, terms, recency);
      items.push({
        type: "file",
        label: mf.filePath,
        detail: "Modified (" + mf.status + ")",
        priority,
      });
    }
  }

  // 3. Find related failures (highest priority)
  const failedFiles = sessionMemory.getFailedFiles();
  for (const ff of failedFiles) {
    for (const f of ff.failures) {
      if (!f.resolved && terms.some(t => f.error.toLowerCase().includes(t))) {
        const priority = calculatePriority("failure", ff.task, terms, null);
        items.push({
          type: "failure",
          label: ff.task,
          detail: f.error.substring(0, 120),
          priority,
        });
        break;
      }
    }
  }

  // 4. Score memories for relevance
  const memories = scoreMemoryRelevance(goal, 3);
  for (const m of memories) {
    const priority = calculatePriority("memory", m.topic, terms, null);
    items.push({
      type: "memory",
      label: m.topic,
      detail: m.content.substring(0, 100),
      priority,
    });
  }

  // Deduplicate by label
  const seen = new Set<string>();
  const unique = items.filter(i => {
    const key = i.type + ":" + i.label;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort by priority descending
  unique.sort((a, b) => b.priority - a.priority);

  // Build summary
  const graphCount = unique.filter(i => i.type === "graph").length;
  const fileCount = unique.filter(i => i.type === "file").length;
  const failureCount = unique.filter(i => i.type === "failure").length;
  const memoryCount = unique.filter(i => i.type === "memory").length;
  const summary = "\uD83D\uDCCB Context for \"" + goal.substring(0, 40) + "\": " + unique.length + " items (" + graphCount + " graph, " + fileCount + " files, " + failureCount + " failures, " + memoryCount + " memories)";

  return { context: unique.slice(0, 15), summary };
}

/**
 * Format context items as human-readable.
 */
export function formatContextItems(items: ContextItem[], summary: string): string {
  if (items.length === 0) return "";

  const lines: string[] = [
    summary,
    "\u2501".repeat(25),
  ];

  for (const item of items) {
    const icon =
      item.type === "graph" ? "\uD83D\uDD17" :
      item.type === "file" ? "\uD83D\uDCC4" :
      item.type === "failure" ? "\u274C" :
      item.type === "memory" ? "\uD83E\uDDE0" :
      "\uD83D\uDCCC";
    lines.push("  " + icon + " **" + item.label + "** \u2014 " + item.detail);
  }

  return lines.join("\n");
}

/**
 * Enrich kuma_init output with relevant context.
 */
export async function enrichInitWithContext(): Promise<string> {
  const summary = sessionMemory.getSummary();
  const goal = (summary.currentGoal as string) || "";

  if (!goal) return "";

  const { context, summary: ctxSummary } = await buildContextForGoal(goal);
  if (context.length === 0) return "";

  return formatContextItems(context, ctxSummary);
}
