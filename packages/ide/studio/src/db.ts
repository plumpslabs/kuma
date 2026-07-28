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
  return JSON.parse(raw);
}

/** Get all dashboard data at once */
export function getDashboardData() {
  return {
    stats: queryJson(`
      SELECT json_object(
        'node_count', (SELECT COUNT(*) FROM nodes),
        'edge_count', (SELECT COUNT(*) FROM edges),
        'gotcha_count', (SELECT COUNT(*) FROM known_gotchas),
        'trajectory_count', (SELECT COUNT(*) FROM trajectories),
        'skill_count', (SELECT COUNT(*) FROM distilled_skills),
        'health_score', COALESCE((SELECT score FROM health_snapshots ORDER BY created_at DESC LIMIT 1), 0)
      )
    `),
    nodes: queryJson(
      `SELECT json_group_array(json_object('id',id,'name',name,'type',type,'file_path',file_path)) FROM nodes ORDER BY updated_at DESC`
    ),
    edges: queryJson(
      `SELECT json_group_array(json_object('source',source_id,'target',target_id,'relation',type)) FROM edges`
    ),
    gotchas: queryJson(
      `SELECT json_group_array(json_object('id',id,'file_path',file_path,'description',description,'severity',severity,'workaround',workaround)) FROM known_gotchas ORDER BY severity DESC`
    ),
    trajectories: queryJson(
      `SELECT json_group_array(json_object('id',id,'goal',goal,'total_duration_ms',total_duration_ms,'success_rate',success_rate,'created_at',created_at)) FROM trajectories ORDER BY created_at DESC LIMIT 20`
    ),
    health: queryJson(
      `SELECT json_group_array(json_object('score',score,'summary',summary,'risk_level',risk_level,'created_at',created_at)) FROM health_snapshots ORDER BY created_at DESC LIMIT 10`
    ),
  };
}
