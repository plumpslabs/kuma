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
      `SELECT json_group_array(json_object('id',id,'file_path',file_path,'description',REPLACE(REPLACE(description,char(10),' '),char(13),''),'severity',severity,'workaround',REPLACE(REPLACE(COALESCE(workaround,''),char(10),' '),char(13),''),'added_by',COALESCE(added_by,'agent'),'created_at',created_at)) FROM (SELECT * FROM known_gotchas ORDER BY created_at DESC)`
    );
    const features = jsonRows(
      `SELECT json_group_array(json_object('id',id,'name',name,'metadata',COALESCE(metadata,'{}'))) FROM (SELECT * FROM nodes WHERE type = 'feature' ORDER BY updated_at DESC)`
    );
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
      `SELECT started_at, COALESCE(goal,'') as goal, tool_calls, edits, rollbacks, failures, safety_score
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
      decisions: first(`SELECT COUNT(*) as c FROM (SELECT id FROM decision_log UNION SELECT id FROM nodes WHERE type = 'decision')`, "c"),
      researchCacheScopes: first(`SELECT COUNT(*) as c FROM research_cache`, "c"),
      verifications: verifTotal,
      verificationPassRate: verifTotal > 0 ? Math.round((verifPassed / verifTotal) * 100) : null,
      metrics: sessionMetrics.metrics,
      recordings: sessionMetrics.recordings,
      recentSessions,
    };

    // ── Staleness (GAP 4): surface stale assets before they become liabilities ──
    const staleness = detectStaleNodes(db, dbPath);

    return { stats, nodes, edges, gotchas, efficiency, staleness, injections: { count: injectionCount, savedMs: injectionSavedMs, savedFormatted: Math.round(injectionSavedMs / 60000) + ' min' } };
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

    return { node, outgoing, incoming, gotchas };
  } finally {
    db.close();
  }
}
