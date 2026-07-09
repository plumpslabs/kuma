// ============================================================
// KUMA SEMANTIC — Semantic Compression (Phase 8.2)
// ============================================================
// Compress large codebases into a semantic representation:
// exported symbols, type signatures, dependencies.
// ============================================================

import { getDb } from "./kumaDb.js";

interface SemanticBlob {
  nodes: Array<{ name: string; type: string; filePath?: string }>;
  edges: Array<{ source: string; target: string; type: string }>;
  summary: string;
  compressed: boolean;
}

/**
 * Compress knowledge graph into a semantic summary.
 */
export async function compressGraph(): Promise<string> {
  try {
    const db = await getDb();

    const nodeCount = (db.exec("SELECT COUNT(*) as c FROM nodes")[0]?.values[0][0] as number) || 0;
    const edgeCount = (db.exec("SELECT COUNT(*) as c FROM edges")[0]?.values[0][0] as number) || 0;

    if (nodeCount === 0) {
      return "⚠️ Knowledge graph is empty. Nothing to compress.";
    }

    // Build semantic blob
    const blob: SemanticBlob = { nodes: [], edges: [], summary: "", compressed: true };

    // Export key nodes (functions, files, tests — skip metadata-heavy entries)
    const nodeStmt = db.prepare(`SELECT name, type, file_path FROM nodes ORDER BY type LIMIT 200`);
    while (nodeStmt.step()) {
      const row = nodeStmt.getAsObject() as Record<string, unknown>;
      blob.nodes.push({
        name: row.name as string,
        type: row.type as string,
        filePath: row.file_path as string || undefined,
      });
    }
    nodeStmt.free();

    // Export key edges (calls, imports, defines — most important relationships)
    const edgeStmt = db.prepare(`
      SELECT s.name AS src, t.name AS tgt, e.type
      FROM edges e
      JOIN nodes s ON s.id = e.source_id
      JOIN nodes t ON t.id = e.target_id
      WHERE e.type IN ('calls', 'imports', 'defines', 'tests')
      LIMIT 300
    `);
    while (edgeStmt.step()) {
      const row = edgeStmt.getAsObject() as Record<string, unknown>;
      blob.edges.push({
        source: row.src as string,
        target: row.tgt as string,
        type: row.type as string,
      });
    }
    edgeStmt.free();

    // Generate summary
    const types = new Map<string, number>();
    for (const n of blob.nodes) types.set(n.type, (types.get(n.type) || 0) + 1);

    blob.summary = [
      `Compressed Graph: ${blob.nodes.length} nodes, ${blob.edges.length} edges`,
      ...[...types.entries()].map(([t, c]) => `  ${t}: ${c}`),
    ].join("\n");

    const json = JSON.stringify(blob);
    const originalEstimate = nodeCount * 100 + edgeCount * 50; // rough estimate
    const compressedSize = json.length;
    const ratio = originalEstimate > 0 ? Math.round((1 - compressedSize / originalEstimate) * 100) : 0;

    return formatCompression(blob, originalEstimate, compressedSize, ratio);
  } catch (err) {
    return `Error compressing graph: ${err}`;
  }
}

function formatCompression(blob: SemanticBlob, originalEst: number, compressed: number, ratio: number): string {
  const lines: string[] = [
    `📦 **Semantic Compression**`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━`,
    "",
    `📊 ${blob.nodes.length} symbols | ${blob.edges.length} relationships`,
    `📏 Estimated original: ${(originalEst / 1024).toFixed(1)}KB → Compressed: ${(compressed / 1024).toFixed(1)}KB (${ratio}% reduction)`,
    "",
    blob.summary,
    "",
  ];

  if (blob.edges.length > 0) {
    lines.push("**Key Relationships:**");
    for (const e of blob.edges.slice(0, 15)) {
      const arrow = e.type === "calls" ? "→" : e.type === "imports" ? "⇢" : e.type === "defines" ? "▸" : e.type === "tests" ? "◈" : "→";
      lines.push(`  ${e.source} ${arrow} ${e.target} (${e.type})`);
    }
    if (blob.edges.length > 15) lines.push(`  ... +${blob.edges.length - 15} more`);
    lines.push("");
  }

  lines.push("💡 Semantic compression strips boilerplate and keeps only essential structure.");
  return lines.join("\n");
}
