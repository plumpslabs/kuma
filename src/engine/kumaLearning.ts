// ============================================================
// KUMA LEARNING — AI Learning Mode (Phase 7.2)
// ============================================================
// Graph automatically prioritizes high-usage patterns.
// Tracks frequency, promotes popular nodes, demotes rarely-used.
// ============================================================

import { getDb, saveDb } from "./kumaDb.js";

interface LearnedPattern {
  nodeName: string;
  type: string;
  frequency: number;
  priority: "high" | "normal" | "low";
  lastAccessed: number;
}

/**
 * Learn from current graph state — find high-usage patterns.
 */
export async function learnPatterns(): Promise<string> {
  try {
    const db = await getDb();

    // 1. Find high-weight edges (frequently traversed)
    const edgeStmt = db.prepare(`
      SELECT e.source_id, e.target_id, e.type, e.weight,
        s.name AS src_name, t.name AS tgt_name
      FROM edges e
      JOIN nodes s ON s.id = e.source_id
      JOIN nodes t ON t.id = e.target_id
      ORDER BY e.weight DESC
      LIMIT 20
    `);
    const highUsage: string[] = [];
    const patterns: LearnedPattern[] = [];

    while (edgeStmt.step()) {
      const row = edgeStmt.getAsObject() as Record<string, unknown>;
      highUsage.push(`  🔥 **${row.src_name}** → **${row.tgt_name}** (${row.type}, weight: ${row.weight})`);
    }
    edgeStmt.free();

    // 2. Tag high-frequency nodes
    const nodeStmt = db.prepare(`
      SELECT n.id, n.name, n.type, n.metadata,
        (SELECT COUNT(*) FROM edges WHERE source_id = n.id OR target_id = n.id) AS edge_count
      FROM nodes n
      ORDER BY edge_count DESC
      LIMIT 15
    `);
    while (nodeStmt.step()) {
      const row = nodeStmt.getAsObject() as Record<string, unknown>;
      const count = row.edge_count as number;
      const priority: "high" | "normal" | "low" = count > 5 ? "high" : count > 2 ? "normal" : "low";
      patterns.push({
        nodeName: row.name as string,
        type: row.type as string,
        frequency: count,
        priority,
        lastAccessed: Date.now(),
      });

      // Update metadata with priority
      try {
        const meta = JSON.parse((row.metadata as string) || "{}");
        meta.priority = priority;
        meta.frequency = count;
        db.run(`UPDATE nodes SET metadata = ? WHERE id = ?`, [JSON.stringify(meta), row.id as string]);
      } catch {}
    }
    nodeStmt.free();
    saveDb(db);

    return formatLearningReport(patterns, highUsage);
  } catch (err) {
    return `Error learning patterns: ${err}`;
  }
}

function formatLearningReport(patterns: LearnedPattern[], highUsage: string[]): string {
  const lines: string[] = [
    `🧠 **AI Learning Mode**`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━`,
    "",
    `📊 ${patterns.length} patterns analyzed`,
    "",
  ];

  const high = patterns.filter(p => p.priority === "high");
  const normal = patterns.filter(p => p.priority === "normal");
  const low = patterns.filter(p => p.priority === "low");

  if (high.length > 0) {
    lines.push("**🔥 High Priority (auto-promoted):**");
    for (const p of high) {
      const emoji = p.type === "function" ? "🔧" : p.type === "file" ? "📄" : p.type === "test" ? "🧪" : "📌";
      lines.push(`  ${emoji} **${p.nodeName}** (${p.type}) — ${p.frequency} connections`);
    }
    lines.push("");
  }
  if (normal.length > 0) {
    lines.push("**📊 Normal Priority:**");
    for (const p of normal) {
      lines.push(`  • **${p.nodeName}** (${p.type}) — ${p.frequency} connections`);
    }
    lines.push("");
  }
  if (low.length > 0) {
    lines.push("**💤 Low Priority (candidates for pruning):**");
    for (const p of low.slice(0, 5)) {
      lines.push(`  • **${p.nodeName}** (${p.type}) — ${p.frequency} connections`);
    }
    if (low.length > 5) lines.push(`  ... +${low.length - 5} more`);
    lines.push("");
  }

  if (highUsage.length > 0) {
    lines.push("**🔥 Most Traversed Paths:**");
    lines.push(...highUsage.slice(0, 10));
    lines.push("");
  }

  lines.push("💡 High-priority nodes are auto-promoted in Knowledge Graph queries.");
  return lines.join("\n");
}
