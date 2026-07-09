// ============================================================
// KUMA COLLECTIVE — Collective Intelligence (Phase 8.5)
// ============================================================
// Anonymized pattern sharing: aggregates failure/success
// patterns across projects without sharing source code.
// ============================================================

import { getDb } from "./kumaDb.js";

interface CollectivePattern {
  pattern: string;
  frequency: number;
  successRate: number;
  projectsObserved: number;
  lastSeen: number;
}

/**
 * Discover patterns from local knowledge graph (anonymized).
 */
export async function discoverCollectivePatterns(): Promise<string> {
  try {
    const db = await getDb();
    const patterns: CollectivePattern[] = [];

    // Pattern 1: Most common error patterns
    try {
      const errorResult = db.exec(`
        SELECT type, COUNT(*) as cnt FROM failure_kb GROUP BY type ORDER BY cnt DESC
      `);
      if (errorResult[0]?.values) {
        for (const row of errorResult[0].values) {
          patterns.push({
            pattern: `failure:${row[0]}`,
            frequency: row[1] as number,
            successRate: 0,
            projectsObserved: 1,
            lastSeen: Date.now(),
          });
        }
      }
    } catch {}

    // Pattern 2: Most successful tool sequences
    try {
      const seqResult = db.exec(`
        SELECT antecedent_tool, consequent_tool, COUNT(*) as cnt, AVG(success_rate) as avg_success
        FROM experience_patterns GROUP BY antecedent_tool, consequent_tool
        ORDER BY cnt DESC LIMIT 10
      `);
      if (seqResult[0]?.values) {
        for (const row of seqResult[0].values) {
          patterns.push({
            pattern: `sequence:${row[0]}→${row[1]}`,
            frequency: row[2] as number,
            successRate: Math.round((row[3] as number) * 100),
            projectsObserved: 1,
            lastSeen: Date.now(),
          });
        }
      }
    } catch {}

    // Pattern 3: High-frequency nodes (most accessed)
    try {
      const nodeResult = db.exec(`
        SELECT type, COUNT(*) as cnt FROM nodes GROUP BY type ORDER BY cnt DESC
      `);
      if (nodeResult[0]?.values) {
        for (const row of nodeResult[0].values) {
          patterns.push({
            pattern: `node_type:${row[0]}`,
            frequency: row[1] as number,
            successRate: 100,
            projectsObserved: 1,
            lastSeen: Date.now(),
          });
        }
      }
    } catch {}

    return formatCollectivePatterns(patterns);
  } catch (err) {
    return `Error discovering collective patterns: ${err}`;
  }
}

/**
 * Export anonymized patterns (no source code, only metadata).
 */
export function exportAnonymizedPatterns(): string {
  try {
    // In real implementation, this would send to a central service.
    // For now, simulate what would be shared.
    return [
      "📤 **Anonymized Pattern Export**",
      "━━━━━━━━━━━━━━━━━━━━━━━━━",
      "",
      "The following data would be shared (no source code):",
      "  • Failure type frequencies (anonymized)",
      "  • Tool sequence success rates",
      "  • Node type distribution",
      "  • Session duration patterns",
      "",
      "🔒 **Privacy Guarantees:**",
      "  ✅ No source code ever leaves your project",
      "  ✅ No file names, function names, or symbol names",
      "  ✅ No git history, no commit messages",
      "  ✅ Only failure TYPE patterns (not error messages)",
      "  ✅ Only tool SEQUENCES (not parameters)",
      "  ✅ Opt-out at any time via .kuma/config.json",
      "",
      "💡 Enable sharing: set collective_intelligence: true in .kuma/config.json",
    ].join("\n");
  } catch {
    return "Error exporting patterns.";
  }
}

function formatCollectivePatterns(patterns: CollectivePattern[]): string {
  if (patterns.length === 0) {
    return "🧠 **Collective Intelligence** — No patterns discovered yet. Build the knowledge graph first.";
  }

  const lines: string[] = [
    `🧠 **Collective Intelligence** — ${patterns.length} pattern(s) discovered`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━`,
    "",
  ];

  for (const p of patterns.slice(0, 15)) {
    if (p.pattern.startsWith("failure:")) {
      const type = p.pattern.replace("failure:", "");
      const emoji = type === "test_failure" ? "🧪" : type === "type_error" ? "📐" : type === "build_error" ? "🏗️" : "⚠️";
      lines.push(`  ${emoji} **${type}** — ${p.frequency}x observed`);
    } else if (p.pattern.startsWith("sequence:")) {
      const seq = p.pattern.replace("sequence:", "");
      lines.push(`  🔄 **${seq}** — ${p.frequency}x (${p.successRate}% success)`);
    } else if (p.pattern.startsWith("node_type:")) {
      const type = p.pattern.replace("node_type:", "");
      const emoji = type === "function" ? "🔧" : type === "file" ? "📄" : type === "test" ? "🧪" : "📌";
      lines.push(`  ${emoji} **${type}** — ${p.frequency} nodes`);
    }
  }

  lines.push("", "💡 Patterns stay local unless sharing is enabled.");
  return lines.join("\n");
}
