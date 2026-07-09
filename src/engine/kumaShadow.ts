// ============================================================
// KUMA SHADOW — Shadow Execution (Phase 8.3)
// ============================================================
// Simulate changes before applying them.
// Uses knowledge graph + LSP data to predict impacts.
// ============================================================

import { getDb } from "./kumaDb.js";

interface ShadowResult {
  target: string;
  type: "rename" | "modify" | "delete";
  predictedErrors: string[];
  affectedFiles: string[];
  affectedTests: string[];
  riskScore: number;
  recommendation: string;
}

/**
 * Simulate a change and predict its impact.
 */
export async function simulateChange(type: "rename" | "modify" | "delete", target: string, newName?: string): Promise<string> {
  try {
    const db = await getDb();
    const result: ShadowResult = { target, type, predictedErrors: [], affectedFiles: [], affectedTests: [], riskScore: 0, recommendation: "" };

    // Find the node in the graph
    const nodeStmt = db.prepare(`SELECT id, type, name, file_path FROM nodes WHERE name LIKE ? OR name = ? LIMIT 5`);
    nodeStmt.bind([`%${target}%`, target]);
    const nodeIds: string[] = [];
    while (nodeStmt.step()) {
      const row = nodeStmt.getAsObject() as Record<string, unknown>;
      nodeIds.push(row.id as string);
      const fp = row.file_path as string;
      if (fp && !result.affectedFiles.includes(fp)) result.affectedFiles.push(fp);
    }
    nodeStmt.free();

    if (nodeIds.length === 0) {
      return `⚠️ **Shadow Execution** — "${target}" not found in knowledge graph.`;
    }

    // Find all edges connected to these nodes
    for (const nid of nodeIds) {
      const edgeStmt = db.prepare(`
        SELECT CASE WHEN source_id = ? THEN target_id ELSE source_id END AS connected,
               type, n.name, n.type, n.file_path
        FROM edges e JOIN nodes n ON n.id = CASE WHEN source_id = ? THEN target_id ELSE source_id END
        WHERE source_id = ? OR target_id = ?
        LIMIT 30
      `);
      edgeStmt.bind([nid, nid, nid, nid]);
      while (edgeStmt.step()) {
        const row = edgeStmt.getAsObject() as Record<string, unknown>;
        const name = row.name as string;
        const fp = row.file_path as string;
        if (fp && !result.affectedFiles.includes(fp)) result.affectedFiles.push(fp);
        if (row.type === "tests" || (name as string).includes("test")) {
          if (!result.affectedTests.includes(fp)) result.affectedTests.push(fp);
        }
      }
      edgeStmt.free();
    }

    // Predict errors based on type
    if (type === "rename" && newName) {
      result.predictedErrors.push(`🔧 ${result.affectedFiles.length} files need update references`);
      if (result.affectedTests.length > 0) result.predictedErrors.push(`🧪 ${result.affectedTests.length} tests need updated imports`);
      result.predictedErrors.push("⚠️ Verify no string references to old name in documentation");
    } else if (type === "delete") {
      result.predictedErrors.push(`🔴 ${result.affectedFiles.length} files will break from missing dependency`);
      if (result.affectedTests.length > 0) result.predictedErrors.push(`🧪 ${result.affectedTests.length} tests will fail`);
      result.predictedErrors.push("💡 Consider deprecation path instead of immediate delete");
    } else if (type === "modify") {
      result.predictedErrors.push(`📐 ${result.affectedFiles.length} files may need type adjustments`);
    }

    // Risk score
    result.riskScore = Math.min(100,
      (result.affectedFiles.length * 10) +
      (result.affectedTests.length * 15) +
      (type === "delete" ? 30 : type === "rename" ? 20 : 10)
    );

    // Recommendation
    if (result.riskScore > 70) {
      result.recommendation = "🔴 **High Risk** — Break into smaller steps. Start with plan → test → execute.";
    } else if (result.riskScore > 40) {
      result.recommendation = "🟡 **Medium Risk** — Create a backup, make the change, then verify with tests.";
    } else {
      result.recommendation = "🟢 **Low Risk** — Safe to proceed. Verify afterward.";
    }

    return formatShadowResult(result, newName);
  } catch (err) {
    return `Error in shadow execution: ${err}`;
  }
}

function formatShadowResult(r: ShadowResult, newName?: string): string {
  const bar = "█".repeat(Math.round(r.riskScore / 10)) + "░".repeat(Math.round(10 - r.riskScore / 10));
  const lines: string[] = [
    `🎭 **Shadow Execution** — ${r.type === "rename" ? `Rename "${r.target}" → "${newName}"` : r.type === "delete" ? `Delete "${r.target}"` : `Modify "${r.target}"`}`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━`,
    "",
    `📊 **Risk Assessment:** ${bar} ${r.riskScore}/100`,
    `${r.recommendation}`,
    "",
  ];

  if (r.predictedErrors.length > 0) {
    lines.push("**Predicted Issues:**");
    for (const e of r.predictedErrors) lines.push(`  ${e}`);
    lines.push("");
  }

  if (r.affectedFiles.length > 0) {
    lines.push(`**Affected Files (${r.affectedFiles.length}):**`);
    for (const f of r.affectedFiles.slice(0, 10)) lines.push(`  📄 ${f}`);
    if (r.affectedFiles.length > 10) lines.push(`  ... +${r.affectedFiles.length - 10} more`);
    lines.push("");
  }

  if (r.affectedTests.length > 0) {
    lines.push(`**Affected Tests (${r.affectedTests.length}):**`);
    for (const t of r.affectedTests.slice(0, 5)) lines.push(`  🧪 ${t}`);
    if (r.affectedTests.length > 5) lines.push(`  ... +${r.affectedTests.length - 5} more`);
    lines.push("");
  }

  return lines.join("\n");
}
