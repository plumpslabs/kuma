import initSqlJs from "sql.js";
import type { Database as SqlJsDatabase } from "sql.js";
import fs from "node:fs";
import path from "node:path";
import { getKumaDir } from "../utils/pathValidator.js";

// ============================================================
// KUMA DB — SQLite database manager (via sql.js, zero native build)
// ============================================================

const DB_FILENAME = "kuma.db";

let dbInstance: SqlJsDatabase | null = null;
let initPromise: Promise<SqlJsDatabase> | null = null;

/**
 * Get or initialize the database connection.
 * Uses sql.js (pure WASM) — no native build needed.
 */
export async function getDb(): Promise<SqlJsDatabase> {
  if (dbInstance) return dbInstance;
  if (initPromise) return initPromise;

  initPromise = initDb();
  return initPromise;
}

async function initDb(): Promise<SqlJsDatabase> {
  // Load sql.js — it bundles WASM internally in its Node.js build
  const SQL = await initSqlJs();
  const kumaDir = getKumaDir();
  const dbPath = path.join(kumaDir, DB_FILENAME);

  // Ensure .kuma directory exists
  if (!fs.existsSync(kumaDir)) {
    fs.mkdirSync(kumaDir, { recursive: true });
  }

  // Load existing or create new database
  let db: SqlJsDatabase;
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // Enable WAL mode for performance
  db.run("PRAGMA journal_mode=WAL");
  db.run("PRAGMA synchronous=NORMAL");

  // Create schema
  createSchema(db);

  // Save initial schema
  saveDb(db);

  dbInstance = db;
  return db;
}

/**
 * Save database to disk.
 */
export function saveDb(db?: SqlJsDatabase): void {
  const d = db ?? dbInstance;
  if (!d) return;
  try {
    const kumaDir = getKumaDir();
    const dbPath = path.join(kumaDir, DB_FILENAME);
    const data = d.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  } catch (err) {
    console.error(`[KumaDB] Failed to save database: ${err}`);
  }
}

/**
 * Create the database schema if tables don't exist.
 */
function createSchema(db: SqlJsDatabase): void {
  // Nodes: every entity in the knowledge graph
  db.run(`
    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('function','file','api_route','db_table','test','class','interface','type','module','variable')),
      name TEXT NOT NULL,
      file_path TEXT,
      metadata TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    )
  `);

  // Edges: relationships between nodes
  db.run(`
    CREATE TABLE IF NOT EXISTS edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT NOT NULL REFERENCES nodes(id),
      target_id TEXT NOT NULL REFERENCES nodes(id),
      type TEXT NOT NULL CHECK(type IN ('calls','imports','defines','tests','routes','implements','extends','depends_on','owns','modified_by')),
      weight REAL DEFAULT 1.0,
      metadata TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE(source_id, target_id, type)
    )
  `);

  // Session analytics
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      goal TEXT,
      tool_calls INTEGER DEFAULT 0,
      edits INTEGER DEFAULT 0,
      rollbacks INTEGER DEFAULT 0,
      failures INTEGER DEFAULT 0,
      safety_score INTEGER
    )
  `);

  // Tool call history (for analytics, pruning keeps last N)
  db.run(`
    CREATE TABLE IF NOT EXISTS tool_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER REFERENCES sessions(id),
      tool_name TEXT NOT NULL,
      params TEXT,
      success INTEGER DEFAULT 1,
      duration_ms INTEGER,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    )
  `);

  // Experience record: every tool call outcome with context
  db.run(`
    CREATE TABLE IF NOT EXISTS experiences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tool_name TEXT NOT NULL,
      params_hash TEXT NOT NULL,
      success INTEGER NOT NULL DEFAULT 1,
      duration_ms INTEGER,
      error_pattern TEXT,
      context_file TEXT,
      context_action TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    )
  `);

  // Learned patterns: antecedent → consequent with confidence
  db.run(`
    CREATE TABLE IF NOT EXISTS experience_patterns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      antecedent_tool TEXT NOT NULL,
      antecedent_hash TEXT NOT NULL,
      consequent_tool TEXT NOT NULL,
      confidence REAL DEFAULT 0.0,
      count INTEGER DEFAULT 1,
      avg_duration_ms INTEGER DEFAULT 0,
      success_rate REAL DEFAULT 1.0,
      last_seen_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE(antecedent_tool, antecedent_hash, consequent_tool)
    )
  `);

  // Full-text search index on node names and metadata
  // Wrapped in try-catch because some sql.js WASM builds don't include FTS5
  try {
    db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
        name,
        metadata,
        content='nodes',
        content_rowid='rowid'
      )
    `);
  } catch {
    // FTS5 not available — full-text search will be disabled
    console.warn("[KumaDB] FTS5 not available, full-text search disabled");
  }

  // Indexes for performance
  db.run(`CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_edges_type ON edges(type)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_tool_calls_created ON tool_calls(created_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_experiences_tool ON experiences(tool_name)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_experiences_hash ON experiences(params_hash)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_experiences_created ON experiences(created_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_patterns_antecedent ON experience_patterns(antecedent_tool)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_patterns_confidence ON experience_patterns(confidence DESC)`);
}

/**
 * Close the database connection.
 */
export function closeDb(): void {
  if (dbInstance) {
    saveDb();
    dbInstance.close();
    dbInstance = null;
    initPromise = null;
  }
}

/**
 * Prune old tool calls from the database (keep only recent N).
 */
export function pruneToolCalls(keepCount: number = 100): void {
  const db = dbInstance;
  if (!db) return;

  db.run(`
    DELETE FROM tool_calls WHERE id NOT IN (
      SELECT id FROM tool_calls ORDER BY created_at DESC LIMIT ?
    )
  `, [keepCount]);

  saveDb();
}

/**
 * Get database file size in KB.
 */
export function getDbSize(): number {
  const kumaDir = getKumaDir();
  const dbPath = path.join(kumaDir, DB_FILENAME);
  try {
    if (fs.existsSync(dbPath)) {
      return Math.round(fs.statSync(dbPath).size / 1024);
    }
  } catch {}
  return 0;
}

/**
 * Migrate existing session memory data to SQLite.
 * Called once on first init with SQLite.
 */
export async function migrateToSqlite(): Promise<boolean> {
  try {
    const db = await getDb();
    const { sessionMemory } = await import("./sessionMemory.js");

    // Check if already migrated
    const result = db.exec("SELECT COUNT(*) as cnt FROM sessions");
    if (result[0]?.values[0][0] > 0) return false;

    // Create initial session
    const summary = sessionMemory.getSummary();
    const startedAt = Math.floor(Date.now() / 1000);
    db.run(
      "INSERT INTO sessions (started_at, goal, tool_calls) VALUES (?, ?, ?)",
      [startedAt, summary.currentGoal || "", summary.toolCallCount || 0]
    );

    saveDb();
    return true;
  } catch {
    return false;
  }
}
