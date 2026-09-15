// ============================================================
// KUMA DOMAIN CLUSTER ENGINE — Concept-Level Subsystem Nodes
// ============================================================
// Clusters 100-500+ granular files into 8-15 high-level architecture
// concept nodes with typed relationship verbs:
//   - 'uses'       : general consumer / dependency
//   - 'produces'   : creates data, records, or events
//   - 'validates'  : performs guards, checks, security, or contracts
//   - 'routes_to'  : dispatches endpoints or routes requests
//   - 'configures' : sets up environment, settings, or state
//
// Stored as 'feature_domain' nodes in SQLite knowledge graph,
// instantly queryable via kuma_context({ action: 'cluster' })
// and visually explored in Kuma Studio.
// ============================================================

import path from "node:path";
import { getDb, saveDb } from "./kumaDb.js";
import { upsertNode, addEdge, nodeId } from "./kumaGraph.js";
import { computeGraphCentrality } from "./graphCentrality.js";

export interface SubsystemCluster {
  id: string;
  name: string;
  key: string;
  role: string;
  files: string[];
  fileCount: number;
  entrypoints: string[];
  cruxSymbols: string[];
  relations: Array<{
    targetCluster: string;
    verb: "uses" | "produces" | "validates" | "routes_to" | "configures";
    evidenceCount: number;
  }>;
}

export interface ClusterEngineResult {
  clusters: SubsystemCluster[];
  subsystemCount: number;
  totalFiles: number;
  formattedOutput: string;
}

/**
 * Automatically cluster repository files into 8-15 high-level subsystem nodes
 * with typed relationship verbs.
 */
export async function buildSubsystemClusters(): Promise<ClusterEngineResult> {
  const db = await getDb();

  // 1. Fetch all file nodes and their associated symbol counts
  const fileStmt = db.prepare(`
    SELECT id, name, file_path, metadata
    FROM nodes
    WHERE type = 'file'
    ORDER BY name ASC
  `);

  const fileRows: Array<{ id: string; name: string; file_path: string; metadata?: string }> = [];
  while (fileStmt.step()) {
    fileRows.push(fileStmt.getAsObject() as any);
  }
  fileStmt.free();

  if (fileRows.length === 0) {
    return {
      clusters: [],
      subsystemCount: 0,
      totalFiles: 0,
      formattedOutput: "ℹ️ No files indexed in knowledge graph. Run `kuma_context({ action: 'research' })` first.",
    };
  }

  // 2. Fetch all symbol nodes to associate with files
  const symbolStmt = db.prepare(`
    SELECT id, name, type, file_path, metadata
    FROM nodes
    WHERE type IN ('function', 'class', 'interface', 'component')
  `);
  const fileSymbols = new Map<string, string[]>();
  while (symbolStmt.step()) {
    const row = symbolStmt.getAsObject() as any;
    const fp = row.file_path || "";
    if (fp) {
      const list = fileSymbols.get(fp) || [];
      if (row.name && !list.includes(row.name)) list.push(row.name);
      fileSymbols.set(fp, list);
    }
  }
  symbolStmt.free();

  // 3. Fetch all edges between files
  const edgeStmt = db.prepare(`
    SELECT source_id, target_id, type
    FROM edges
    WHERE type IN ('imports', 'depends_on', 'calls')
  `);
  const rawEdges: Array<{ source: string; target: string; type: string }> = [];
  while (edgeStmt.step()) {
    const row = edgeStmt.getAsObject() as any;
    rawEdges.push({ source: row.source_id, target: row.target_id, type: row.type });
  }
  edgeStmt.free();

  // 4. Partition files into clusters based on architectural directory boundaries
  const clusterFileMap = new Map<string, string[]>();

  for (const f of fileRows) {
    const filePath = f.file_path || f.name;
    const clusterKey = determineSubsystemKey(filePath);
    const list = clusterFileMap.get(clusterKey) || [];
    list.push(filePath);
    clusterFileMap.set(clusterKey, list);
  }

  // If there are too many micro-clusters (>16), merge tiny 1-file clusters into closest parent or 'core_utils'
  if (clusterFileMap.size > 14) {
    const minFilesThreshold = 2;
    const smallKeys: string[] = [];
    for (const [k, files] of clusterFileMap.entries()) {
      if (files.length < minFilesThreshold && k !== "core") smallKeys.push(k);
    }

    if (smallKeys.length > 0) {
      const sharedFiles: string[] = [];
      for (const k of smallKeys) {
        sharedFiles.push(...(clusterFileMap.get(k) || []));
        clusterFileMap.delete(k);
      }
      const existingUtils = clusterFileMap.get("common_utilities") || [];
      clusterFileMap.set("common_utilities", [...existingUtils, ...sharedFiles]);
    }
  }

  // 5. Build Cluster Nodes & calculate incoming/outgoing edge connections
  const fileToCluster = new Map<string, string>();
  for (const [cKey, files] of clusterFileMap.entries()) {
    for (const f of files) {
      fileToCluster.set(f, cKey);
      fileToCluster.set(path.normalize(f), cKey);
    }
  }

  // Matrix of connections between clusters: Map<`${sourceKey}->${targetKey}`, { calls: number; imports: number }>
  const clusterInteractions = new Map<string, { calls: number; imports: number }>();
  for (const e of rawEdges) {
    // e.source/target are node IDs like "file::src/index.ts" or "function::src/foo.ts::bar"
    const srcFile = extractFilePathFromNodeId(e.source);
    const tgtFile = extractFilePathFromNodeId(e.target);
    if (!srcFile || !tgtFile) continue;

    const srcCluster = fileToCluster.get(srcFile) || fileToCluster.get(path.normalize(srcFile));
    const tgtCluster = fileToCluster.get(tgtFile) || fileToCluster.get(path.normalize(tgtFile));

    if (srcCluster && tgtCluster && srcCluster !== tgtCluster) {
      const pairKey = `${srcCluster}->${tgtCluster}`;
      const stats = clusterInteractions.get(pairKey) || { calls: 0, imports: 0 };
      if (e.type === "calls") stats.calls++;
      else stats.imports++;
      clusterInteractions.set(pairKey, stats);
    }
  }

  const clusters: SubsystemCluster[] = [];

  let centralityMap: Map<string, { inDegree: number; score: number }> = new Map();
  try {
    const overview = await computeGraphCentrality();
    for (const [key, val] of overview.scores.entries()) {
      centralityMap.set(key, { inDegree: val.inDegree, score: val.score });
    }
  } catch {}

  for (const [cKey, files] of clusterFileMap.entries()) {
    const clusterId = nodeId("feature_domain", cKey);
    const name = formatClusterName(cKey);
    const role = inferSubsystemRole(cKey, files);

    // Pick entrypoints: files named index, main, server, or most imported
    const entrypoints = files
      .filter((f) => /index|main|server|app|engine|root/i.test(path.basename(f)))
      .slice(0, 3);
    if (entrypoints.length === 0 && files.length > 0) {
      entrypoints.push(files[0]);
    }

    // Collect top crux symbols from member files, ranked by graph centrality
    const allSyms: string[] = [];
    for (const f of files) {
      const syms = fileSymbols.get(f) || fileSymbols.get(path.normalize(f)) || [];
      for (const s of syms) {
        if (!allSyms.includes(s)) allSyms.push(s);
      }
    }

    allSyms.sort((a, b) => {
      const ca = centralityMap.get(a)?.inDegree || 0;
      const cb = centralityMap.get(b)?.inDegree || 0;
      return cb - ca;
    });

    const cruxSymbols = allSyms.slice(0, 8);

    // Calculate relations to other clusters with typed verbs
    const relations: SubsystemCluster["relations"] = [];
    for (const [otherKey] of clusterFileMap.entries()) {
      if (otherKey === cKey) continue;
      const pairKey = `${cKey}->${otherKey}`;
      const stats = clusterInteractions.get(pairKey);
      if (stats && stats.imports + stats.calls > 0) {
        const verb = inferTypedVerb(cKey, otherKey, stats);
        relations.push({
          targetCluster: otherKey,
          verb,
          evidenceCount: stats.imports + stats.calls,
        });
      }
    }

    // Sort relations by evidence count
    relations.sort((a, b) => b.evidenceCount - a.evidenceCount);

    const cluster: SubsystemCluster = {
      id: clusterId,
      name,
      key: cKey,
      role,
      files,
      fileCount: files.length,
      entrypoints,
      cruxSymbols,
      relations,
    };

    clusters.push(cluster);

    // Persist to SQLite nodes table
    await upsertNode({
      id: clusterId,
      name,
      type: "feature_domain",
      metadata: {
        key: cKey,
        description: role,
        fileCount: files.length,
        entrypoints,
        cruxSymbols,
        files: files.slice(0, 50),
      },
    });
  }

  // 6. Persist typed relations into SQLite edges table
  for (const c of clusters) {
    for (const rel of c.relations) {
      const targetId = nodeId("feature_domain", rel.targetCluster);
      await addEdge({
        sourceId: c.id,
        targetId,
        type: rel.verb,
        weight: rel.evidenceCount,
      });
    }
  }

  saveDb(db);

  // Sort clusters by file count descending
  clusters.sort((a, b) => b.fileCount - a.fileCount);

  const formattedOutput = formatClusterReport(clusters, fileRows.length);

  return {
    clusters,
    subsystemCount: clusters.length,
    totalFiles: fileRows.length,
    formattedOutput,
  };
}

// ============================================================
// Helper: Subsystem Partitioning Heuristics
// ============================================================

function determineSubsystemKey(filePath: string): string {
  const norm = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
  const parts = norm.split("/").filter(Boolean);

  let pkgPrefix = "";
  let domainParts: string[] = [];

  // Monorepo containers: packages/ide/studio/src/... or apps/web/src/...
  if (parts.length >= 3 && ["packages", "apps", "services", "libs", "crates", "modules"].includes(parts[0])) {
    pkgPrefix = parts[1];
    domainParts = parts.slice(2);
  } else if (parts.length >= 2 && !["src", "lib", "pkg", "test", "tests", "docs", "scripts"].includes(parts[0])) {
    // Custom monorepo / multi-service: backend/src/auth/... or fennec/src/browser/...
    pkgPrefix = parts[0];
    domainParts = parts.slice(1);
  } else {
    // Single package: src/engine/... or lib/utils/...
    pkgPrefix = "";
    domainParts = parts;
  }

  // Strip leading 'src', 'lib', 'pkg', 'app' from domainParts
  if (domainParts.length > 0 && ["src", "lib", "pkg", "app"].includes(domainParts[0])) {
    domainParts = domainParts.slice(1);
  }

  if (domainParts.length === 0) {
    return pkgPrefix ? `${pkgPrefix}_entrypoints` : "root_entrypoints";
  }

  // First domain directory or filename base
  const rawDomain = domainParts[0].replace(/\.[a-zA-Z0-9]+$/, "").toLowerCase();
  const sub = domainParts.length > 1 ? domainParts[1].replace(/\.[a-zA-Z0-9]+$/, "").toLowerCase() : "";

  let domainCategory = rawDomain;

  // Granular domain classification
  if (/^(auth|security|session|rbac|permission)/i.test(rawDomain)) {
    domainCategory = "auth_security";
  } else if (/^(route|routes|api|controller|controllers|endpoint)/i.test(rawDomain)) {
    domainCategory = "api_routing";
  } else if (/^(middleware|middlewares|interceptor|interceptors)/i.test(rawDomain)) {
    domainCategory = "middleware_pipeline";
  } else if (/^(model|models|schema|schemas|entity|entities|db|database|prisma|migration)/i.test(rawDomain)) {
    domainCategory = "data_models";
  } else if (/^(service|services)/i.test(rawDomain)) {
    domainCategory = sub ? `${sub}_services` : "domain_services";
  } else if (/^(browser|dom|page|tab)/i.test(rawDomain)) {
    domainCategory = "browser_automation";
  } else if (/^(devtools|console|network|storage|inspect)/i.test(rawDomain)) {
    domainCategory = "devtools_inspection";
  } else if (/^(process|spawn|worker)/i.test(rawDomain)) {
    domainCategory = "process_supervision";
  } else if (rawDomain === "engine") {
    if (sub) {
      if (/graph|db|scan/i.test(sub)) domainCategory = "knowledge_graph_engine";
      else if (/memory|session/i.test(sub)) domainCategory = "session_memory";
      else if (/safety|guard|drift|heal/i.test(sub)) domainCategory = "safety_guards";
      else domainCategory = "core_engine";
    } else {
      domainCategory = "core_engine";
    }
  } else if (/^(tool|tools|mcp)/i.test(rawDomain)) {
    domainCategory = "agent_mcp_tools";
  } else if (/^(util|utils|common|helper|helpers)/i.test(rawDomain)) {
    domainCategory = "common_utilities";
  }

  if (pkgPrefix) {
    return `${pkgPrefix}_${domainCategory}`.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();
  }

  return domainCategory.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();
}

function formatClusterName(key: string): string {
  return key
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function inferSubsystemRole(key: string, files: string[]): string {
  const k = key.toLowerCase();
  if (k.includes("auth") || k.includes("security")) {
    return "User authentication, access control policies, token validation, and security middleware.";
  }
  if (k.includes("route") || k.includes("api")) {
    return "HTTP / RPC endpoint routing, request validation, controller handlers, and route contracts.";
  }
  if (k.includes("middleware")) {
    return "Request pipeline filtering, authentication guards, error handling, and rate limiting.";
  }
  if (k.includes("model") || k.includes("data") || k.includes("db") || k.includes("schema")) {
    return "Database schemas, entity persistence, migrations, and data access models.";
  }
  if (k.includes("browser")) {
    return "Headless browser automation, DOM interaction, page navigation, and tab management.";
  }
  if (k.includes("devtools")) {
    return "Network request interception, console telemetry, DOM counters, and runtime profiling.";
  }
  if (k.includes("process")) {
    return "Background process spawning, PID tracking, process health supervisor, and process logs.";
  }
  if (k.includes("service")) {
    return "Core domain business logic, service orchestration, and external integrations.";
  }
  if (k.includes("graph") || k.includes("scan")) {
    return "AST parsing, code topology mapping, SQLite inverted indexing, and blast radius traversal.";
  }
  if (k.includes("memory") || k.includes("session")) {
    return "Persistent shadow memory, ADR decision tracking, and cross-session provenance.";
  }
  if (k.includes("guard") || k.includes("safety")) {
    return "Architectural boundary validation, circular dependency detection, and anti-pattern enforcement.";
  }
  if (k.includes("tool") || k.includes("mcp")) {
    return "Model Context Protocol (MCP) tool dispatching and coarse-grained agent command routing.";
  }
  if (k.includes("studio")) {
    return "Local interactive Web GUI visualizer for knowledge graphs, gotchas, and architecture flows.";
  }
  if (k.includes("util") || k.includes("common")) {
    return "Shared path validation, configuration loading, and platform detection helpers.";
  }
  return `Core subsystem handling ${files.slice(0, 3).map((f) => path.basename(f)).join(", ")}.`;
}

/**
 * Infer a typed semantic verb (uses, produces, validates, routes_to, configures)
 * between two subsystem clusters.
 */
function inferTypedVerb(
  sourceKey: string,
  targetKey: string,
  _stats: { calls: number; imports: number }
): "uses" | "produces" | "validates" | "routes_to" | "configures" {
  const src = sourceKey.toLowerCase();
  const tgt = targetKey.toLowerCase();

  // Routers / tools dispatch to engines
  if (src.includes("tool") || src.includes("route") || src.includes("mcp")) {
    if (tgt.includes("engine") || tgt.includes("guard") || tgt.includes("memory")) {
      return "routes_to";
    }
  }

  // Guards validate code / AST / boundaries
  if (src.includes("guard") || src.includes("safety") || src.includes("audit")) {
    return "validates";
  }

  // Scanners / generators produce graphs / caches
  if (src.includes("scan") || src.includes("cluster") || src.includes("build")) {
    if (tgt.includes("graph") || tgt.includes("db") || tgt.includes("memory")) {
      return "produces";
    }
  }

  // Init / config configures memory or engines
  if (src.includes("config") || src.includes("init") || src.includes("setup")) {
    return "configures";
  }

  return "uses";
}

function extractFilePathFromNodeId(id: string): string | null {
  if (id.startsWith("file::")) {
    return id.replace("file::", "");
  }
  // format: function::file_path::func_name
  const parts = id.split("::");
  if (parts.length >= 3) {
    return parts[1];
  }
  return null;
}

// ============================================================
// Format Clean Markdown Output for Coding Agents
// ============================================================

function formatClusterReport(clusters: SubsystemCluster[], totalFiles: number): string {
  const lines: string[] = [
    `🗺️ **Codebase Architecture Subsystems (${clusters.length} Concept Nodes)**`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `Aggregated **${totalFiles} files** into **${clusters.length} high-level concept subsystems**:`,
    "",
  ];

  clusters.forEach((c, idx) => {
    lines.push(`${idx + 1}. 📦 **${c.name}** (\`${c.key}\` · ${c.fileCount} files)`);
    lines.push(`   • **Role**: ${c.role}`);
    if (c.entrypoints.length > 0) {
      lines.push(`   • **Entrypoints**: ${c.entrypoints.map((e) => `\`${e}\``).join(", ")}`);
    }
    if (c.cruxSymbols.length > 0) {
      lines.push(`   • **Crux Symbols**: ${c.cruxSymbols.map((s) => `\`${s}\``).join(", ")}`);
    }
    if (c.relations.length > 0) {
      lines.push(`   • **Subsystem Relations**:`);
      for (const rel of c.relations.slice(0, 4)) {
        lines.push(`     ↳ *${rel.verb}* \`${rel.targetCluster}\` (${rel.evidenceCount} connections)`);
      }
    }
    lines.push("");
  });

  lines.push("💡 *Navigation Tip:* Use `kuma_context({ action: 'research', scope: '<cluster_key>' })` to inspect files inside any cluster.");
  lines.push("   Or explore visually in Kuma Studio (`kuma studio`) under 'Domains & Architecture'.");

  return lines.join("\n");
}
