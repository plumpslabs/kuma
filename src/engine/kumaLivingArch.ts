// ============================================================
// KUMA LIVING ARCH — Living Architecture (Phase 5.5)
// ============================================================
// Architecture diagrams that stay up to date automatically.
// Auto-regenerates on significant changes, compares before/after,
// and notifies about architecture drift.
// ============================================================

import { getDb, saveDb } from "./kumaDb.js";

interface ArchSnapshot {
  timestamp: number;
  modules: string[];
  moduleEdges: Array<{ from: string; to: string; count: number }>;
  hash: string;
}

/**
 * Capture current architecture state from knowledge graph.
 */
export async function captureArchitecture(): Promise<string> {
  try {
    const db = await getDb();
    const snapshot = await buildSnapshot(db);

    // Ensure table exists (first call would fail otherwise)
    db.run(`CREATE TABLE IF NOT EXISTS arch_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT UNIQUE,
      snapshot TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    )`);

    // Store snapshot using parameterized query
    const hash = snapshot.hash;
    const checkStmt = db.prepare(`SELECT id FROM arch_snapshots WHERE hash = ?`);
    checkStmt.bind([hash]);
    const exists = checkStmt.step();
    checkStmt.free();

    if (!exists) {
      db.run(`INSERT INTO arch_snapshots (hash, snapshot) VALUES (?, ?)`,
        [hash, JSON.stringify(snapshot)]);
      saveDb(db);
    }

    return formatArchitectureSnapshot(snapshot);
  } catch (err) {
    return `Error capturing architecture: ${err}`;
  }
}

/**
 * Compare current architecture with previous snapshot.
 */
export async function diffArchitecture(): Promise<string> {
  try {
    const db = await getDb();
    const current = await buildSnapshot(db);

    // Get previous snapshot
    const result = db.exec(`SELECT snapshot FROM arch_snapshots ORDER BY created_at DESC LIMIT 1 OFFSET 1`);
    if (result.length === 0 || !result[0]?.values[0]) {
      return "⚠️ Only one architecture snapshot exists. Make more changes to see diffs.";
    }

    const prev: ArchSnapshot = JSON.parse(result[0].values[0][0] as string);

    // Compare
    const newModules = current.modules.filter(m => !prev.modules.includes(m));
    const removedModules = prev.modules.filter(m => !current.modules.includes(m));
    const newEdges = current.moduleEdges.filter(e =>
      !prev.moduleEdges.some(pe => pe.from === e.from && pe.to === e.to)
    );
    const removedEdges = prev.moduleEdges.filter(e =>
      !current.moduleEdges.some(ce => ce.from === e.from && ce.to === e.to)
    );

    const lines: string[] = [
      `🏗️ **Architecture Diff**`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━`,
      "",
    ];

    if (newModules.length > 0) {
      lines.push("**🟢 New Modules:**");
      for (const m of newModules) lines.push(`  + ${m}`);
      lines.push("");
    }
    if (removedModules.length > 0) {
      lines.push("**🔴 Removed Modules:**");
      for (const m of removedModules) lines.push(`  - ${m}`);
      lines.push("");
    }
    if (newEdges.length > 0) {
      lines.push("**🟢 New Dependencies:**");
      for (const e of newEdges) lines.push(`  + ${e.from} → ${e.to}`);
      lines.push("");
    }
    if (removedEdges.length > 0) {
      lines.push("**🔴 Removed Dependencies:**");
      for (const e of removedEdges) lines.push(`  - ${e.from} → ${e.to}`);
      lines.push("");
    }
    if (newModules.length === 0 && removedModules.length === 0 && newEdges.length === 0 && removedEdges.length === 0) {
      lines.push("✅ No architecture changes detected.");
    }

    return lines.join("\n");
  } catch (err) {
    return `Error diffing architecture: ${err}`;
  }
}

/**
 * Generate Mermaid architecture diagram from current graph.
 */
export async function generateLiveArchitectureDiagram(): Promise<string> {
  try {
    const db = await getDb();
    const snapshot = await buildSnapshot(db);

    if (snapshot.modules.length === 0) {
      return "⚠️ No modules found. Build the knowledge graph first.";
    }

    const lines: string[] = [
      "```mermaid",
      "graph LR",
      "  classDef default fill:#f0f4ff,stroke:#4a90d9,stroke-width:1px;",
    ];

    // Node declarations
    for (const mod of snapshot.modules) {
      const id = archMermaidId(mod);
      lines.push(`  ${id}["${mod}"]`);
    }

    // Edge declarations
    for (const edge of snapshot.moduleEdges) {
      const fromId = archMermaidId(edge.from);
      const toId = archMermaidId(edge.to);
      const label = edge.count > 1 ? `|${edge.count} imports|` : "";
      lines.push(`  ${fromId} -->${label} ${toId}`);
    }

    lines.push("```");

    return [
      ...lines,
      "",
      `🏗️ **Living Architecture** — ${snapshot.modules.length} modules, ${snapshot.moduleEdges.length} dependencies`,
      "💡 Auto-generated from Knowledge Graph import edges.",
      "💡 Run kuma_arch_diff to see changes since last snapshot.",
    ].join("\n");
  } catch (err) {
    return `Error generating architecture diagram: ${err}`;
  }
}

async function buildSnapshot(db: Awaited<ReturnType<typeof getDb>>): Promise<ArchSnapshot> {
  // Get all file → file import edges
  const edgeStmt = db.prepare(`
    SELECT DISTINCT s.file_path AS src, t.file_path AS tgt
    FROM edges e
    JOIN nodes s ON s.id = e.source_id
    JOIN nodes t ON t.id = e.target_id
    WHERE e.type = 'imports' AND s.type = 'file' AND t.type = 'file'
  `);
  const modules = new Set<string>();
  const moduleEdges: Record<string, Record<string, number>> = {};

  while (edgeStmt.step()) {
    const row = edgeStmt.getAsObject() as Record<string, unknown>;
    const srcPath = (row.src as string) || "";
    const tgtPath = (row.tgt as string) || "";
    const srcMod = srcPath.split("/")[0] || "root";
    const tgtMod = tgtPath.split("/")[0] || "root";
    modules.add(srcMod);
    modules.add(tgtMod);
    if (srcMod !== tgtMod) {
      if (!moduleEdges[srcMod]) moduleEdges[srcMod] = {};
      moduleEdges[srcMod][tgtMod] = (moduleEdges[srcMod][tgtMod] || 0) + 1;
    }
  }
  edgeStmt.free();

  const edgeList: ArchSnapshot["moduleEdges"] = [];
  for (const [from, targets] of Object.entries(moduleEdges)) {
    for (const [to, count] of Object.entries(targets)) {
      edgeList.push({ from, to, count });
    }
  }

  const modList = [...modules].sort();
  const hash = simpleHash(JSON.stringify({ modList, edgeList }));

  return { timestamp: Date.now(), modules: modList, moduleEdges: edgeList, hash };
}

function formatArchitectureSnapshot(snapshot: ArchSnapshot): string {
  return [
    `🏗️ **Architecture Snapshot** — ${snapshot.modules.length} modules, ${snapshot.moduleEdges.length} dependencies`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━`,
    "",
    "**Modules:**",
    ...snapshot.modules.map(m => `  📦 ${m}`),
    "",
    "**Dependencies:**",
    ...snapshot.moduleEdges.map(e => `  ${e.from} → ${e.to} (${e.count} imports)`),
    "",
    "💡 Run kuma_arch_diff to see changes from previous snapshot.",
  ].join("\n");
}

function archMermaidId(name: string): string {
  return `mod_${name.replace(/[^a-zA-Z0-9]/g, "_")}`.substring(0, 25) || `mod_${Date.now()}`;
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}
