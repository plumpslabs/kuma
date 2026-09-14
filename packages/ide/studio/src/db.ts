// ============================================================
// KUMA STUDIO — Database Layer (sql.js WASM, zero native build)
// ============================================================
// Reads .kuma/kuma.db using sql.js — the exact same WASM engine
// the main Kuma server uses. No `sqlite3` CLI dependency, no
// native builds, consistent with Kuma's "zero setup, zero friction".
//
// All reads are snapshot-based (open → query → close), which is
// safe alongside a running Kuma MCP server.
// ============================================================

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

let sqlJs: any = null;

/** Lazily load sql.js (WASM-backed SQLite). */
async function getSqlJs(): Promise<any> {
  if (!sqlJs) {
    const initSqlJs = await require("sql.js");
    sqlJs = await initSqlJs();
  }
  return sqlJs;
}

/** Walk up directories to find .kuma/kuma.db */
export function findKumaDb(startDir?: string): string | null {
  let current = startDir ? path.resolve(startDir) : process.cwd();
  for (let i = 0; i < 20; i++) {
    const candidate = path.join(current, ".kuma", "kuma.db");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.resolve(current, "..");
    if (parent === current) break;
    current = parent;
  }
  return null;
}

/** Derive the project root from a kuma.db path (<root>/.kuma/kuma.db) */
export function projectRootFromDb(dbPath: string): string {
  return path.dirname(path.dirname(dbPath));
}

/** Open a read-only snapshot of the Kuma DB. */
export async function openDb(): Promise<any> {
  const SQL = await getSqlJs();
  const dbPath = findKumaDb();
  if (!dbPath) throw new Error("No .kuma/kuma.db found");
  const buffer = fs.readFileSync(dbPath);
  return new SQL.Database(buffer);
}

/** Run a SQL query, returning all rows as plain objects. */
export async function query(sql: string): Promise<Record<string, any>[]> {
  const db = await openDb();
  try {
    const stmt = db.prepare(sql);
    const rows: Record<string, any>[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  } finally {
    db.close();
  }
}

/** Run a JSON-producing SQL (json_object / json_group_array) and parse it. */
export async function queryJson<T = any>(sql: string): Promise<T> {
  const rows = await query(sql);
  if (!rows.length) return [] as any;
  const key = Object.keys(rows[0])[0];
  const raw = (rows[0] as any)[key];
  if (raw === null || raw === undefined) return [] as any;
  try {
    return JSON.parse(String(raw));
  } catch {
    return [] as any;
  }
}

// ============================================================
// READ SESSION METRICS — memory.json (researchTimeSaved, recordings)
// ============================================================

function readSessionMetrics(dbPath: string): {
  metrics: { filesRead: number; filesEdited: number; researchTimeSaved: number };
  recordings: { archFlows: number; gotchas: number; decisions: number; researchSaves: number; total: number };
} {
  const empty = {
    metrics: { filesRead: 0, filesEdited: 0, researchTimeSaved: 0 },
    recordings: { archFlows: 0, gotchas: 0, decisions: 0, researchSaves: 0, total: 0 },
  };
  try {
    const root = projectRootFromDb(dbPath);
    const memPath = path.join(root, ".kuma", "memory.json");
    if (!fs.existsSync(memPath)) return empty;
    const parsed = JSON.parse(fs.readFileSync(memPath, "utf-8"));
    return {
      metrics: {
        filesRead: parsed?.metrics?.filesRead ?? 0,
        filesEdited: parsed?.metrics?.filesEdited ?? 0,
        researchTimeSaved: parsed?.metrics?.researchTimeSaved ?? 0,
      },
      recordings: {
        archFlows: parsed?.recordings?.archFlows ?? 0,
        gotchas: parsed?.recordings?.gotchas ?? 0,
        decisions: parsed?.recordings?.decisions ?? 0,
        researchSaves: parsed?.recordings?.researchSaves ?? 0,
        total: parsed?.recordings?.total ?? 0,
      },
    };
  } catch {
    return empty;
  }
}

// ============================================================
// STALENESS — nodes whose file_path no longer exists on disk
// ============================================================

function detectStaleNodes(db: any, dbPath: string): {
  checked: number;
  staleNodes: number;
  missing: Array<{ filePath: string; nodeCount: number; reason: string }>;
} {
  try {
    const root = projectRootFromDb(dbPath);
    const stmt = db.prepare(
      `SELECT id, file_path, metadata, COUNT(*) as cnt FROM nodes
       WHERE file_path IS NOT NULL AND file_path != '' AND file_path NOT LIKE '%::%'
       GROUP BY file_path ORDER BY cnt DESC LIMIT 500`
    );
    const missing: Array<{ filePath: string; nodeCount: number; reason: string }> = [];
    let checked = 0;
    let staleNodes = 0;
    while (stmt.step()) {
      const row = stmt.getAsObject();
      const fp = row.file_path as string;
      const metadata = row.metadata as string || '{}';
      checked++;
      const fullPath = path.join(root, fp);
      
      if (!fs.existsSync(fullPath)) {
        // File doesn't exist = STALE
        const count = Number(row.cnt ?? 1);
        missing.push({ filePath: fp, nodeCount: count, reason: 'file_missing' });
        staleNodes += count;
      } else {
        // File exists, check if content changed (content hash comparison)
        try {
          const parsed = JSON.parse(metadata);
          const storedHash = parsed.contentHash;
          if (storedHash) {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const currentHash = crypto.createHash('md5').update(content).digest('hex');
            if (currentHash !== storedHash) {
              // Content changed = STALE
              const count = Number(row.cnt ?? 1);
              missing.push({ filePath: fp, nodeCount: count, reason: 'content_changed' });
              staleNodes += count;
            }
          }
        } catch {
          // Ignore hash comparison errors
        }
      }
    }
    stmt.free();
    return { checked, staleNodes, missing };
  } catch {
    return { checked: 0, staleNodes: 0, missing: [] };
  }
}

// ============================================================
// DASHBOARD DATA
// ============================================================

export async function getDashboardData() {
  const db = await openDb();
  const dbPath = findKumaDb()!;
  try {
    const run = (sql: string): Record<string, any>[] => {
      try {
        const stmt = db.prepare(sql);
        const rows: Record<string, any>[] = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        stmt.free();
        return rows;
      } catch {
        return [];
      }
    };
    const first = (sql: string, key: string): number => {
      const rows = run(sql);
      if (!rows.length) return 0;
      const v = rows[0][key];
      return Number(v ?? 0) || 0;
    };
    const jsonRows = (sql: string): any[] => {
      const rows = run(sql);
      if (!rows.length) return [];
      const key = Object.keys(rows[0])[0];
      const raw = rows[0][key];
      if (raw === null || raw === undefined) return [];
      try {
        const parsed = JSON.parse(String(raw));
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        return [];
      }
    };

    const stats = {
      node_count: first(`SELECT COUNT(*) as c FROM nodes`, "c"),
      edge_count: first(`SELECT COUNT(*) as c FROM edges`, "c"),
      gotcha_count: first(`SELECT COUNT(*) as c FROM known_gotchas`, "c"),
    };

    const nodes = jsonRows(
      `SELECT json_group_array(json_object('id',id,'name',name,'type',type,'file_path',file_path,'severity',COALESCE(severity,'medium'),'confidence',COALESCE(confidence,0.8),'metadata',COALESCE(metadata,'{}'))) FROM (SELECT * FROM nodes ORDER BY updated_at DESC)`
    );
    const edges = jsonRows(
      `SELECT json_group_array(json_object('source',source_id,'target',target_id,'relation',type,'weight',weight)) FROM edges`
    );
    const gotchas = jsonRows(
      `SELECT json_group_array(json_object('id',id,'file_path',file_path,'description',REPLACE(REPLACE(description,char(10),' '),char(13),''),'severity',severity,'workaround',REPLACE(REPLACE(COALESCE(workaround,''),char(10),' '),char(13),''),'added_by',COALESCE(added_by,'agent'),'status',COALESCE(status,'active'),'scope_package',COALESCE(scope_package,''),'verified_by',COALESCE(verified_by,''),'created_at',created_at,'updated_at',COALESCE(updated_at,created_at))) FROM (SELECT * FROM known_gotchas ORDER BY created_at DESC)`
    );
    const flows = jsonRows(
      `SELECT json_group_array(json_object('id',id,'name',name,'file_path',COALESCE(file_path,''),'metadata',COALESCE(metadata,'{}'),'updated_at',updated_at)) FROM (SELECT * FROM nodes WHERE type IN ('arch_flow', 'feature_domain') ORDER BY updated_at DESC)`
    );
    const decisions = jsonRows(
      `SELECT json_group_array(json_object('id',id,'name',name,'metadata',COALESCE(metadata,'{}'),'created_at',created_at)) FROM (SELECT * FROM nodes WHERE type = 'decision' ORDER BY created_at DESC)`
    );
    const features = jsonRows(
      `SELECT json_group_array(json_object('id',id,'name',name,'metadata',COALESCE(metadata,'{}'))) FROM (SELECT * FROM nodes WHERE type = 'feature' ORDER BY updated_at DESC)`
    );

    let workspace: any = { isWorkspace: false, packages: [] };
    try {
      const root = projectRootFromDb(dbPath);
      const rootPkgPath = path.join(root, "package.json");
      if (fs.existsSync(rootPkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf-8"));
        const pnpmWs = path.join(root, "pnpm-workspace.yaml");
        const isWs = Boolean(pkg.workspaces || fs.existsSync(pnpmWs));
        const packages: any[] = [];
        if (isWs) {
          for (const dirName of ["packages", "apps", "libs", "services", "crates"]) {
            const dirPath = path.join(root, dirName);
            if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
              for (const sub of fs.readdirSync(dirPath)) {
                const subPkg = path.join(dirPath, sub, "package.json");
                if (fs.existsSync(subPkg)) {
                  try {
                    const sp = JSON.parse(fs.readFileSync(subPkg, "utf-8"));
                    packages.push({ name: sp.name || sub, path: `${dirName}/${sub}` });
                  } catch {
                    packages.push({ name: sub, path: `${dirName}/${sub}` });
                  }
                }
              }
            }
          }
        }
        workspace = {
          isWorkspace: isWs,
          name: pkg.name || path.basename(root),
          version: pkg.version || "1.0.0",
          type: isWs ? (fs.existsSync(pnpmWs) ? "pnpm" : "npm/yarn") : "single-package",
          packages,
        };
      }
    } catch {}
    // ── Injection metrics (I4 Roadmap): shadow memory time saved ──
    let injectionCount = 0;
    let injectionSavedMs = 0;
    try {
      const root = projectRootFromDb(dbPath);
      const injPath = path.join(root, ".kuma", "injections.jsonl");
      if (fs.existsSync(injPath)) {
        const lines = fs.readFileSync(injPath, "utf-8").split("\n").filter(Boolean);
        const now = Date.now();
        for (const line of lines.slice(-200)) {
          try {
            const entry = JSON.parse(line);
            const age = now - (entry.ts || 0);
            if (age < 24 * 60 * 60 * 1000) {
              injectionCount++;
              injectionSavedMs += entry.saved_ms || 5000;
            }
          } catch {}
        }
      }
    } catch {}

    // ── Efficiency (GAP 1): prove "the more you use it, the more efficient it gets" ──
    const sessionMetrics = readSessionMetrics(dbPath);
    const verifTotal = first(`SELECT COUNT(*) as c FROM verifications`, "c");
    const verifPassed = first(`SELECT COUNT(*) as c FROM verifications WHERE passed = 1`, "c");
    const recentSessions = run(
      `SELECT started_at, COALESCE(goal,'') as goal, tool_calls, edits, rollbacks, failures
       FROM (SELECT * FROM sessions ORDER BY started_at DESC LIMIT 8)`
    ).map((r) => ({
      startedAt: Number(r.started_at ?? 0),
      goal: (r.goal as string) || "",
      toolCalls: Number(r.tool_calls ?? 0),
      edits: Number(r.edits ?? 0),
      rollbacks: Number(r.rollbacks ?? 0),
      failures: Number(r.failures ?? 0),
      safetyScore: r.safety_score == null ? null : Number(r.safety_score),
    }));

    const efficiency = {
      sessions: first(`SELECT COUNT(*) as c FROM sessions`, "c"),
      toolCalls: first(`SELECT COUNT(*) as c FROM tool_calls`, "c"),
      gotchas: first(`SELECT COUNT(*) as c FROM known_gotchas`, "c"),
      archFlows: sessionMetrics.recordings.archFlows,
      decisions: first(`SELECT COUNT(*) as c FROM nodes WHERE type = 'decision'`, "c"),
      researchCacheScopes: first(`SELECT COUNT(*) as c FROM research_cache`, "c"),
      verifications: verifTotal,
      verificationPassRate: verifTotal > 0 ? Math.round((verifPassed / verifTotal) * 100) : null,
      metrics: sessionMetrics.metrics,
      recordings: sessionMetrics.recordings,
      recentSessions,
    };

    // ── Staleness (GAP 4): surface stale assets before they become liabilities ──
    const staleness = detectStaleNodes(db, dbPath);

    return { stats, nodes, edges, gotchas, flows, decisions, workspace, efficiency, staleness, injections: { count: injectionCount, savedMs: injectionSavedMs, savedFormatted: Math.round(injectionSavedMs / 60000) + ' min' } };
  } finally {
    db.close();
  }
}

/** Get full details for a single node (for modal). */
export async function getNodeDetail(nodeId: string) {
  const db = await openDb();
  try {
    const run = (sql: string): Record<string, any>[] => {
      try {
        const stmt = db.prepare(sql);
        const rows: Record<string, any>[] = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        stmt.free();
        return rows;
      } catch {
        return [];
      }
    };

    const escaped = nodeId.replace(/'/g, "''");
    const parts = nodeId.split("::");
    const shortName = parts.pop()?.replace(/'/g, "''") || "";
    // For gotcha nodes (gotcha::filePath::desc), extract the file path (second part)
    const filePath = parts[0] === "gotcha" && parts.length >= 2 ? parts[1]?.replace(/'/g, "''") : "";
    // For research nodes (research::scope), extract the scope
    const scope = parts[0] === "research" && parts.length >= 2 ? parts.slice(1).join("::").replace(/'/g, "''") : "";

    const nodeRows = run(
      `SELECT json_object('id',id,'name',name,'type',type,'file_path',COALESCE(file_path,''),'metadata',COALESCE(metadata,'{}'),'severity',COALESCE(severity,'medium'),'confidence',COALESCE(confidence,0.8),'last_verified_at',last_verified_at,'created_at',created_at,'updated_at',updated_at) FROM nodes WHERE id = '${escaped}'`
    );
    if (!nodeRows.length) return null;
    const rawNode = nodeRows[0][Object.keys(nodeRows[0])[0]];
    let node: any = null;
    try { node = typeof rawNode === "string" ? JSON.parse(rawNode) : rawNode; } catch { return null; }
    if (!node) return null;

    const parseRelation = (rows: Record<string, any>[], label: "out" | "in") =>
      rows
        .map((r) => {
          const out: any = {
            relation: r.relation,
            weight: r.weight,
          };
          if (label === "out") {
            out.target = r.target;
            out.target_name = r.target_name;
            out.target_type = r.target_type;
          } else {
            out.source = r.source;
            out.source_name = r.source_name;
            out.source_type = r.source_type;
          }
          return out;
        })
        .filter(Boolean);

    const outgoing = parseRelation(
      run(
        `SELECT e.target_id as target, e.type as relation, e.weight, n.name as target_name, n.type as target_type
         FROM edges e LEFT JOIN nodes n ON n.id = e.target_id
         WHERE e.source_id = '${escaped}'`
      ),
      "out"
    );

    const incoming = parseRelation(
      run(
        `SELECT e.source_id as source, e.type as relation, e.weight, n.name as source_name, n.type as source_type
         FROM edges e LEFT JOIN nodes n ON n.id = e.source_id
         WHERE e.target_id = '${escaped}'`
      ),
      "in"
    );

    // Match gotchas by file path (for gotcha nodes) or by short name
    const gotchaFilter = filePath
      ? `file_path = '${filePath}'`
      : `file_path = '${escaped}' OR file_path LIKE '%${shortName}%'`;
    const gotchaRows = run(
      `SELECT json_object('id',id,'file_path',file_path,'description',REPLACE(REPLACE(description,char(10),' '),char(13),''),'severity',severity,'workaround',REPLACE(REPLACE(COALESCE(workaround,''),char(10),' '),char(13),''),'added_by',COALESCE(added_by,'agent'),'created_at',created_at) FROM known_gotchas WHERE ${gotchaFilter}`
    );
    const gotchas = gotchaRows
      .map((r) => {
        const raw = r[Object.keys(r)[0]];
        if (raw === null || raw === undefined) return null;
        try { return JSON.parse(String(raw)); } catch { return null; }
      })
      .filter(Boolean);

    const inDegree = incoming.length;
    const outDegree = outgoing.length;
    const isHub = inDegree >= 4;

    return { node, outgoing, incoming, gotchas, centrality: { inDegree, outDegree, isHub } };
  } finally {
    db.close();
  }
}

/** Save in-memory SQLite database back to disk atomically. */
export function saveDbToDisk(db: any): void {
  const dbPath = findKumaDb();
  if (!dbPath) throw new Error("No .kuma/kuma.db found");
  const data = db.export();
  const buffer = Buffer.from(data);
  const tmpPath = `${dbPath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmpPath, buffer);
  try {
    fs.renameSync(tmpPath, dbPath);
  } catch {
    fs.writeFileSync(dbPath, buffer);
    try { fs.unlinkSync(tmpPath); } catch {}
  }
}

/** Create or update a node from Studio. */
export async function upsertStudioNode(data: {
  id?: string;
  type: string;
  name: string;
  file_path?: string;
  description?: string;
  metadata?: Record<string, any>;
}): Promise<Record<string, any>> {
  const db = await openDb();
  try {
    const type = data.type || "feature_domain";
    const name = (data.name || "").trim();
    const filePath = (data.file_path || "").trim();

    let id = data.id;
    if (!id) {
      if (type === "file" && filePath) {
        id = `file::${filePath}`;
      } else if (type === "function" && filePath) {
        id = `function::${filePath}::${name}`;
      } else {
        id = `${type}::${name}`;
      }
    }

    const meta = data.metadata || {};
    if (data.description) {
      meta.description = data.description;
    }
    const metaStr = JSON.stringify(meta);

    db.run(
      `INSERT INTO nodes (id, type, name, file_path, metadata, severity, confidence, updated_at)
       VALUES (?, ?, ?, ?, ?, 'medium', 0.8, strftime('%s','now'))
       ON CONFLICT(id) DO UPDATE SET
         type = excluded.type,
         name = excluded.name,
         file_path = COALESCE(excluded.file_path, nodes.file_path),
         metadata = excluded.metadata,
         updated_at = strftime('%s','now')`,
      [id, type, name, filePath || null, metaStr]
    );

    // Update tokens index
    try {
      const terms = `${name} ${filePath} ${metaStr}`
        .toLowerCase()
        .split(/[\s,.;:!?()\[\]{}"'\/\\|@#$%^&*+=<>~`_-]+/)
        .filter((t) => t.length > 2 && t.length < 40);
      const uniqueTerms = Array.from(new Set(terms));
      db.run(`DELETE FROM node_tokens WHERE node_id = ?`, [id]);
      for (const term of uniqueTerms.slice(0, 30)) {
        db.run(`INSERT OR IGNORE INTO node_tokens (token, node_id) VALUES (?, ?)`, [term, id]);
      }
    } catch {}

    saveDbToDisk(db);
    return { id, type, name, file_path: filePath, metadata: meta };
  } finally {
    db.close();
  }
}

/** Delete a node and all connected edges from Studio. */
export async function deleteStudioNode(id: string): Promise<void> {
  const db = await openDb();
  try {
    db.run(`DELETE FROM nodes WHERE id = ?`, [id]);
    db.run(`DELETE FROM edges WHERE source_id = ? OR target_id = ?`, [id, id]);
    try {
      db.run(`DELETE FROM node_tokens WHERE node_id = ?`, [id]);
    } catch {}
    saveDbToDisk(db);
  } finally {
    db.close();
  }
}

/** Create or update an edge between two nodes from Studio. */
export async function createStudioEdge(edge: {
  source: string;
  target: string;
  type: string;
  weight?: number;
  metadata?: Record<string, any>;
}): Promise<void> {
  const db = await openDb();
  try {
    const weight = edge.weight ?? 1.0;
    const metadata = JSON.stringify(edge.metadata ?? {});

    db.run(
      `INSERT INTO edges (source_id, target_id, type, weight, metadata)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(source_id, target_id, type) DO UPDATE SET
         weight = excluded.weight,
         metadata = excluded.metadata`,
      [edge.source, edge.target, edge.type, weight, metadata]
    );

    saveDbToDisk(db);
  } finally {
    db.close();
  }
}

/** Delete an edge between two nodes from Studio. */
export async function deleteStudioEdge(source: string, target: string, type: string): Promise<void> {
  const db = await openDb();
  try {
    db.run(
      `DELETE FROM edges WHERE source_id = ? AND target_id = ? AND type = ?`,
      [source, target, type]
    );
    saveDbToDisk(db);
  } finally {
    db.close();
  }
}
