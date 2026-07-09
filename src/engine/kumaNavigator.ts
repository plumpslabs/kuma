// ============================================================
// KUMA NAVIGATOR — AI Navigation (Phase 5.1)
// ============================================================
// Answers questions about codebase structure using the
// knowledge graph: "how does X work?", "who uses Y?",
// "what's the flow for Z?"
// ============================================================

import { getDb } from "./kumaDb.js";

interface NavResult {
  type: "flow" | "references" | "dependencies" | "structure" | "error";
  title: string;
  sections: Array<{ heading: string; items: string[] }>;
  mermaid?: string;
}

/**
 * Parse a natural language query and route to the right analysis.
 */
export async function navigate(query: string): Promise<string> {
  try {
    const q = query.toLowerCase().trim();

    // "how does X work?" → trace call chain
    const howMatch = q.match(/how does (.+?) work/i) || q.match(/how (\w+) works/i);
    if (howMatch) {
      const funcName = (howMatch[1] || howMatch[2] || "").trim();
      if (funcName) return formatResult(await traceCallChain(funcName));
    }

    // "who uses X?" or "who calls X?" → find references
    const whoMatch = q.match(/who (?:uses|calls|invokes|references) (.+)/i);
    if (whoMatch && whoMatch[1]) {
      return formatResult(await findReferences(whoMatch[1]));
    }

    // "what does X depend on?" or "dependencies of X"
    const depMatch = q.match(/(?:what does|dependencies of|depends on) (.+)/i);
    if (depMatch && depMatch[1]) {
      return formatResult(await findDependencies(depMatch[1]));
    }

    // "what's the flow for X?" or "flow of X"
    const flowMatch = q.match(/(?:flow|pipeline|chain|sequence) (?:for|of) (.+)/i);
    if (flowMatch && flowMatch[1]) {
      return formatResult(await traceCallChain(flowMatch[1]));
    }

    // "show structure of X" or "structure X"
    const structMatch = q.match(/(?:show |)structure (?:of |)(.+)/i);
    if (structMatch && structMatch[1]) {
      return formatResult(await showStructure(structMatch[1]));
    }

    // Default: search the graph and show what's found
    return formatResult(await searchEverything(query));
  } catch (err) {
    return `Error navigating: ${err}`;
  }
}

/**
 * Trace a function/entity's call chain: who calls it, who it calls.
 */
async function traceCallChain(entityName: string): Promise<NavResult> {
  const db = await getDb();

  // Find the node
  const nodeStmt = db.prepare(`
    SELECT id, type, name, file_path FROM nodes
    WHERE name LIKE ? OR name = ? OR id LIKE ?
    ORDER BY CASE WHEN name = ? THEN 0 WHEN name LIKE ? THEN 1 ELSE 2 END
    LIMIT 1
  `);
  nodeStmt.bind([`%${entityName}%`, entityName, `%${entityName}%`, entityName, `${entityName}%`]);
  const node: Record<string, unknown> | null = nodeStmt.step() ? nodeStmt.getAsObject() : null;
  nodeStmt.free();

  if (!node) {
    return {
      type: "error",
      title: `"${entityName}" not found in knowledge graph`,
      sections: [{
        heading: "Try a different search term",
        items: ["The knowledge graph is built from AI tool calls.", "Use tools like smart_grep, lsp_query, or precise_diff_editor to populate it first."],
      }],
    };
  }

  const nodeId = node.id as string;
  const sections: Array<{ heading: string; items: string[] }> = [];

  // 1. What this function calls (outgoing edges)
  const outgoingStmt = db.prepare(`
    SELECT e.type, e.target_id, n.name AS target_name, n.type AS target_type, n.file_path AS target_path
    FROM edges e
    LEFT JOIN nodes n ON n.id = e.target_id
    WHERE e.source_id = ?
    ORDER BY e.weight DESC
    LIMIT 15
  `);
  outgoingStmt.bind([nodeId]);
  const outgoing: string[] = [];
  while (outgoingStmt.step()) {
    const row = outgoingStmt.getAsObject() as Record<string, unknown>;
    const emoji = row.type === "calls" ? "➡️" : row.type === "imports" ? "📥" : row.type === "routes" ? "🌐" : "🔗";
    outgoing.push(`${emoji} **${row.target_name}** (${row.target_type}) — ${row.type}${row.target_path ? ` @ ${row.target_path}` : ""}`);
  }
  outgoingStmt.free();
  if (outgoing.length > 0) sections.push({ heading: "Calls / Depends On", items: outgoing });

  // 2. Who calls this (incoming edges)
  const incomingStmt = db.prepare(`
    SELECT e.type, e.source_id, n.name AS source_name, n.type AS source_type, n.file_path AS source_path
    FROM edges e
    LEFT JOIN nodes n ON n.id = e.source_id
    WHERE e.target_id = ?
    ORDER BY e.weight DESC
    LIMIT 15
  `);
  incomingStmt.bind([nodeId]);
  const incoming: string[] = [];
  while (incomingStmt.step()) {
    const row = incomingStmt.getAsObject() as Record<string, unknown>;
    const emoji = row.type === "calls" ? "⬅️" : row.type === "imports" ? "📤" : row.type === "tests" ? "🧪" : "🔗";
    incoming.push(`${emoji} **${row.source_name}** (${row.source_type}) — ${row.type}${row.source_path ? ` @ ${row.source_path}` : ""}`);
  }
  incomingStmt.free();
  if (incoming.length > 0) sections.push({ heading: "Called By / Used By", items: incoming });

  const typeEmoji = node.type === "function" ? "🔧" : node.type === "file" ? "📄" : node.type === "class" ? "🏗️" : "📌";

  const nodeName = node.name as string;
  const mermaidLines = ["```mermaid", "graph LR"];
  mermaidLines.push(`  ${sanitizeId(nodeName)}["${nodeName}"]`);
  for (const item of outgoing) {
    const match = item.match(/\*\*(.+?)\*\*/);
    if (match && match[1]) mermaidLines.push(`  ${sanitizeId(nodeName)} --> ${sanitizeId(match[1])}["${match[1]}"]`);
  }
  for (const item of incoming) {
    const match = item.match(/\*\*(.+?)\*\*/);
    if (match && match[1]) mermaidLines.push(`  ${sanitizeId(match[1])}["${match[1]}"] --> ${sanitizeId(nodeName)}`);
  }
  mermaidLines.push("```");

  return {
    type: "flow",
    title: `${typeEmoji} **${node.name}** — Flow Analysis`,
    sections,
    mermaid: mermaidLines.join("\n"),
  };
}

/**
 * Find all references to a function/entity.
 */
async function findReferences(entityName: string): Promise<NavResult> {
  const db = await getDb();

  // Search for nodes matching the entity
  const nodeStmt = db.prepare(`
    SELECT id, type, name, file_path FROM nodes
    WHERE name LIKE ? OR name = ?
    ORDER BY CASE WHEN name = ? THEN 0 ELSE 1 END
    LIMIT 5
  `);
  nodeStmt.bind([`%${entityName}%`, entityName, entityName]);
  const nodes: Array<Record<string, unknown>> = [];
  while (nodeStmt.step()) nodes.push(nodeStmt.getAsObject());
  nodeStmt.free();

  if (nodes.length === 0) {
    return {
      type: "error",
      title: `"${entityName}" not found in knowledge graph`,
      sections: [{ heading: "No references found", items: ["Try a different search term or use smart_grep to find usages."] }],
    };
  }

  const sections: Array<{ heading: string; items: string[] }> = [];

  for (const node of nodes) {
    const nodeId = node.id as string;
    const typeEmoji = node.type === "function" ? "🔧" : node.type === "class" ? "🏗️" : node.type === "api_route" ? "🌐" : "📌";

    const refStmt = db.prepare(`
      SELECT e.type, e.source_id, n.name AS source_name, n.type AS source_type, n.file_path AS source_path
      FROM edges e
      LEFT JOIN nodes n ON n.id = e.source_id
      WHERE e.target_id = ?
      ORDER BY e.weight DESC
      LIMIT 20
    `);
    refStmt.bind([nodeId]);
    const refs: string[] = [];
    while (refStmt.step()) {
      const row = refStmt.getAsObject() as Record<string, unknown>;
      refs.push(`  • **${row.source_name}** (${row.source_type}) — ${row.type}${row.source_path ? ` @ ${row.source_path}` : ""}`);
    }
    refStmt.free();

    if (refs.length > 0) {
      sections.push({
        heading: `${typeEmoji} ${node.name} (${node.type}) — ${refs.length} reference(s)`,
        items: refs,
      });
    } else {
      sections.push({
        heading: `${typeEmoji} ${node.name} (${node.type}) — No references yet`,
        items: ["Knowledge graph may not have captured relationships for this entity yet."],
      });
    }
  }

  return { type: "references", title: `🔍 References for "${entityName}"`, sections };
}

/**
 * Find what a file/module depends on.
 */
async function findDependencies(entityName: string): Promise<NavResult> {
  const db = await getDb();

  const nodeStmt = db.prepare(`
    SELECT id, type, name, file_path FROM nodes
    WHERE name LIKE ? OR name = ? OR id LIKE ?
    LIMIT 1
  `);
  nodeStmt.bind([`%${entityName}%`, entityName, `%${entityName}%`]);
  const node: Record<string, unknown> | null = nodeStmt.step() ? nodeStmt.getAsObject() : null;
  nodeStmt.free();

  if (!node) {
    return {
      type: "error",
      title: `"${entityName}" not found`,
      sections: [{ heading: "Not in knowledge graph", items: ["Use tools to build the graph first (smart_grep, lsp_query)."] }],
    };
  }

  const nodeId = node.id as string;

  // Dependencies (outgoing edges with types)
  const depStmt = db.prepare(`
    SELECT DISTINCT e.type, e.target_id, n.name AS dep_name, n.type AS dep_type
    FROM edges e
    LEFT JOIN nodes n ON n.id = e.target_id
    WHERE e.source_id = ?
    ORDER BY e.type
  `);
  depStmt.bind([nodeId]);
  const deps: Record<string, string[]> = {};
  while (depStmt.step()) {
    const row = depStmt.getAsObject() as Record<string, unknown>;
    const t = row.type as string;
    if (!deps[t]) deps[t] = [];
    deps[t].push(`**${row.dep_name}** (${row.dep_type})`);
  }
  depStmt.free();

  const sections: Array<{ heading: string; items: string[] }> = [];
  for (const [type, items] of Object.entries(deps)) {
    const emoji = type === "calls" ? "➡️" : type === "imports" ? "📥" : type === "routes" ? "🌐" : type === "defines" ? "📝" : type === "depends_on" ? "🔗" : "📌";
    sections.push({ heading: `${emoji} ${type} (${items.length})`, items });
  }

  if (sections.length === 0) {
    sections.push({ heading: "No dependencies recorded", items: ["Use more tools to build the knowledge graph."] });
  }

  return { type: "dependencies", title: `🔗 Dependencies of "${node.name}"`, sections };
}

/**
 * Show the structure of a file or module.
 */
async function showStructure(entityName: string): Promise<NavResult> {
  const db = await getDb();

  const nodeStmt = db.prepare(`
    SELECT id, type, name, file_path, metadata FROM nodes
    WHERE (type = 'file' OR type = 'module') AND (name LIKE ? OR name = ?)
    LIMIT 1
  `);
  nodeStmt.bind([`%${entityName}%`, entityName]);
  const node: Record<string, unknown> | null = nodeStmt.step() ? nodeStmt.getAsObject() : null;
  nodeStmt.free();

  if (!node) {
    // If not a file/module, show as structure of entity
    return findDependencies(entityName);
  }

  const nodeId = node.id as string;

  // Things defined in this file
  const definedStmt = db.prepare(`
    SELECT n.name, n.type FROM edges e
    JOIN nodes n ON n.id = e.target_id
    WHERE e.source_id = ? AND e.type = 'defines'
    ORDER BY n.name
  `);
  definedStmt.bind([nodeId]);
  const defined: string[] = [];
  while (definedStmt.step()) {
    const row = definedStmt.getAsObject() as Record<string, unknown>;
    const emoji = row.type === "function" ? "🔧" : row.type === "class" ? "🏗️" : row.type === "interface" ? "📐" : row.type === "type" ? "📌" : "📄";
    defined.push(`  ${emoji} **${row.name}** (${row.type})`);
  }
  definedStmt.free();

  // What this file imports
  const importsStmt = db.prepare(`
    SELECT n.name, n.type FROM edges e
    JOIN nodes n ON n.id = e.target_id
    WHERE e.source_id = ? AND e.type = 'imports'
    ORDER BY n.name
  `);
  importsStmt.bind([nodeId]);
  const imports: string[] = [];
  while (importsStmt.step()) {
    const row = importsStmt.getAsObject() as Record<string, unknown>;
    imports.push(`  📥 **${row.name}** (${row.type})`);
  }
  importsStmt.free();

  const sections: Array<{ heading: string; items: string[] }> = [];

  if (defined.length > 0) sections.push({ heading: "Defines", items: defined });
  if (imports.length > 0) sections.push({ heading: "Imports", items: imports });
  if (sections.length === 0) sections.push({ heading: "No structure data", items: ["Use tools to build the knowledge graph (lsp_query to find definitions)."] });

  return { type: "structure", title: `📁 Structure of "${node.name}"`, sections };
}

/**
 * Default: search everything and summarize.
 */
async function searchEverything(query: string): Promise<NavResult> {
  const db = await getDb();

  // Search nodes
  const nodeStmt = db.prepare(`
    SELECT id, type, name, file_path FROM nodes
    WHERE name LIKE ? OR file_path LIKE ? OR id LIKE ?
    LIMIT 15
  `);
  nodeStmt.bind([`%${query}%`, `%${query}%`, `%${query}%`]);
  const nodes: string[] = [];
  while (nodeStmt.step()) {
    const row = nodeStmt.getAsObject() as Record<string, unknown>;
    const emoji = row.type === "function" ? "🔧" : row.type === "file" ? "📄" : row.type === "test" ? "🧪" : row.type === "api_route" ? "🌐" : row.type === "class" ? "🏗️" : row.type === "interface" ? "📐" : row.type === "db_table" ? "🗄️" : "📌";
    nodes.push(`  ${emoji} **${row.name}** (${row.type})${row.file_path ? ` — ${row.file_path}` : ""}`);
  }
  nodeStmt.free();

  const sections: Array<{ heading: string; items: string[] }> = [];
  if (nodes.length > 0) {
    sections.push({ heading: `Related Nodes (${nodes.length})`, items: nodes });
  }

  sections.push({
    heading: "💡 Try a specific query",
    items: [
      `• "how does X work" — trace call chain`,
      `• "who uses X" — find all references`,
      `• "dependencies of X" — show what X depends on`,
      `• "flow of X" — trace the pipeline`,
      `• "structure of X" — show file/module contents`,
    ],
  });

  return { type: "structure", title: `🔍 Navigation Results for "${query}"`, sections };
}

/**
 * Format a NavResult as human-readable output.
 */
function formatResult(result: NavResult): string {
  const lines: string[] = [
    result.title,
    `━━━━━━━━━━━━━━━━━━━━━━━━━`,
    "",
  ];

  for (const section of result.sections) {
    lines.push(`**${section.heading}**`);
    for (const item of section.items) lines.push(item);
    lines.push("");
  }

  if (result.mermaid) {
    lines.push(result.mermaid, "");
  }

  lines.push("💡 Use kuma_graph_query for deeper graph exploration, or mermaid_diagram for visual output.");

  return lines.join("\n");
}

/**
 * Sanitize a name for use as a Mermaid node ID.
 */
function sanitizeId(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, "_").replace(/^(\d)/, "_$1").substring(0, 30) || "_unnamed";
}
