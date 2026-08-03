// ============================================================
// KUMA IDE CORE — Database Connection
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

let sqlJs: any = null;

/**
 * Lazily load sql.js (WASM-backed SQLite).
 */
async function getSqlJs(): Promise<any> {
  if (!sqlJs) {
    const initSqlJs = await require("sql.js");
    sqlJs = await initSqlJs();
  }
  return sqlJs;
}

/**
 * Locate the .kuma/kuma.db for the given project root.
 * Walks up from cwd if no root provided.
 */
export function findKumaDb(projectRoot?: string): string {
  const root = projectRoot || process.cwd();
  const dbPath = path.join(root, ".kuma", "kuma.db");
  if (!fs.existsSync(dbPath)) {
    // Try walking up from cwd
    let dir = root;
    while (dir !== path.parse(dir).root) {
      const candidate = path.join(dir, ".kuma", "kuma.db");
      if (fs.existsSync(candidate)) {
        return candidate;
      }
      dir = path.dirname(dir);
    }
    throw new Error(
      `Kuma database not found. Expected at: ${dbPath}\n` +
        "Make sure you have run Kuma in this project directory."
    );
  }
  return dbPath;
}

/**
 * Open a read-only SQLite connection to the Kuma DB.
 */
export async function openDb(projectRoot?: string) {
  const SQL = await getSqlJs();
  const dbPath = findKumaDb(projectRoot);
  const buffer = fs.readFileSync(dbPath);
  const db = new SQL.Database(buffer);
  return { db, dbPath };
}

/**
 * Run a query and return all rows as plain objects.
 */
export function queryAll(
  db: any,
  sql: string,
  params: any[] = []
): Record<string, any>[] {
  try {
    const stmt = db.prepare(sql);
    if (params.length > 0) stmt.bind(params);
    const rows: Record<string, any>[] = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  } catch {
    return [];
  }
}

/**
 * Run a query and return the first row, or null.
 */
export function queryOne(
  db: any,
  sql: string,
  params: any[] = []
): Record<string, any> | null {
  const rows = queryAll(db, sql, params);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Check if a table exists in the database.
 */
export function tableExists(db: any, tableName: string): boolean {
  const rows = queryAll(
    db,
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
    [tableName]
  );
  return rows.length > 0;
}

/**
 * Safely query a table, returning empty array if it doesn't exist.
 */
export function safeQueryAll(
  db: any,
  tableName: string,
  sql: string,
  params: any[] = []
): Record<string, any>[] {
  if (!tableExists(db, tableName)) return [];
  return queryAll(db, sql, params);
}

/**
 * Safely query a count from a table, returning 0 if it doesn't exist.
 */
export function safeCount(
  db: any,
  tableName: string,
  conditions: string = ""
): number {
  if (!tableExists(db, tableName)) return 0;
  const where = conditions ? `WHERE ${conditions}` : "";
  const row = queryOne(db, `SELECT COUNT(*) as c FROM ${tableName} ${where}`);
  return (row?.c as number) ?? 0;
}

/**
 * Get static info about the database.
 */
export async function getDbStats(projectRoot?: string): Promise<{
  dbSizeBytes: number;
  dbPath: string;
  nodeCount: number;
  edgeCount: number;
  gotchaCount: number;
  trajectoryCount: number;
  checkpointCount: number;
  blackboardCount: number;
  securityCount: number;
  driftCount: number;
}> {
  const { db, dbPath } = await openDb(projectRoot);
  try {
    return {
      dbSizeBytes: fs.statSync(dbPath).size,
      dbPath,
      nodeCount: safeCount(db, "nodes"),
      edgeCount: safeCount(db, "edges"),
      gotchaCount: safeCount(db, "known_gotchas"),
      trajectoryCount: safeCount(db, "trajectories"),
      checkpointCount: safeCount(db, "checkpoints"),
      blackboardCount: safeCount(db, "blackboard_events"),
      securityCount: safeCount(db, "security_findings"),
      driftCount: safeCount(db, "drift_records"),
    };
  } finally {
    db.close();
  }
}

/**
 * Check if a Kuma DB exists in the project.
 */
export function hasKumaDb(projectRoot?: string): boolean {
  try {
    findKumaDb(projectRoot);
    return true;
  } catch {
    return false;
  }
}
