import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

/** Walk up directories to find .kuma/kuma.db */
export function findKumaDb(startDir?: string): string | null {
  let current = startDir ? resolve(startDir) : process.cwd();
  for (let i = 0; i < 20; i++) {
    const candidate = join(current, ".kuma", "kuma.db");
    if (existsSync(candidate)) return candidate;
    const parent = resolve(current, "..");
    if (parent === current) break;
    current = parent;
  }
  return null;
}

/** Run a SQL query via sqlite3, return raw text */
export function query(sql: string): string {
  const dbPath = findKumaDb();
  if (!dbPath) throw new Error("No .kuma/kuma.db found");
  return execSync(`sqlite3 "${dbPath}" "${sql}"`, {
    encoding: "utf-8",
    maxBuffer: 2 * 1024 * 1024,
    timeout: 10000,
  }).trim();
}

/** Run a JSON-returning query and parse it */
export function queryJson<T = any>(sql: string): T {
  const raw = query(sql);
  if (!raw) return [] as any;
  try {
    return JSON.parse(raw);
  } catch {
    try {
      const sanitized = raw.replace(/[\r\n]+/g, " ");
      return JSON.parse(sanitized);
    } catch (e) {
      console.warn("[Studio DB] queryJson parse failed:", e);
      return [] as any;
    }
  }
}

/** Get all dashboard data at once */
export function getDashboardData() {
  return {
    stats: queryJson(`
      SELECT json_object(
        'node_count', (SELECT COUNT(*) FROM nodes),
        'edge_count', (SELECT COUNT(*) FROM edges),
        'gotcha_count', (SELECT COUNT(*) FROM known_gotchas),
        'feature_count', (SELECT COUNT(*) FROM nodes WHERE type = 'feature'),
        'health_score', COALESCE((SELECT score FROM health_snapshots ORDER BY created_at DESC LIMIT 1), 0)
      )
    `),
    nodes: queryJson(
      `SELECT json_group_array(json_object('id',id,'name',name,'type',type,'file_path',file_path,'severity',COALESCE(severity,'medium'),'confidence',COALESCE(confidence,0.8),'metadata',COALESCE(metadata,'{}'))) FROM nodes ORDER BY updated_at DESC`
    ),
    edges: queryJson(
      `SELECT json_group_array(json_object('source',source_id,'target',target_id,'relation',type,'weight',weight)) FROM edges`
    ),
    gotchas: queryJson(
      `SELECT json_group_array(json_object('id',id,'file_path',file_path,'description',REPLACE(REPLACE(description,char(10),' '),char(13),''),'severity',severity,'workaround',REPLACE(REPLACE(COALESCE(workaround,''),char(10),' '),char(13),''),'added_by',COALESCE(added_by,'agent'),'created_at',created_at)) FROM known_gotchas ORDER BY severity DESC`
    ),
    features: queryJson(
      `SELECT json_group_array(json_object('id',id,'name',name,'metadata',COALESCE(metadata,'{}'))) FROM nodes WHERE type = 'feature' ORDER BY name`
    ),
    health: queryJson(
      `SELECT json_group_array(json_object('score',score,'summary',REPLACE(REPLACE(COALESCE(summary,''),char(10),' '),char(13),''),'risk_level',risk_level,'created_at',created_at)) FROM health_snapshots ORDER BY created_at DESC LIMIT 10`
    ),
  };
}

/** Get full details for a single node (for modal) */
export function getNodeDetail(nodeId: string) {
  const escaped = nodeId.replace(/'/g, "''");
  const parts = nodeId.split('::');
  const shortName = parts.pop()?.replace(/'/g, "''") || '';
  // For gotcha nodes (gotcha::filePath::desc), extract the file path (second part)
  const filePath = parts[0] === 'gotcha' && parts.length >= 2 ? parts[1]?.replace(/'/g, "''") : '';
  // For research nodes (research::scope), extract the scope
  const scope = parts[0] === 'research' && parts.length >= 2 ? parts.slice(1).join('::').replace(/'/g, "''") : '';

  const node = queryJson<any>(
    `SELECT json_object('id',id,'name',name,'type',type,'file_path',COALESCE(file_path,''),'metadata',COALESCE(metadata,'{}'),'severity',COALESCE(severity,'medium'),'confidence',COALESCE(confidence,0.8),'last_verified_at',last_verified_at,'created_at',created_at,'updated_at',updated_at) FROM nodes WHERE id = '${escaped}'`
  );

  const nodeObj = Array.isArray(node) ? node[0] : node;
  if (!nodeObj) return null;

  const rawOut = query(
    `SELECT json_object('target',e.target_id,'relation',e.type,'weight',e.weight,'target_name',n.name,'target_type',n.type) FROM edges e LEFT JOIN nodes n ON n.id = e.target_id WHERE e.source_id = '${escaped}'`
  );
  const outgoing = rawOut ? rawOut.split('\n').filter(Boolean).map(r => { try { return JSON.parse(r); } catch { return null; } }).filter(Boolean) : [];

  const rawIn = query(
    `SELECT json_object('source',e.source_id,'relation',e.type,'weight',e.weight,'source_name',n.name,'source_type',n.type) FROM edges e LEFT JOIN nodes n ON n.id = e.source_id WHERE e.target_id = '${escaped}'`
  );
  const incoming = rawIn ? rawIn.split('\n').filter(Boolean).map(r => { try { return JSON.parse(r); } catch { return null; } }).filter(Boolean) : [];

  // Match gotchas by file path (for gotcha nodes) or by short name — also return added_by and created_at
  const gotchaFilter = filePath
    ? `file_path = '${filePath}'`
    : `file_path = '${escaped}' OR file_path LIKE '%${shortName}%'`;
  const rawGotcha = query(
    `SELECT json_object('id',id,'file_path',file_path,'description',REPLACE(REPLACE(description,char(10),' '),char(13),''),'severity',severity,'workaround',REPLACE(REPLACE(COALESCE(workaround,''),char(10),' '),char(13),''),'added_by',COALESCE(added_by,'agent'),'created_at',created_at) FROM known_gotchas WHERE ${gotchaFilter}`
  );
  const gotchas = rawGotcha ? rawGotcha.split('\n').filter(Boolean).map(r => { try { return JSON.parse(r); } catch { return null; } }).filter(Boolean) : [];

  return { node: nodeObj, outgoing, incoming, gotchas };
}
