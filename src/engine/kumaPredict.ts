// ============================================================
// KUMA PREDICT — Predictive AI (Phase 7.1)
// ============================================================
// Predicts what files/functions AI will need next based on
// knowledge graph traversal patterns and session history.
// ============================================================

import { getDb } from "./kumaDb.js";
import { sessionMemory } from "./sessionMemory.js";

interface Prediction {
  item: string;
  type: string;
  probability: number;
  reason: string;
}

/**
 * Predict what AI will need next.
 */
export async function predictNext(currentContext: string): Promise<string> {
  try {
    const db = await getDb();
    const history = sessionMemory.getToolCallHistory(10);
    const predictions: Prediction[] = [];
    const seen = new Set<string>();

    // 1. From recent tool calls, find what files were touched
    const recentFiles: string[] = [];
    for (const call of history.reverse()) {
      const fp = (call.params as Record<string, unknown>)?.filePath as string;
      if (fp && !recentFiles.includes(fp)) recentFiles.push(fp);
    }

    // 2. For each recent file, find what depends on it or it depends on
    for (const file of recentFiles.slice(0, 3)) {
      const fileId = `file::${file}`;
      const edgeStmt = db.prepare(`
        SELECT DISTINCT n.name, n.type, e.type AS rel
        FROM edges e
        JOIN nodes n ON n.id = (CASE WHEN e.source_id = ? THEN e.target_id ELSE e.source_id END)
        WHERE (e.source_id = ? OR e.target_id = ?)
          AND n.type IN ('file', 'function', 'test')
        LIMIT 10
      `);
      edgeStmt.bind([fileId, fileId, fileId]);
      while (edgeStmt.step()) {
        const row = edgeStmt.getAsObject() as Record<string, unknown>;
        const name = row.name as string;
        const type = row.type as string;
        const rel = row.rel as string;
        if (seen.has(name)) continue;
        seen.add(name);

        const prob = rel === "calls" ? 0.75 : rel === "imports" ? 0.65 : rel === "tests" ? 0.5 : 0.3;
        const reason = rel === "calls" ? `Called by recent file \`${file}\`` :
          rel === "imports" ? `Imported by \`${file}\`` :
          rel === "tests" ? `Tests related to \`${file}\`` :
          `Related to \`${file}\``;
        predictions.push({ item: name, type, probability: prob, reason });
      }
      edgeStmt.free();
    }

    // 3. Check if context mentions terms that exist in graph
    if (currentContext && currentContext.length > 3) {
      const terms = currentContext.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      for (const term of terms.slice(0, 5)) {
        const nodeStmt = db.prepare(`SELECT name, type FROM nodes WHERE name LIKE ? LIMIT 3`);
        nodeStmt.bind([`%${term}%`]);
        while (nodeStmt.step()) {
          const row = nodeStmt.getAsObject() as Record<string, unknown>;
          const name = row.name as string;
          if (seen.has(name)) continue;
          seen.add(name);
          predictions.push({
            item: name, type: row.type as string,
            probability: 0.4, reason: `Matches context term "${term}"`,
          });
        }
        nodeStmt.free();
      }
    }

    return formatPredictions(predictions, currentContext);
  } catch (err) {
    return `Error predicting: ${err}`;
  }
}

function formatPredictions(predictions: Prediction[], context: string): string {
  if (predictions.length === 0) {
    return "🔮 **Predictions** — Not enough data yet. Use more tools to build the knowledge graph.";
  }

  predictions.sort((a, b) => b.probability - a.probability);
  const lines: string[] = [
    `🔮 **Predictions** — ${predictions.length} suggestions`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━`,
    context ? `🎯 Context: "${context}"` : "",
    "",
    "**Next likely files/functions:**",
    "",
  ].filter(Boolean);

  for (const p of predictions.slice(0, 10)) {
    const bar = "█".repeat(Math.round(p.probability * 10)) + "░".repeat(Math.round(10 - p.probability * 10));
    const emoji = p.type === "file" ? "📄" : p.type === "function" ? "🔧" : p.type === "test" ? "🧪" : "📌";
    lines.push(`  ${emoji} **${p.item}** (${p.type})`);
    lines.push(`     ${bar} ${Math.round(p.probability * 100)}% — ${p.reason}`);
  }

  lines.push("", "💡 Higher probability = more likely to be needed next.");
  return lines.join("\n");
}
