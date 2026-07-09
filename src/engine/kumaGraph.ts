// ============================================================
// KUMA GRAPH — Living Knowledge Graph engine
// ============================================================
// Builds incrementally from AI tool calls. Stored in SQLite.
// Every smart_grep, lsp_query, precise_diff_editor adds edges.

import { getDb, saveDb } from "./kumaDb.js";
import { healOnQuery } from "./kumaSelfHeal.js";

export type NodeType = "function" | "file" | "api_route" | "db_table" | "test" | "class" | "interface" | "type" | "module" | "variable";
export type EdgeType = "calls" | "imports" | "defines" | "tests" | "routes" | "implements" | "extends" | "depends_on" | "owns" | "modified_by";

interface GraphNode {
  id: string;
  type: NodeType;
  name: string;
  filePath?: string;
  metadata?: Record<string, unknown>;
}

interface GraphEdge {
  sourceId: string;
  targetId: string;
  type: EdgeType;
  weight?: number;
  metadata?: Record<string, unknown>;
}

interface GraphQuery {
  type?: "nodes" | "edges" | "paths";
  query: string;
  limit?: number;
}

/**
 * Generate a stable node ID from type and name.
 */
function nodeId(type: NodeType, name: string): string {
  return `${type}::${name}`;
}

/**
 * Add or update a node in the graph.
 */
export async function upsertNode(node: GraphNode): Promise<void> {
  try {
    const db = await getDb();
    const id = node.id || nodeId(node.type, node.name);
    const metadata = JSON.stringify(node.metadata ?? {});

    db.run(`
      INSERT INTO nodes (id, type, name, file_path, metadata, updated_at)
      VALUES (?, ?, ?, ?, ?, strftime('%s','now'))
      ON CONFLICT(id) DO UPDATE SET
        type = excluded.type,
        name = excluded.name,
        file_path = COALESCE(excluded.file_path, nodes.file_path),
        metadata = excluded.metadata,
        updated_at = strftime('%s','now')
    `, [id, node.type, node.name, node.filePath || null, metadata]);

    // Update FTS index
    try {
      db.run(`INSERT INTO nodes_fts (rowid, name, metadata) VALUES (last_insert_rowid(), ?, ?)`, [node.name, metadata]);
    } catch {
      // FTS might already have this rowid - ignore
    }

    saveDb(db);
  } catch (err) {
    console.error(`[KumaGraph] Failed to upsert node: ${err}`);
  }
}

/**
 * Add an edge between two nodes (creates nodes if they don't exist).
 */
export async function addEdge(edge: GraphEdge): Promise<void> {
  try {
    const db = await getDb();
    const weight = edge.weight ?? 1.0;
    const metadata = JSON.stringify(edge.metadata ?? {});

    db.run(`
      INSERT INTO edges (source_id, target_id, type, weight, metadata)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(source_id, target_id, type) DO UPDATE SET
        weight = edges.weight + 1,
        metadata = excluded.metadata
    `, [edge.sourceId, edge.targetId, edge.type, weight, metadata]);

    saveDb(db);
  } catch (err) {
    console.error(`[KumaGraph] Failed to add edge: ${err}`);
  }
}

/**
 * Record a function call relationship.
 * functionX → calls → functionY
 */
export async function recordFunctionCall(caller: string, callee: string, filePath?: string): Promise<void> {
  const callerId = nodeId("function", caller);
  const calleeId = nodeId("function", callee);

  await upsertNode({ id: callerId, type: "function", name: caller, filePath });
  await upsertNode({ id: calleeId, type: "function", name: callee });

  await addEdge({ sourceId: callerId, targetId: calleeId, type: "calls" });
}

/**
 * Record a file→function definition.
 * file → defines → function
 */
export async function recordFileDefinition(filePath: string, symbol: string, symbolType: NodeType = "function"): Promise<void> {
  const fileId = nodeId("file", filePath);
  const symbolId = nodeId(symbolType, symbol);

  await upsertNode({ id: fileId, type: "file", name: filePath });
  await upsertNode({ id: symbolId, type: symbolType, name: symbol, filePath });

  await addEdge({ sourceId: fileId, targetId: symbolId, type: "defines", metadata: { filePath } });
}

/**
 * Record a file import relationship.
 * fileA → imports → fileB
 */
export async function recordImport(fromFile: string, toFile: string): Promise<void> {
  const fromId = nodeId("file", fromFile);
  const toId = nodeId("file", toFile);

  await upsertNode({ id: fromId, type: "file", name: fromFile });
  await upsertNode({ id: toId, type: "file", name: toFile });

  await addEdge({ sourceId: fromId, targetId: toId, type: "imports" });
}

/**
 * Record a test→function relationship.
 * testFile → tests → function
 */
export async function recordTestRelation(testFile: string, functionName: string): Promise<void> {
  const testId = nodeId("test", testFile);
  const funcId = nodeId("function", functionName);

  await upsertNode({ id: testId, type: "test", name: testFile });
  await upsertNode({ id: funcId, type: "function", name: functionName });

  await addEdge({ sourceId: testId, targetId: funcId, type: "tests" });
}

/**
 * Record an API route handler.
 * apiRoute → routes → function
 */
export async function recordApiRoute(route: string, handler: string): Promise<void> {
  const routeId = nodeId("api_route", route);
  const handlerId = nodeId("function", handler);

  await upsertNode({ id: routeId, type: "api_route", name: route });
  await upsertNode({ id: handlerId, type: "function", name: handler });

  await addEdge({ sourceId: routeId, targetId: handlerId, type: "routes" });
}

/**
 * Query the knowledge graph.
 */
export async function queryGraph(params: GraphQuery): Promise<string> {
  try {
    const db = await getDb();
    const { type = "nodes", query, limit = 20 } = params;

    // Auto-heal: if query looks like a file path (no :: separator), check staleness
    if (query && !query.includes("::")) {
      try { await healOnQuery([query]); } catch { /* non-critical */ }
    }

    if (type === "nodes") {
      // Search nodes by name or type
      const stmt = db.prepare(`
        SELECT id, type, name, file_path, metadata FROM nodes
        WHERE name LIKE ? OR type = ?
        ORDER BY updated_at DESC
        LIMIT ?
      `);
      stmt.bind([`%${query}%`, query, limit]);
      const results: Array<Record<string, unknown>> = [];
      while (stmt.step()) {
        const row = stmt.getAsObject();
        results.push(row);
      }
      stmt.free();

      if (results.length === 0) {
        return `🔍 **Graph Query** — No nodes found for "${query}".\n\nTry a different search term or check if the graph has been built by using tools like smart_grep or lsp_query.`;
      }

      const lines: string[] = [
        `🔍 **Graph Nodes** — ${results.length} result(s) for "${query}"`,
        "",
      ];
      for (const r of results) {
        const typeEmoji =
          r.type === "function" ? "🔧" :
          r.type === "file" ? "📄" :
          r.type === "test" ? "🧪" :
          r.type === "api_route" ? "🌐" :
          r.type === "db_table" ? "🗄️" :
          r.type === "class" ? "🏗️" :
          "📌";
        lines.push(`${typeEmoji} **${r.name}** (${r.type})`);
        if (r.file_path) lines.push(`   📍 ${r.file_path}`);
      }
      lines.push("", "💡 Use kuma_graph_query({ type: 'edges', query: '<node_id>' }) to see connections.");
      return lines.join("\n");

    } else if (type === "edges") {
      // Find edges for a specific node
      const stmt = db.prepare(`
        SELECT e.type, e.weight,
          CASE WHEN e.source_id = ? THEN e.target_id ELSE e.source_id END AS connected_node,
          n.type AS connected_type, n.name AS connected_name, n.file_path AS connected_path
        FROM edges e
        LEFT JOIN nodes n ON n.id = (CASE WHEN e.source_id = ? THEN e.target_id ELSE e.source_id END)
        WHERE e.source_id = ? OR e.target_id = ?
        ORDER BY e.weight DESC
        LIMIT ?
      `);
      stmt.bind([query, query, query, query, limit]);
      const results: Array<Record<string, unknown>> = [];
      while (stmt.step()) {
        const row = stmt.getAsObject();
        results.push(row);
      }
      stmt.free();

      if (results.length === 0) {
        return `🔍 **Graph Edges** — No connections found for node "${query}".\n\nTry kuma_graph_query({ type: 'nodes', query: '<search>' }) to find node IDs first.`;
      }

      const lines: string[] = [
        `🔗 **Graph Edges** — ${results.length} connection(s) for "${query}"`,
        "",
      ];
      for (const r of results) {
        const edgeEmoji =
          r.type === "calls" ? "➡️" :
          r.type === "imports" ? "📥" :
          r.type === "defines" ? "📝" :
          r.type === "tests" ? "🧪" :
          r.type === "routes" ? "🌐" :
          "🔗";
        const typeLabel = r.connected_type ? ` (${r.connected_type})` : "";
        lines.push(`${edgeEmoji} **${r.connected_node}**${typeLabel} — ${r.type} (weight: ${r.weight})`);
        if (r.connected_path) lines.push(`   📍 ${r.connected_path}`);
      }
      return lines.join("\n");

    } else if (type === "paths") {
      // Find paths between two nodes (BFS, depth-limited)
      const parts = query.split("→").map((s) => s.trim());
      if (parts.length !== 2) {
        return `⚠️ For path queries, use format: "sourceNodeID → targetNodeID"\nExample: kuma_graph_query({ type: 'paths', query: 'function::login → function::validatePassword' })`;
      }

      const [sourceId, targetId] = parts;

      // Simple BFS pathfinding (max depth 10 to prevent runaway)
      const visited = new Set<string>();
      const maxDepth = 10;
      const queue: Array<{ nodeId: string; path: string[] }> = [{ nodeId: sourceId, path: [sourceId] }];
      visited.add(sourceId);

      let foundPath: string[] | null = null;
      while (queue.length > 0 && !foundPath && queue[0].path.length <= maxDepth) {
        const current = queue.shift()!;
        const stmt = db.prepare(`
          SELECT CASE WHEN source_id = ? THEN target_id ELSE source_id END AS neighbor
          FROM edges WHERE (source_id = ? OR target_id = ?)
        `);
        stmt.bind([current.nodeId, current.nodeId, current.nodeId]);
        while (stmt.step()) {
          const row = stmt.getAsObject() as Record<string, unknown>;
          const neighbor = row.neighbor as string;
          if (neighbor === targetId) {
            foundPath = [...current.path, neighbor];
            break;
          }
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push({ nodeId: neighbor, path: [...current.path, neighbor] });
          }
        }
        stmt.free();
      }

      if (!foundPath) {
        return `🔍 **Path Query** — No path found between "${sourceId}" and "${targetId}".\n\nThe two nodes may not be connected in the knowledge graph yet. Use more tools to build the graph.`;
      }

      // Get node names for the path
      const names: string[] = [];
      for (const nodeId of foundPath) {
        const stmt2 = db.prepare("SELECT name, type FROM nodes WHERE id = ?");
        stmt2.bind([nodeId]);
        if (stmt2.step()) {
          const row = stmt2.getAsObject() as Record<string, unknown>;
          names.push(`${row.name} (${row.type})`);
        } else {
          names.push(nodeId);
        }
        stmt2.free();
      }

      return [
        `🛤️ **Graph Path** — ${names.length} node(s)`,
        "",
        ...names.map((n, i) => `  ${i > 0 ? "→" : " "} ${n}`),
        "",
        "💡 This path was discovered by traversing the knowledge graph built from AI tool calls.",
      ].join("\n");
    }

    return `⚠️ Unknown query type "${type}". Use "nodes", "edges", or "paths".`;
  } catch (err) {
    return `Error querying graph: ${err}`;
  }
}

/**
 * Auto-build graph from session memory on init.
 * Replays recent tool calls to populate the graph.
 */
export async function buildFromSessionMemory(): Promise<number> {
  try {
    const { sessionMemory } = await import("./sessionMemory.js");
    const toolCalls = sessionMemory.getToolCallHistory(50);
    let edgeCount = 0;

    for (const call of toolCalls) {
      const params = call.params as Record<string, unknown>;

      if (call.toolName === "smart_grep") {
        // smart_grep(query → results) = search → file edges
        const query = params.query as string;
        const results = params.matchCount as number;
        if (query && results) {
          await upsertNode({
            id: `search::${query}`,
            type: "variable",
            name: `search:${query}`,
            metadata: { matches: results },
          });
          edgeCount++;
        }
      }

      if (call.toolName === "precise_diff_editor") {
        // precise_diff_editor(file) = modified → file edges
        const filePath = params.filePath as string;
        if (filePath) {
          await upsertNode({
            id: nodeId("file", filePath),
            type: "file",
            name: filePath,
          });
          edgeCount++;
        }
      }
    }

    return edgeCount;
  } catch {
    return 0;
  }
}

/**
 * Search the graph with full-text search.
 */
export async function searchGraph(query: string, limit: number = 20): Promise<string> {
  try {
    const db = await getDb();

    // Try FTS5 search first
    try {
      const stmt = db.prepare(`
        SELECT n.id, n.type, n.name, n.file_path
        FROM nodes_fts f
        JOIN nodes n ON n.rowid = f.rowid
        WHERE nodes_fts MATCH ?
        LIMIT ?
      `);
      stmt.bind([query, limit]);
      const results: Array<Record<string, unknown>> = [];
      while (stmt.step()) {
        results.push(stmt.getAsObject());
      }
      stmt.free();

      if (results.length > 0) {
        const lines: string[] = [
          `🔍 **Graph Search** — ${results.length} result(s) for "${query}"`,
          "",
        ];
        for (const r of results) {
          lines.push(`  • **${r.name}** (${r.type})${r.file_path ? ` — ${r.file_path}` : ""}`);
        }
        return lines.join("\n");
      }
    } catch {
      // FTS might not be available, fall through to LIKE query
    }

    // Fallback: LIKE search
    const stmt = db.prepare(`
      SELECT id, type, name, file_path FROM nodes
      WHERE name LIKE ? OR file_path LIKE ?
      ORDER BY updated_at DESC
      LIMIT ?
    `);
    stmt.bind([`%${query}%`, `%${query}%`, limit]);
    const results: Array<Record<string, unknown>> = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();

    if (results.length === 0) {
      return `🔍 **Graph Search** — No results for "${query}". Try a different search term.`;
    }

    const lines: string[] = [
      `🔍 **Graph Search** — ${results.length} result(s) for "${query}"`,
      "",
    ];
    for (const r of results) {
      lines.push(`  • **${r.name}** (${r.type})${r.file_path ? ` — ${r.file_path}` : ""}`);
    }

    return lines.join("\n");
  } catch (err) {
    return `Error searching graph: ${err}`;
  }
}

/**
 * Get graph statistics.
 */
export async function getGraphStats(): Promise<string> {
  try {
    const db = await getDb();

    const nodeCount = (db.exec("SELECT COUNT(*) as c FROM nodes"))[0]?.values[0][0] ?? 0;
    const edgeCount = (db.exec("SELECT COUNT(*) as c FROM edges"))[0]?.values[0][0] ?? 0;
    const typeCounts: Array<Record<string, unknown>> = [];
    try {
      const stmt = db.prepare("SELECT type, COUNT(*) as cnt FROM nodes GROUP BY type ORDER BY cnt DESC");
      while (stmt.step()) {
        typeCounts.push(stmt.getAsObject());
      }
      stmt.free();
    } catch {}

    const lines: string[] = [
      `📊 **Knowledge Graph Stats**`,
      `━━━━━━━━━━━━━━━━━━━━━━━━`,
      "",
      `📊 **${nodeCount} nodes** | **${edgeCount} edges**`,
      "",
    ];

    if (typeCounts.length > 0) {
      lines.push("**Node Types:**");
      for (const t of typeCounts) {
        const emoji =
          t.type === "function" ? "🔧" :
          t.type === "file" ? "📄" :
          t.type === "test" ? "🧪" :
          t.type === "api_route" ? "🌐" :
          t.type === "db_table" ? "🗄️" :
          t.type === "class" ? "🏗️" :
          "📌";
        lines.push(`  ${emoji} ${t.type}: ${t.cnt}`);
      }
    }

    lines.push(
      "",
      "💡 Nodes are built incrementally from tool calls:",
      "  • smart_grep → search nodes",
      "  • lsp_query → function + call edges",
      "  • precise_diff_editor → file modification edges",
      "  • kuma_risk → reference nodes",
    );

    return lines.join("\n");
  } catch (err) {
    return `Error getting graph stats: ${err}`;
  }
}
