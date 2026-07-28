// ============================================================
// KUMA VISUALIZE — Knowledge Graph Visualizer (Issue #16)
// ============================================================
// Generates Mermaid diagram text from the knowledge graph.
// Can produce: flowcharts, dependency graphs, class diagrams.
// Output can be rendered by any Mermaid-compatible viewer.
// ============================================================

import { getDb } from "./kumaDb.js";

export type DiagramType = "flowchart" | "dependency" | "mindmap";

export interface VisualizeOptions {
  type?: DiagramType;
  scope?: string; // filter by scope/node name
  maxNodes?: number;
  depth?: number;
  format?: "mermaid" | "markdown";
}

/**
 * Generate a Mermaid diagram from the knowledge graph.
 */
export async function visualizeGraph(
  options: VisualizeOptions = {},
): Promise<string> {
  const {
    type = "flowchart",
    scope,
    maxNodes = 30,
    // depth unused: kept for API consistency
    format = "mermaid",
  } = options;

  try {
    const db = await getDb();

    // Fetch nodes (optionally filtered by scope)
    let nodeSql = `SELECT id, type, name, file_path FROM nodes WHERE 1=1`;
    const nodeBind: unknown[] = [];

    if (scope) {
      nodeSql += ` AND (name LIKE ? OR file_path LIKE ? OR id LIKE ?)`;
      nodeBind.push(`%${scope}%`, `%${scope}%`, `%${scope}%`);
    }
    nodeSql += ` ORDER BY updated_at DESC LIMIT ?`;
    nodeBind.push(maxNodes);

    const nodeStmt = db.prepare(nodeSql);
    nodeStmt.bind(nodeBind);
    const nodes: Array<Record<string, unknown>> = [];
    while (nodeStmt.step()) {
      nodes.push(nodeStmt.getAsObject());
    }
    nodeStmt.free();

    if (nodes.length === 0) {
      return format === "mermaid"
        ? "```mermaid\nflowchart TD\n  Start[Empty Graph — No nodes found]\n```"
        : "📭 **Empty Graph** — No nodes found to visualize.";
    }

    // Fetch edges between these nodes
    const nodeIds = nodes.map((n) => n.id as string);
    const edgeSql = `
      SELECT e.source_id, e.target_id, e.type, e.weight,
        sn.name AS source_name, tn.name AS target_name
      FROM edges e
      JOIN nodes sn ON sn.id = e.source_id
      JOIN nodes tn ON tn.id = e.target_id
      WHERE (e.source_id IN (${nodeIds.map(() => "?").join(",")})
         OR e.target_id IN (${nodeIds.map(() => "?").join(",")}))
        AND e.source_id != e.target_id
      ORDER BY e.weight DESC
      LIMIT 100
    `;
    const edgeBind = [...nodeIds, ...nodeIds];
    const edgeStmt = db.prepare(edgeSql);
    edgeStmt.bind(edgeBind);
    const edges: Array<Record<string, unknown>> = [];
    while (edgeStmt.step()) {
      edges.push(edgeStmt.getAsObject());
    }
    edgeStmt.free();

    switch (type) {
      case "flowchart":
        return formatFlowchart(nodes, edges, format);
      case "dependency":
        return formatDependencyGraph(nodes, edges, format);
      case "mindmap":
        return formatMindMap(nodes, edges, format);
      default:
        return formatFlowchart(nodes, edges, format);
    }
  } catch (err) {
    return `Error generating visualization: ${err}`;
  }
}

// ============================================================
// FORMATTERS
// ============================================================

/**
 * Generate a flowchart-style Mermaid diagram.
 */
function formatFlowchart(
  nodes: Array<Record<string, unknown>>,
  edges: Array<Record<string, unknown>>,
  _format: "mermaid" | "markdown",
): string {
  void _format; // unused but kept for API consistency
  const lines: string[] = ["```mermaid", "flowchart TD"];

  // Add node definitions
  for (const node of nodes) {
    const id = sanitizeId(node.id as string);
    const name = truncate(node.name as string, 30);
    const nodeType = node.type as string;
    const shape = getNodeShape(nodeType);

    if (shape) {
      lines.push(`  ${id}${shape}${name}${reverseShape(shape)}`);
    } else {
      lines.push(`  ${id}[${name}]`);
    }
  }

  // Add edge definitions
  for (const edge of edges) {
    const sourceId = sanitizeId(edge.source_id as string);
    const targetId = sanitizeId(edge.target_id as string);
    const edgeType = edge.type as string;
    void (edge.weight as number); // weight unused but available for future use
    const label = truncate(edgeType, 15);

    // Different line styles based on edge type
    const edgeStyle = getEdgeStyle(edgeType);
    lines.push(`  ${sourceId}${edgeStyle}|${label}|${targetId}`);
  }

  lines.push("```");
  return lines.join("\n");
}

/**
 * Generate a dependency-style graph (subgraph clusters by type).
 */
function formatDependencyGraph(
  nodes: Array<Record<string, unknown>>,
  edges: Array<Record<string, unknown>>,
  _format: "mermaid" | "markdown",
): string {
  void _format; // unused but kept for API consistency
  const lines: string[] = ["```mermaid", "flowchart LR"];

  // Group nodes by type
  const grouped = new Map<string, Array<Record<string, unknown>>>();
  for (const node of nodes) {
    const type = (node.type as string) || "unknown";
    if (!grouped.has(type)) grouped.set(type, []);
    grouped.get(type)!.push(node);
  }

  // Render subgraphs for each type
  let subgraphIndex = 0;
  for (const [type, typeNodes] of grouped) {
    if (typeNodes.length < 1) continue;
    lines.push(`  subgraph ${type.toUpperCase()}[${type.toUpperCase()}]`);
    for (const node of typeNodes) {
      const id = sanitizeId(node.id as string);
      const name = truncate(node.name as string, 25);
      lines.push(`    ${id}(${name})`);
    }
    lines.push("  end");
    subgraphIndex++;
  }

  // Add cross-type edges
  for (const edge of edges) {
    const sourceId = sanitizeId(edge.source_id as string);
    const targetId = sanitizeId(edge.target_id as string);
    const edgeType = edge.type as string;
    const style = getEdgeStyle(edgeType);
    lines.push(`  ${sourceId}${style}|${edgeType}|${targetId}`);
  }

  lines.push("```");
  return lines.join("\n");
}

/**
 * Generate a mindmap-style diagram.
 */
function formatMindMap(
  nodes: Array<Record<string, unknown>>,
  edges: Array<Record<string, unknown>>,
  _format: "mermaid" | "markdown",
): string {
  void _format; // unused but kept for API consistency
  const lines: string[] = ["```mermaid", "mindmap"];

  // Find root nodes (no incoming edges)
  const hasIncoming = new Set<string>();
  for (const edge of edges) {
    hasIncoming.add(edge.target_id as string);
  }

  const roots = nodes.filter(n => !hasIncoming.has(n.id as string));

  if (roots.length === 0 && nodes.length > 0) {
    // Pick first node as root
    const root = nodes[0];
    lines.push(`  root((${truncate(root.name as string, 25)}))`);
    for (const node of nodes.slice(1)) {
      lines.push(`    ${sanitizeId(node.id as string)}(${truncate(node.name as string, 25)})`);
    }
  } else {
    for (const root of roots.slice(0, 3)) {
      lines.push(`  root((${truncate(root.name as string, 25)}))`);
    }
    // Add remaining as branches
    const others = nodes.filter(n => !roots.includes(n));
    for (const node of others.slice(0, 10)) {
      const parent = edges.find(e => e.source_id === node.id || e.target_id === node.id);
      const indent = parent ? "    " : "  ";
      lines.push(`${indent}${sanitizeId(node.id as string)}(${truncate(node.name as string, 25)})`);
    }
  }

  lines.push("```");
  return lines.join("\n");
}

// ============================================================
// HELPERS
// ============================================================

function sanitizeId(id: string): string {
  const safe = id
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/^(\d)/, "n$1")
    .substring(0, 40);
  // 🔧 FIX: Prevent empty Mermaid IDs (Issue #16 code review)
  return safe || "n0";
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen - 3) + "...";
}

function getNodeShape(type: string): string {
  switch (type) {
    case "function": return "([";
    case "file": return "[";
    case "test": return "{";
    case "api_route": return "[[";
    case "db_table": return ">"; // database shape approximation
    case "class": return "[";
    case "interface": return "(";
    case "module": return "[";
    case "variable": return "(";
    // Domain Flow shapes (V4)
    case "feature_domain": return "[";  // box with rounded corners
    case "workflow": return "([";        // stadium shape
    case "cross_service_link": return "[";
    default: return "[";
  }
}

function reverseShape(shape: string): string {
  const map: Record<string, string> = {
    "([": "])",
    "[": "]",
    "{": "}",
    "[[": "]]",
    ">": "<]",
    "(": ")",
  };
  return map[shape] || "]";
}

function getEdgeStyle(type: string): string {
  switch (type) {
    case "calls": return " ==> ";
    case "imports": return " -.-> ";
    case "defines": return " --- ";
    case "tests": return " -.-> ";
    case "routes": return " ==> ";
    case "implements": return " -.-> ";
    case "extends": return " ==> ";
    case "depends_on": return " -.-> ";
    case "owns": return " --- ";
    case "modified_by": return " -.-> ";
    // Domain Flow edge styles (V4)
    case "flows_through": return " ==> ";
    case "triggers": return " -.-> ";
    case "syncs_with": return " <==> ";
    default: return " --- ";
  }
}

/**
 * Generate a markdown report with a link to view the diagram.
 */
export async function generateVisualizeReport(options: VisualizeOptions = {}): Promise<string> {
  const diagram = await visualizeGraph(options);

  const lines: string[] = [
    "🎨 **Knowledge Graph Visualization**",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
    diagram,
    "",
    "📋 **Rendering Instructions:**",
    "- Paste the Mermaid code above into any Mermaid-compatible viewer",
    "- GitHub: Mermaid code blocks render automatically",
    "- VS Code: Install 'Markdown Preview Mermaid Support' extension",
    "- Online: https://mermaid.live",
    "",
    "💡 Use `kuma_visualize({ type: 'dependency' })` for clustered view",
    "💡 Use `kuma_visualize({ type: 'mindmap' })` for overview",
    "💡 Use `kuma_visualize({ scope: 'auth' })` to filter by topic",
  ];

  return lines.join("\n");
}
