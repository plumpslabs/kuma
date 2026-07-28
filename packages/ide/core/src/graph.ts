// ============================================================
// KUMA IDE CORE — Knowledge Graph Queries
// ============================================================

import { queryAll } from "./db.js";
import type { KumaNode, KumaEdge, KumaGraphExport } from "./types.js";

/**
 * Query all nodes in the knowledge graph.
 */
export function getNodes(db: any): KumaNode[] {
  return queryAll(db, "SELECT * FROM nodes ORDER BY name ASC") as KumaNode[];
}

/**
 * Query all edges in the knowledge graph.
 */
export function getEdges(db: any): KumaEdge[] {
  return queryAll(db, "SELECT * FROM edges ORDER BY relationship ASC") as KumaEdge[];
}

/**
 * Search nodes by name or type.
 */
export function searchNodes(db: any, query: string): KumaNode[] {
  return queryAll(
    db,
    "SELECT * FROM nodes WHERE name LIKE ? OR type LIKE ? ORDER BY name ASC",
    [`%${query}%`, `%${query}%`]
  ) as KumaNode[];
}

/**
 * Get a single node by ID.
 */
export function getNode(db: any, nodeId: number): KumaNode | null {
  const rows = queryAll(db, "SELECT * FROM nodes WHERE id = ?", [nodeId]);
  return rows.length > 0 ? (rows[0] as KumaNode) : null;
}

/**
 * Get edges connected to a specific node.
 */
export function getNodeEdges(db: any, nodeId: number): KumaEdge[] {
  return queryAll(
    db,
    "SELECT * FROM edges WHERE source_node_id = ? OR target_node_id = ?",
    [nodeId, nodeId]
  ) as KumaEdge[];
}

/**
 * Generate a Mermaid flowchart diagram from the knowledge graph.
 */
export function generateMermaid(
  nodes: KumaNode[],
  edges: KumaEdge[],
  options: { title?: string; maxNodes?: number } = {}
): string {
  const { title, maxNodes = 80 } = options;
  const lines: string[] = ["```mermaid", "flowchart TD"];

  if (title) {
    lines.push(`  title[${title}]`);
    lines.push(`  style title fill:#1a1a2e,color:#fff,font-size:16px`);
  }

  const limitedNodes = nodes.slice(0, maxNodes);
  const nodeIds = new Set(limitedNodes.map((n) => n.id));

  // Render nodes with type-based styling
  const typeStyles: Record<string, string> = {
    file: "fill:#1a1a2e,stroke:#4a9eff,color:#e0e0e0",
    function: "fill:#16213e,stroke:#00d2ff,color:#e0e0e0",
    class: "fill:#0f3460,stroke:#e94560,color:#e0e0e0",
    module: "fill:#533483,stroke:#e94560,color:#e0e0e0",
    api: "fill:#2d6a4f,stroke:#52b788,color:#e0e0e0",
    database: "fill:#1b4332,stroke:#95d5b2,color:#e0e0e0",
    concept: "fill:#3c096c,stroke:#9d4edd,color:#e0e0e0",
    default: "fill:#1a1a2e,stroke:#666,color:#e0e0e0",
  };

  for (const node of limitedNodes) {
    const style = typeStyles[node.type] || typeStyles.default;
    const safeName = node.name.replace(/[^a-zA-Z0-9_]/g, "_");
    lines.push(`  ${safeName}["${node.name}"]`);
    lines.push(`  style ${safeName} ${style}`);
  }

  // Render edges
  const renderedEdges = new Set<string>();
  for (const edge of edges) {
    if (!nodeIds.has(edge.source_node_id) || !nodeIds.has(edge.target_node_id))
      continue;

    const source = limitedNodes.find((n) => n.id === edge.source_node_id);
    const target = limitedNodes.find((n) => n.id === edge.target_node_id);
    if (!source || !target) continue;

    const srcName = source.name.replace(/[^a-zA-Z0-9_]/g, "_");
    const tgtName = target.name.replace(/[^a-zA-Z0-9_]/g, "_");
    const key = `${srcName}->${tgtName}:${edge.relationship}`;

    if (!renderedEdges.has(key)) {
      renderedEdges.add(key);
      const rel = edge.relationship || "connected_to";
      lines.push(`  ${srcName} -->|${rel}| ${tgtName}`);
    }
  }

  // Add legend
  lines.push("");
  lines.push("  subgraph Legend");
  lines.push("    direction LR");
  lines.push("    L1[file]:::fileStyle");
  lines.push("    L2[function]:::funcStyle");
  lines.push("    L3[class]:::classStyle");
  lines.push("    L4[module]:::moduleStyle");
  lines.push("    L5[api]:::apiStyle");
  lines.push("    L6[concept]:::conceptStyle");
  lines.push("  end");
  lines.push("  classDef fileStyle fill:#1a1a2e,stroke:#4a9eff");
  lines.push("  classDef funcStyle fill:#16213e,stroke:#00d2ff");
  lines.push("  classDef classStyle fill:#0f3460,stroke:#e94560");
  lines.push("  classDef moduleStyle fill:#533483,stroke:#e94560");
  lines.push("  classDef apiStyle fill:#2d6a4f,stroke:#52b788");
  lines.push("  classDef conceptStyle fill:#3c096c,stroke:#9d4edd");
  lines.push("```");

  return lines.join("\n");
}

/**
 * Get full knowledge graph export (nodes + edges + mermaid).
 */
export function getGraphExport(db: any, options?: { maxNodes?: number }): KumaGraphExport {
  const nodes = getNodes(db);
  const edges = getEdges(db);
  return {
    nodes,
    edges,
    mermaid: generateMermaid(nodes, edges, options),
  };
}
