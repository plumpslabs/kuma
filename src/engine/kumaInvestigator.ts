// ============================================================
// KUMA INVESTIGATOR — Autonomous Investigation (Phase 5.2)
// ============================================================
// Given a problem statement, auto-discovers relevant code paths,
// traces through the knowledge graph, finds bottlenecks, and
// reports findings.
// ============================================================

import { getDb } from "./kumaDb.js";

interface InvestigationReport {
  problem: string;
  discoveredPaths: Array<{ step: number; node: string; type: string; detail: string }>;
  bottlenecks: string[];
  totalNodesFound: number;
  confidence: "high" | "medium" | "low";
}

/**
 * Investigate a problem by discovering relevant code paths.
 */
export async function investigate(problem: string): Promise<string> {
  try {
    const db = await getDb();
    const terms = extractTerms(problem);
    const paths: InvestigationReport["discoveredPaths"] = [];
    const seen = new Set<string>();
    let step = 0;

    // 1. Find relevant nodes from problem terms
    for (const term of terms) {
      const stmt = db.prepare(`
        SELECT id, type, name, file_path FROM nodes
        WHERE name LIKE ? OR file_path LIKE ? OR id LIKE ?
        LIMIT 5
      `);
      stmt.bind([`%${term}%`, `%${term}%`, `%${term}%`]);
      while (stmt.step()) {
        const row = stmt.getAsObject() as Record<string, unknown>;
        const id = row.id as string;
        if (seen.has(id)) continue;
        seen.add(id);
        step++;
        paths.push({
          step,
          node: row.name as string,
          type: row.type as string,
          detail: row.file_path ? `📍 ${row.file_path}` : "📍 Knowledge Graph node",
        });
      }
      stmt.free();
    }

    // 2. Trace outgoing edges from found nodes
    const outgoingChecked = new Set<string>();
    for (const p of [...paths]) {
      if (outgoingChecked.has(p.node)) continue;
      outgoingChecked.add(p.node);
      const nodeId = `${p.type}::${p.node}`;
      const edgeStmt = db.prepare(`
        SELECT n.name, n.type, n.file_path, e.type AS rel
        FROM edges e JOIN nodes n ON n.id = e.target_id
        WHERE e.source_id = ? LIMIT 10
      `);
      edgeStmt.bind([nodeId]);
      while (edgeStmt.step()) {
        const row = edgeStmt.getAsObject() as Record<string, unknown>;
        const name = row.name as string;
        if (seen.has(name)) continue;
        seen.add(name);
        step++;
        paths.push({
          step,
          node: name,
          type: row.type as string,
          detail: `${row.rel === "calls" ? "➡️ Calls" : row.rel === "imports" ? "📥 Imports" : "🔗 Relates"} → ${row.file_path || ""}`,
        });
      }
      edgeStmt.free();
      if (step >= 30) break;
    }

    const bottlenecks = findBottlenecks(paths);

    const report: InvestigationReport = {
      problem,
      discoveredPaths: paths,
      bottlenecks,
      totalNodesFound: seen.size,
      confidence: seen.size > 5 ? "high" : seen.size > 2 ? "medium" : "low",
    };

    return formatReport(report);
  } catch (err) {
    return `Error investigating: ${err}`;
  }
}

function extractTerms(problem: string): string[] {
  return problem
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter(w => w.length > 2 && !["the", "and", "for", "are", "but", "not", "you", "all", "can", "had", "her", "was", "one", "our", "out", "has", "have", "been", "some", "them", "then", "their", "this", "that", "with", "from", "they", "will", "would", "could", "should", "about", "into", "over", "after", "also", "does", "each", "made", "just", "more", "most", "much", "must", "only", "other", "such", "than", "very", "when", "where", "which", "while", "your", "fix", "bug", "slow", "error", "issue", "problem"].includes(w))
    .slice(0, 8);
}

function findBottlenecks(paths: InvestigationReport["discoveredPaths"]): string[] {
  const freq = new Map<string, number>();
  for (const p of paths) {
    const dir = p.detail.split("/")[0] || "unknown";
    freq.set(dir, (freq.get(dir) || 0) + 1);
  }
  const bottlenecks: string[] = [];
  for (const [dir, count] of freq) {
    if (count > 3) bottlenecks.push(`🔴 ${dir} — ${count} related nodes (high concentration)`);
  }
  return bottlenecks;
}

function formatReport(report: InvestigationReport): string {
  const lines: string[] = [
    `🔍 **Autonomous Investigation** — "${report.problem}"`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━`,
    "",
    `📊 **${report.totalNodesFound} nodes discovered** | Confidence: ${report.confidence === "high" ? "🟢 High" : report.confidence === "medium" ? "🟡 Medium" : "🔴 Low"}`,
    "",
  ];

  if (report.discoveredPaths.length > 0) {
    lines.push("**Discovered Path:**");
    for (const p of report.discoveredPaths.slice(0, 20)) {
      const emoji = p.type === "function" ? "🔧" : p.type === "file" ? "📄" : p.type === "test" ? "🧪" : p.type === "api_route" ? "🌐" : "📌";
      lines.push(`  ${p.step}. ${emoji} **${p.node}** (${p.type})`);
      if (p.detail && p.detail !== "📍 Knowledge Graph node") lines.push(`     ${p.detail}`);
    }
    if (report.discoveredPaths.length > 20) {
      lines.push(`     ... +${report.discoveredPaths.length - 20} more`);
    }
    lines.push("");
  }

  if (report.bottlenecks.length > 0) {
    lines.push("**⚠️ Potential Bottlenecks:**");
    for (const b of report.bottlenecks) lines.push(`  ${b}`);
    lines.push("");
  }

  lines.push("💡 Use kuma_navigate with 'how does X work' for deeper flow analysis.");
  return lines.join("\n");
}
