// ============================================================
// KUMA CONTEXT ENGINE — Context Engine (Phase 3.3)
// ============================================================
// Maps AI intents/goals to relevant codebase context.
// Uses Knowledge Graph for distance-based relevance,
// session memory for recency, and failure history for risk.
// ============================================================

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
 * Build relevant context for a given goal/intent.
 * Aggregates from Knowledge Graph, session memory, and memories.
 */
export async function buildContextForGoal(goal: string): Promise<{
  context: ContextItem[];
  summary: string;
}> {
  const items: ContextItem[] = [];
  const terms = goal.toLowerCase().split(/\s+/).filter(w => w.length > 2);

  try {
    // 1. Search Knowledge Graph for related nodes
    const db = await getDb();
    for (const term of terms) {
      const stmt = db.prepare(`
        SELECT id, type, name, file_path FROM nodes
        WHERE (name LIKE ? OR file_path LIKE ?)
        ORDER BY updated_at DESC LIMIT 5
      `);
      stmt.bind([`%${term}%`, `%${term}%`]);
      while (stmt.step()) {
        const row = stmt.getAsObject() as Record<string, unknown>;
        items.push({
          type: "graph",
          label: (row.name as string) || "",
          detail: `${row.type}: ${row.file_path || row.id}`,
          priority: 80,
        });
      }
      stmt.free();

      // 2. Search edges for related connections
      const edgeStmt = db.prepare(`
        SELECT e.type, e.weight, n.name, n.file_path
        FROM edges e
        JOIN nodes n ON n.id = e.target_id
        WHERE e.source_id LIKE ?
        ORDER BY e.weight DESC LIMIT 5
      `);
      edgeStmt.bind([`%${term}%`]);
      while (edgeStmt.step()) {
        const row = edgeStmt.getAsObject() as Record<string, unknown>;
        items.push({
          type: "graph",
          label: (row.name as string) || "",
          detail: `${row.type} (weight: ${row.weight})`,
          priority: 60,
        });
      }
      edgeStmt.free();
    }
  } catch {}

  // 3. Find modified files matching goal
  const modifiedFiles = sessionMemory.getModifiedFiles();
  for (const mf of modifiedFiles) {
    if (terms.some(t => mf.filePath.toLowerCase().includes(t))) {
      items.push({
        type: "file",
        label: mf.filePath,
        detail: `Modified (${mf.status})`,
        priority: 70,
      });
    }
  }

  // 4. Find related failures
  const failedFiles = sessionMemory.getFailedFiles();
  for (const ff of failedFiles) {
    for (const f of ff.failures) {
      if (!f.resolved && terms.some(t => f.error.toLowerCase().includes(t))) {
        items.push({
          type: "failure",
          label: ff.task,
          detail: f.error.substring(0, 120),
          priority: 90,
        });
        break;
      }
    }
  }

  // 5. Score memories for relevance
  const memories = scoreMemoryRelevance(goal, 3);
  for (const m of memories) {
    items.push({
      type: "memory",
      label: m.topic,
      detail: m.content.substring(0, 100),
      priority: m.score,
    });
  }

  // Deduplicate by label
  const seen = new Set<string>();
  const unique = items.filter(i => {
    const key = `${i.type}:${i.label}`;
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
  const summary = `📋 Context for "${goal.substring(0, 40)}": ${unique.length} items (${graphCount} graph, ${fileCount} files, ${failureCount} failures, ${memoryCount} memories)`;

  return { context: unique.slice(0, 15), summary };
}

/**
 * Format context items as human-readable.
 */
export function formatContextItems(items: ContextItem[], summary: string): string {
  if (items.length === 0) return "";

  const lines: string[] = [
    summary,
    "━━━━━━━━━━━━━━━━━━━━━━━━━",
  ];

  for (const item of items) {
    const icon =
      item.type === "graph" ? "🔗" :
      item.type === "file" ? "📄" :
      item.type === "failure" ? "❌" :
      item.type === "memory" ? "🧠" :
      "📌";
    lines.push(`  ${icon} **${item.label}** — ${item.detail}`);
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
