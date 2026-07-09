// ============================================================
// KUMA MERMAID — Mermaid Visualization (Phase 5.3)
// ============================================================
// Generates Mermaid.js diagrams from the knowledge graph:
//   - Architecture diagram (module-level dependencies)
//   - Dependency graph (file-level imports/calls)
//   - Call graph (function-level)
//   - Ownership map (files by type/directory)
// ============================================================

import { getDb } from "./kumaDb.js";

type DiagramType = "architecture" | "dependencies" | "calls" | "ownership";

interface DiagramOptions {
  type: DiagramType;
  focus?: string;      // Node name to focus on
  depth?: number;       // How deep to traverse (default: 2)
  limit?: number;       // Max nodes to show (default: 20)
}

/**
 * Generate a Mermaid diagram based on the knowledge graph.
 */
export async function generateDiagram(options: DiagramOptions): Promise<string> {
  const { type, focus, depth = 2, limit = 20 } = options;
  const db = await getDb();

  try {
    switch (type) {
      case "architecture":
        return buildArchitectureDiagram(db, focus, depth, limit);
      case "dependencies":
        return buildDependencyDiagram(db, focus, depth, limit);
      case "calls":
        return buildCallGraph(db, focus, depth, limit);
      case "ownership":
        return buildOwnershipMap(db, focus, limit);
      default:
        return "⚠️ Unknown diagram type. Use: architecture, dependencies, calls, or ownership.";
    }
  } catch (err) {
    return `Error generating diagram: ${err}`;
  }
}

/**
 * Architecture diagram: module-level dependency structure.
 * Groups files by top-level directory and shows import relationships.
 */
async function buildArchitectureDiagram(
  db: Awaited<ReturnType<typeof getDb>>,
  focus?: string,
  _depth?: number,
  limit?: number,
): Promise<string> {
  // Get all file → file import edges
  const stmt = db.prepare(`
    SELECT DISTINCT e.source_id, e.target_id,
      s.name AS source_name, t.name AS target_name,
      s.file_path AS source_path, t.file_path AS target_path
    FROM edges e
    JOIN nodes s ON s.id = e.source_id
    JOIN nodes t ON t.id = e.target_id
    WHERE e.type = 'imports'
      AND s.type = 'file' AND t.type = 'file'
    LIMIT ?
  `);
  stmt.bind([limit]);
  const edges: Array<{ source: string; target: string; sourcePath: string; targetPath: string }> = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as Record<string, unknown>;
    edges.push({
      source: row.source_name as string,
      target: row.target_name as string,
      sourcePath: (row.source_path as string) || (row.source_name as string),
      targetPath: (row.target_path as string) || (row.target_name as string),
    });
  }
  stmt.free();

  if (edges.length === 0) {
    return "⚠️ No import relationships found. Use tools to build the knowledge graph (lsp_query, smart_grep).";
  }

  // Group into modules (top-level directories)
  const modules = new Set<string>();
  for (const e of edges) {
    modules.add(topDir(e.sourcePath));
    modules.add(topDir(e.targetPath));
  }

  // Build module-level edges
  const moduleEdges = new Set<string>();
  for (const e of edges) {
    const srcMod = topDir(e.sourcePath);
    const tgtMod = topDir(e.targetPath);
    if (srcMod !== tgtMod) {
      moduleEdges.add(`  ${mermaidId(srcMod)}["${srcMod}"] --> ${mermaidId(tgtMod)}["${tgtMod}"]`);
    }
  }

  // Handle focus: filter to edges connected to the focus module
  let filteredEdges: string[];
  if (focus && modules.has(focus)) {
    const focusId = mermaidId(focus);
    filteredEdges = [...moduleEdges].filter(e =>
      e.includes(focusId)
    );
  } else {
    filteredEdges = [...moduleEdges];
  }

  if (filteredEdges.length === 0) {
    // Show all modules as standalone nodes
    const allMods = [...modules].slice(0, 20).map(m => `  ${mermaidId(m)}["${m}"]`);
    return [
      "```mermaid",
      "graph LR",
      ...allMods,
      "```",
      "",
      "📊 **Architecture Diagram** — No cross-module dependencies found.",
      "Modules are shown as isolated components. Import edges will appear as the graph grows.",
    ].join("\n");
  }

  // Style subgraph for focused module
  const lines: string[] = ["```mermaid", "graph LR"];

  // Style definitions
  lines.push("  classDef default fill:#f0f4ff,stroke:#4a90d9,stroke-width:1px;");
  lines.push("  classDef focus fill:#fff3cd,stroke:#f0a030,stroke-width:2px;");

  // Nodes
  const shownMods = new Set<string>();
  for (const edge of filteredEdges) {
    const [_, src, tgt] = edge.match(/(\w+)\[.*\] --> (\w+)\[.*\]/) || [];
    if (src) shownMods.add(src);
    if (tgt) shownMods.add(tgt);
  }

  for (const mod of shownMods) {
    const isFocus = focus && (mod === mermaidId(focus));
    if (isFocus) {
      lines.push(`  ${mod}["${focus}"]:::focus`);
    }
  }

  lines.push(...filteredEdges);
  lines.push("```");

  return [
    ...lines,
    "",
    `📊 **Architecture Diagram** — ${filteredEdges.length} module dependency(ies)`,
    focus ? `🎯 Focus: \`${focus}\` module` : "",
    "💡 Modules are derived from import relationships in the knowledge graph.",
  ].filter(Boolean).join("\n");
}

/**
 * Dependency diagram: file-level import/call relationships.
 */
async function buildDependencyDiagram(
  db: Awaited<ReturnType<typeof getDb>>,
  focus?: string,
  _depth?: number,
  limit?: number,
): Promise<string> {
  // Find focus node
  let focusId: string | undefined;
  if (focus) {
    const nodeStmt = db.prepare(`SELECT id FROM nodes WHERE name LIKE ? OR id LIKE ? LIMIT 1`);
    nodeStmt.bind([`%${focus}%`, `%${focus}%`]);
    if (nodeStmt.step()) {
      focusId = (nodeStmt.getAsObject() as Record<string, unknown>).id as string;
    }
    nodeStmt.free();
  }

  // Get edges (imports and depends_on)
  const edgeStmt = focusId
    ? db.prepare(`
        SELECT DISTINCT e.type, e.source_id, e.target_id,
          s.name AS src_name, t.name AS tgt_name,
          s.type AS src_type, t.type AS tgt_type
        FROM edges e
        JOIN nodes s ON s.id = e.source_id
        JOIN nodes t ON t.id = e.target_id
        WHERE (e.source_id = ? OR e.target_id = ?)
          AND e.type IN ('imports', 'depends_on', 'calls')
        LIMIT ?
      `)
    : db.prepare(`
        SELECT DISTINCT e.type, e.source_id, e.target_id,
          s.name AS src_name, t.name AS tgt_name,
          s.type AS src_type, t.type AS tgt_type
        FROM edges e
        JOIN nodes s ON s.id = e.source_id
        JOIN nodes t ON t.id = e.target_id
        WHERE e.type IN ('imports', 'depends_on', 'calls')
        LIMIT ?
      `);

  if (focusId) {
    edgeStmt.bind([focusId, focusId, limit]);
  } else {
    edgeStmt.bind([limit]);
  }

  const nodes = new Set<string>();
  const mermaidEdges: string[] = [];

  while (edgeStmt.step()) {
    const row = edgeStmt.getAsObject() as Record<string, unknown>;
    const srcName = (row.src_name as string).substring(0, 25);
    const tgtName = (row.tgt_name as string).substring(0, 25);
    const srcId = mermaidId(srcName);
    const tgtId = mermaidId(tgtName);
    nodes.add(srcId);
    nodes.add(tgtId);

    const arrow = row.type === "imports" ? "-.->" : row.type === "depends_on" ? "-.->" : "-->";
    const label = row.type as string;
    mermaidEdges.push(`  ${srcId}["${srcName}"] ${arrow}|${label}| ${tgtId}["${tgtName}"]`);
  }
  edgeStmt.free();

  if (nodes.size === 0) {
    return "⚠️ No dependency relationships found. Build the knowledge graph first.";
  }

  const lines: string[] = [
    "```mermaid",
    "graph LR",
    "  classDef default fill:#f9f9ff,stroke:#666,stroke-width:1px;",
    ...mermaidEdges.slice(0, limit),
    "```",
    "",
    `📊 **Dependency Diagram** — ${mermaidEdges.length} relationship(s)${focus ? ` focused on "${focus}"` : ""}`,
    "💡 Solid arrow = calls, Dotted arrow = imports/depends_on",
  ];

  return lines.join("\n");
}

/**
 * Call graph: function-level call relationships.
 */
async function buildCallGraph(
  db: Awaited<ReturnType<typeof getDb>>,
  focus?: string,
  _depth?: number,
  limit?: number,
): Promise<string> {
  // Find focus function
  let focusId: string | undefined;
  if (focus) {
    const nodeStmt = db.prepare(`SELECT id FROM nodes WHERE (name LIKE ? OR id LIKE ?) AND type = 'function' LIMIT 1`);
    nodeStmt.bind([`%${focus}%`, `%${focus}%`]);
    if (nodeStmt.step()) {
      focusId = (nodeStmt.getAsObject() as Record<string, unknown>).id as string;
    }
    nodeStmt.free();
  }

  const edgeStmt = focusId
    ? db.prepare(`
        SELECT DISTINCT s.name AS src_name, t.name AS tgt_name
        FROM edges e
        JOIN nodes s ON s.id = e.source_id
        JOIN nodes t ON t.id = e.target_id
        WHERE (e.source_id = ? OR e.target_id = ?)
          AND e.type = 'calls'
          AND s.type IN ('function', 'class', 'interface')
          AND t.type IN ('function', 'class', 'interface')
        LIMIT ?
      `)
    : db.prepare(`
        SELECT DISTINCT s.name AS src_name, t.name AS tgt_name
        FROM edges e
        JOIN nodes s ON s.id = e.source_id
        JOIN nodes t ON t.id = e.target_id
        WHERE e.type = 'calls'
          AND s.type IN ('function', 'class', 'interface')
          AND t.type IN ('function', 'class', 'interface')
        LIMIT ?
      `);

  if (focusId) {
    edgeStmt.bind([focusId, focusId, limit]);
  } else {
    edgeStmt.bind([limit]);
  }

  const nodes = new Set<string>();
  const mermaidEdges: string[] = [];

  while (edgeStmt.step()) {
    const row = edgeStmt.getAsObject() as Record<string, unknown>;
    const srcName = (row.src_name as string).substring(0, 25);
    const tgtName = (row.tgt_name as string).substring(0, 25);
    const srcId = mermaidId(srcName);
    const tgtId = mermaidId(tgtName);
    nodes.add(srcId);
    nodes.add(tgtId);
    mermaidEdges.push(`  ${srcId}["${srcName}"] --> ${tgtId}["${tgtName}"]`);
  }
  edgeStmt.free();

  if (nodes.size === 0) {
    return "⚠️ No function call relationships found. Use lsp_query to discover function references.";
  }

  const lines: string[] = [
    "```mermaid",
    "graph TD",
    "  classDef default fill:#e8f4e8,stroke:#2d8a2d,stroke-width:1px;",
    ...mermaidEdges.slice(0, limit),
    "```",
    "",
    `📊 **Call Graph** — ${mermaidEdges.length} call relationship(s)${focus ? ` focused on "${focus}"` : ""}`,
    "💡 Use kuma_navigate with 'how does X work' for detailed flow analysis.",
  ];

  return lines.join("\n");
}

/**
 * Ownership map: files grouped by type/directory with activity indicators.
 */
async function buildOwnershipMap(
  db: Awaited<ReturnType<typeof getDb>>,
  focus?: string,
  limit?: number,
): Promise<string> {
  // Get file nodes grouped by top-level directory
  const stmt = db.prepare(`
    SELECT name, file_path, type FROM nodes
    WHERE type IN ('file', 'module', 'function')
      AND file_path IS NOT NULL
    LIMIT ?
  `);
  stmt.bind([limit ? limit * 5 : 100]);

  const dirGroups = new Map<string, string[]>();
  while (stmt.step()) {
    const row = stmt.getAsObject() as Record<string, unknown>;
    const path = (row.file_path as string) || (row.name as string);
    const dir = topDir(path);
    if (focus && !path.includes(focus)) continue;
    if (!dirGroups.has(dir)) dirGroups.set(dir, []);
    const existing = dirGroups.get(dir)!;
    const emoji = row.type === "function" ? "🔧" : row.type === "file" ? "📄" : "📌";
    existing.push(`${emoji} ${row.name}`);
  }
  stmt.free();

  if (dirGroups.size === 0) {
    return "⚠️ No file nodes found. Build the knowledge graph first.";
  }

  // Mermaid subgraph format: each directory is a subgraph
  const lines: string[] = ["```mermaid", "graph LR"];

  for (const [dir, items] of dirGroups) {
    const dirId = mermaidId(`dir_${dir}`);
    lines.push(`  subgraph ${dirId}["${dir}"]`);
    for (const item of items.slice(0, 8)) {
      const itemId = mermaidId(item.replace(/[^a-zA-Z0-9]/g, "_"));
      lines.push(`    ${itemId}["${item.replace(/\*\*/g, "").substring(0, 20)}"]`);
    }
    if (items.length > 8) {
      lines.push(`    _${dirId}_["... +${items.length - 8} more"]`);
    }
    lines.push("  end");
  }

  lines.push("```");

  return [
    ...lines,
    "",
    `📊 **Ownership Map** — ${dirGroups.size} module(s)`,
    focus ? `🎯 Focus: \`${focus}\`` : "",
    "💡 Each subgraph represents a top-level module with its key files/functions.",
  ].filter(Boolean).join("\n");
}

/**
 * Get the top-level directory from a file path.
 */
function topDir(filePath: string): string {
  const parts = filePath.replace(/\\/g, "/").split("/");
  return parts[0] || filePath;
}

/**
 * Create a Mermaid-safe ID from a name.
 */
function mermaidId(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/^(\d)/, "_$1")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .substring(0, 25)
    || "_node";
}
