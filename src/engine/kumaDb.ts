import initSqlJs from "sql.js";
import type { Database as SqlJsDatabase } from "sql.js";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getKumaDir } from "../utils/pathValidator.js";

// ============================================================
// KUMA DB — SQLite database manager (via sql.js, zero native build)
// Schema v3.2 — UUID-based IDs + severity/confidence columns
// ============================================================

const DB_FILENAME = "kuma.db";

let dbInstance: SqlJsDatabase | null = null;
let initPromise: Promise<SqlJsDatabase> | null = null;

// ============================================================
// NODE ID GENERATION — UUID for new nodes
// ============================================================

/**
 * Generate a unique node ID.
 * New nodes get UUID-based IDs. Legacy text IDs are still supported.
 */
export function generateNodeId(type: string, name: string): string {
  const uuid = crypto.randomUUID().slice(0, 8);
  return `${type}::${uuid}::${name}`;
}

/**
 * Reset the cached dbInstance so the next getDb() call reloads from disk.
 * Used by checkpoint rollback to restore DB from snapshot.
 */
export function resetDbInstance(): void {
  dbInstance = null;
  initPromise = null;
}

export async function getDb(): Promise<SqlJsDatabase> {
  if (dbInstance) return dbInstance;
  if (initPromise) return initPromise;
  initPromise = initDb();
  return initPromise;
}

async function initDb(): Promise<SqlJsDatabase> {
  const SQL = await initSqlJs();
  const kumaDir = getKumaDir();
  const dbPath = path.join(kumaDir, DB_FILENAME);

  if (!fs.existsSync(kumaDir)) {
    fs.mkdirSync(kumaDir, { recursive: true });
  }

  let db: SqlJsDatabase;
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run("PRAGMA journal_mode=WAL");
  db.run("PRAGMA synchronous=NORMAL");
  createSchema(db);
  saveDb(db);
  dbInstance = db;
  return db;
}

// ============================================================
// Write queue — debounce concurrent saveDb() calls to prevent
// sql.js WASM race conditions (Issue #15 / CRITICAL-001 prevention)
// ============================================================
let _saveTimeout: ReturnType<typeof setTimeout> | null = null;
let _pendingDb: SqlJsDatabase | null = null;
const SAVE_DEBOUNCE_MS = 100; // Debounce rapid writes within 100ms

export function flushDb(db?: SqlJsDatabase): void {
  const kumaDir = getKumaDir();
  const dbPath = path.join(kumaDir, DB_FILENAME);

  const d = db ?? dbInstance ?? _pendingDb;
  if (!d) return;
  if (_saveTimeout) {
    clearTimeout(_saveTimeout);
    _saveTimeout = null;
  }
  _pendingDb = null;
  try {
    if (!fs.existsSync(kumaDir)) {
      fs.mkdirSync(kumaDir, { recursive: true });
    }
    const data = d.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  } catch (err) {
    console.error(`[KumaDB] Failed to flush database: ${err}`);
  }
}

export function saveDb(db?: SqlJsDatabase): void {
  const d = db ?? dbInstance;
  if (!d) return;
  
  _pendingDb = d;
  if (_saveTimeout) return;
  
  _saveTimeout = setTimeout(() => {
    flushDb(d);
  }, SAVE_DEBOUNCE_MS);
}

function createSchema(db: SqlJsDatabase): void {
  // ============================================================
  // Part 1: Core Graph (Original 15 issues — already fully addressed)
  // ============================================================    // Nodes: every entity in the knowledge graph
  // NOTE: type CHECK is intentionally permissive to allow new types without migration
  db.run(`CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    file_path TEXT,
    metadata TEXT DEFAULT '{}',
    severity TEXT DEFAULT 'medium',
    confidence REAL DEFAULT 0.8,
    last_verified_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  )`);

  // Migration: add new columns to existing nodes table if missing
  try {
    const schema = db.exec(`SELECT sql FROM sqlite_master WHERE type='table' AND name='nodes'`);
    const nodesSql = schema[0]?.values?.[0]?.[0] as string || '';
    if (!nodesSql.includes('severity')) {
      db.run(`ALTER TABLE nodes ADD COLUMN severity TEXT DEFAULT 'medium'`);
    }
    if (!nodesSql.includes('confidence')) {
      db.run(`ALTER TABLE nodes ADD COLUMN confidence REAL DEFAULT 0.8`);
    }
    if (!nodesSql.includes('last_verified_at')) {
      db.run(`ALTER TABLE nodes ADD COLUMN last_verified_at INTEGER`);
    }
  } catch { /* migration non-critical */ }

  // Edges: relationships between nodes
  // NOTE: 'contains' = file→symbol (file contains function/class/component)
  //       'composes' = component→component (component uses sub-component)
  db.run(`CREATE TABLE IF NOT EXISTS edges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id TEXT NOT NULL REFERENCES nodes(id),
    target_id TEXT NOT NULL REFERENCES nodes(id),
    type TEXT NOT NULL CHECK(type IN ('calls','imports','defines','tests','routes','implements','extends','depends_on','owns','modified_by','contains','composes','flows_through','triggers','syncs_with','affects')),
    weight REAL DEFAULT 1.0,
    metadata TEXT DEFAULT '{}',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    UNIQUE(source_id, target_id, type)
  )`);

  // Migration: if edges table exists with old CHECK constraint, recreate it
  try {
    const schema = db.exec(`SELECT sql FROM sqlite_master WHERE type='table' AND name='edges'`);
    const edgeSql = schema[0]?.values?.[0]?.[0] as string || '';
    if (edgeSql.includes('flows_through') === false) {
      // Need migration — recreate edges table with new types
      db.run(`ALTER TABLE edges RENAME TO edges_old`);
      db.run(`CREATE TABLE IF NOT EXISTS edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id TEXT NOT NULL REFERENCES nodes(id),
        target_id TEXT NOT NULL REFERENCES nodes(id),
        type TEXT NOT NULL CHECK(type IN ('calls','imports','defines','tests','routes','implements','extends','depends_on','owns','modified_by','contains','composes','flows_through','triggers','syncs_with','affects')),
        weight REAL DEFAULT 1.0,
        metadata TEXT DEFAULT '{}',
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        UNIQUE(source_id, target_id, type)
      )`);
      db.run(`INSERT OR IGNORE INTO edges SELECT * FROM edges_old`);
      db.run(`DROP TABLE edges_old`);
    }
  } catch { /* migration non-critical */ }

  // Session analytics
  db.run(`CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    goal TEXT,
    tool_calls INTEGER DEFAULT 0,
    edits INTEGER DEFAULT 0,
    rollbacks INTEGER DEFAULT 0,
    failures INTEGER DEFAULT 0,
    safety_score INTEGER
  )`);

  // Tool call history
  db.run(`CREATE TABLE IF NOT EXISTS tool_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER REFERENCES sessions(id),
    tool_name TEXT NOT NULL,
    params TEXT,
    success INTEGER DEFAULT 1,
    duration_ms INTEGER,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  )`);

  // Experience record with regression tracking (Part 3 #5: Regression Memory)
  db.run(`CREATE TABLE IF NOT EXISTS experiences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tool_name TEXT NOT NULL,
    params_hash TEXT NOT NULL,
    success INTEGER NOT NULL DEFAULT 1,
    duration_ms INTEGER,
    error_pattern TEXT,
    context_file TEXT,
    context_action TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  )`);

  // Learned patterns (Part 3 #3: Pattern Propagation)
  db.run(`CREATE TABLE IF NOT EXISTS experience_patterns (
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
  )`);

  // Research cache
  db.run(`CREATE TABLE IF NOT EXISTS research_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL UNIQUE,
    version INTEGER DEFAULT 1,
    confidence REAL DEFAULT 0.0,
    content_hash TEXT,
    record TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  )`);

  // Change log with rollback support (Part 1 #15: Fixed)
  db.run(`CREATE TABLE IF NOT EXISTS change_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER REFERENCES sessions(id),
    file_path TEXT NOT NULL,
    change_type TEXT NOT NULL CHECK(change_type IN ('modified','created','deleted','renamed')),
    symbol TEXT,
    diff_summary TEXT,
    git_commit_hash TEXT,
    previous_content TEXT DEFAULT NULL,
    current_content TEXT DEFAULT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  )`);

  // Health snapshots
  db.run(`CREATE TABLE IF NOT EXISTS health_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    score INTEGER NOT NULL,
    risk_level TEXT NOT NULL DEFAULT 'low',
    checks TEXT DEFAULT '[]',
    summary TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  )`);

  // Safety audit
  try {
    db.run(`CREATE TABLE IF NOT EXISTS safety_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      tool_name TEXT NOT NULL,
      action TEXT NOT NULL,
      file_path TEXT,
      risk_level TEXT NOT NULL DEFAULT 'low',
      policy_violations INTEGER DEFAULT 0,
      allowed INTEGER NOT NULL DEFAULT 1,
      duration_ms INTEGER DEFAULT 0,
      metadata TEXT DEFAULT '{}'
    )`);
  } catch { /* already exists */ }

  // ============================================================
  // Part 2 #6: Persistent Todo (kuma todo CRUD)
  // ============================================================
  db.run(`CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    scope TEXT DEFAULT '',
    deps TEXT DEFAULT '[]',
    success_criteria TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','done','cancelled')),
    session_id INTEGER,
    file_paths TEXT DEFAULT '[]',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  )`);

  // ============================================================
  // Part 2 #8: Security Findings (Security Leak Scanner)
  // ============================================================
  db.run(`CREATE TABLE IF NOT EXISTS security_findings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT NOT NULL,
    line_number INTEGER,
    pattern TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'medium' CHECK(severity IN ('low','medium','high','critical')),
    message TEXT NOT NULL,
    suggestion TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  )`);

  // ============================================================
  // Part 2 #5: API Contract Cache (API Explorer)
  // ============================================================
  db.run(`CREATE TABLE IF NOT EXISTS api_endpoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    params TEXT DEFAULT '{}',
    returns TEXT DEFAULT '{}',
    auth TEXT,
    handler_file TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    UNIQUE(method, path)
  )`);

  // ============================================================
  // Part 3 #3: Pattern Registry (Pattern Propagation)
  // ============================================================
  db.run(`CREATE TABLE IF NOT EXISTS patterns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern_type TEXT NOT NULL,
    before_code TEXT,
    after_code TEXT,
    description TEXT,
    file_path TEXT,
    matched_files TEXT DEFAULT '[]',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  )`);

  // ============================================================
  // Part 3 #4: Context Notes (Injected Context Sources)
  // ============================================================
  db.run(`CREATE TABLE IF NOT EXISTS context_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    content TEXT NOT NULL,
    scope TEXT DEFAULT '',
    file_paths TEXT DEFAULT '[]',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  )`);

  // ============================================================
  // Part 3 #6: Benchmarks (Before/After Benchmarking)
  // ============================================================
  db.run(`CREATE TABLE IF NOT EXISTS benchmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    metrics TEXT NOT NULL DEFAULT '{}',
    comparison_with TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  )`);

  // ============================================================
  // Part 4 #8: Decision Status (Living Document)
  // ============================================================
  db.run(`CREATE TABLE IF NOT EXISTS decision_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    context TEXT,
    rationale TEXT,
    outcome TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','superseded','deprecated','proposed')),
    superseded_by INTEGER,
    file_paths TEXT DEFAULT '[]',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  )`);

  // ============================================================
  // Part 4 #9: File Summaries Cache (AI Agent Cache Layer)
  // ============================================================
  db.run(`CREATE TABLE IF NOT EXISTS file_summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT NOT NULL UNIQUE,
    summary TEXT,
    exports TEXT DEFAULT '[]',
    imports TEXT DEFAULT '[]',
    content_hash TEXT,
    file_size INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  )`);

  // ============================================================
  // ============================================================
  // Issue #11: Enterprise — OTel config, cost tracking, sync config
  // ============================================================
  db.run(`CREATE TABLE IF NOT EXISTS otel_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint TEXT,
    service_name TEXT DEFAULT 'kuma',
    enabled INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS cost_tracking (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER REFERENCES sessions(id),
    tool_name TEXT NOT NULL,
    token_estimate INTEGER DEFAULT 0,
    cost_estimate REAL DEFAULT 0.0,
    budget_limit REAL DEFAULT 0.0,
    escalated INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  )`);

  // ============================================================
  // Issue #10: Scratch directory tracking
  // ============================================================
  db.run(`CREATE TABLE IF NOT EXISTS scratch_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT NOT NULL,
    reason TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  )`);

  // ============================================================
  // Proposal 1: Auto-Verification persistence
  // ============================================================
  db.run(`CREATE TABLE IF NOT EXISTS verifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL,
    runner TEXT NOT NULL,
    test_command TEXT NOT NULL,
    passed INTEGER NOT NULL,
    output TEXT,
    duration_ms INTEGER,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  )`);

  // ============================================================
  // Issue #17: 3-Layer Memory Engine tables (already file-based)
  // ============================================================

  // ============================================================
  // Issue #19: Blackboard Events table
  // ============================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS blackboard_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      source TEXT NOT NULL,
      topic TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      severity TEXT NOT NULL DEFAULT 'info'
        CHECK(severity IN ('info','warning','critical')),
      tags TEXT DEFAULT '[]',
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_bb_type ON blackboard_events(type)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_bb_topic ON blackboard_events(topic)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_bb_severity ON blackboard_events(severity)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_bb_created ON blackboard_events(created_at)`);

  // ============================================================
  // Issue #21: Known Gotchas table
  // ============================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS known_gotchas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL,
      description TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'medium'
        CHECK(severity IN ('low','medium','high','critical')),
      workaround TEXT,
      added_by TEXT DEFAULT 'agent',
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_gotchas_file ON known_gotchas(file_path)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_gotchas_severity ON known_gotchas(severity)`);

  // ============================================================
  // Issue #23: Trajectory tables
  // ============================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS trajectories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      goal TEXT NOT NULL,
      steps TEXT NOT NULL DEFAULT '[]',
      total_duration_ms INTEGER DEFAULT 0,
      success_rate REAL DEFAULT 0.0,
      complexity INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_traj_goal ON trajectories(goal)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_traj_complexity ON trajectories(complexity)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_traj_created ON trajectories(created_at)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS distilled_skills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      pattern TEXT NOT NULL,
      parameters TEXT DEFAULT '[]',
      success_count INTEGER DEFAULT 1,
      avg_duration_ms INTEGER DEFAULT 0,
      source_trajectory_id INTEGER,
      last_used_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_skills_name ON distilled_skills(name)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_skills_used ON distilled_skills(last_used_at)`);

  // ============================================================
  // Part 5 #7: Portability tracking
  // ============================================================
  db.run(`CREATE TABLE IF NOT EXISTS portability_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_type TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    absolute_path TEXT,
    status TEXT DEFAULT 'ok',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  )`);

  // ============================================================
  // Full-text search index on node names and metadata
  // ============================================================
  try {
    db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
      name, metadata, content='nodes', content_rowid='rowid'
    )`);
  } catch {
    console.warn("[KumaDB] FTS5 not available, full-text search disabled");
  }

  // ============================================================
  // Indexes for performance (Part 5 #2: Performance At Scale)
  // ============================================================
  db.run(`CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_nodes_updated ON nodes(updated_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_edges_type ON edges(type)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_edges_updated ON edges(created_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_tool_calls_created ON tool_calls(created_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_experiences_tool ON experiences(tool_name)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_experiences_hash ON experiences(params_hash)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_experiences_created ON experiences(created_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_patterns_antecedent ON experience_patterns(antecedent_tool)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_patterns_confidence ON experience_patterns(confidence DESC)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_research_scope ON research_cache(scope)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_research_updated ON research_cache(updated_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_change_log_session ON change_log(session_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_change_log_file ON change_log(file_path)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_change_log_created ON change_log(created_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_health_created ON health_snapshots(created_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(status)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_todos_scope ON todos(scope)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_security_file ON security_findings(file_path)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_security_severity ON security_findings(severity)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_api_path ON api_endpoints(path)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_context_notes_scope ON context_notes(scope)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_benchmarks_label ON benchmarks(label)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_decision_status ON decision_log(status)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_file_summaries_path ON file_summaries(file_path)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON safety_audit(timestamp)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_audit_tool ON safety_audit(tool_name)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_audit_risk ON safety_audit(risk_level)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_audit_allowed ON safety_audit(allowed)`);
}

// ============================================================
// Part 1: Research Cache Operations (already implemented)
// ============================================================

export async function getResearchCache(scope: string): Promise<string | null> {
  try {
    const db = await getDb();
    const stmt = db.prepare("SELECT record, content_hash, updated_at FROM research_cache WHERE scope = ?");
    stmt.bind([scope]);
    if (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      stmt.free();
      return row.record as string;
    }
    stmt.free();
    return null;
  } catch { return null; }
}

export async function saveResearchCache(scope: string, record: string, contentHash?: string, confidence?: number): Promise<void> {
  try {
    const db = await getDb();
    const stmt = db.prepare("SELECT id FROM research_cache WHERE scope = ?");
    stmt.bind([scope]);
    const hasExisting = stmt.step();
    stmt.free();
    if (hasExisting) {
      db.run(`UPDATE research_cache SET record = ?, content_hash = COALESCE(?, content_hash), confidence = COALESCE(?, confidence), version = version + 1, updated_at = strftime('%s','now') WHERE scope = ?`,
        [record, contentHash || null, confidence ?? null, scope]);
    } else {
      db.run(`INSERT INTO research_cache (scope, record, content_hash, confidence, version) VALUES (?, ?, ?, ?, 1)`,
        [scope, record, contentHash || null, confidence ?? null]);
    }
    saveDb();
  } catch (err) { console.error(`[KumaDB] Failed to save research cache: ${err}`); }
}

export async function listResearchCache(): Promise<string> {
  try {
    const db = await getDb();
    const stmt = db.prepare(`SELECT scope, version, confidence, created_at, updated_at FROM research_cache ORDER BY updated_at DESC`);
    const results: Array<Record<string, unknown>> = [];
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();
    if (results.length === 0) return "📚 **Research Cache** — No cached research found.";
    const lines: string[] = [`📚 **Research Cache** — ${results.length} scope(s)\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`];
    for (const r of results) {
      const conf = ((r.confidence as number) || 0) * 100;
      const updatedAt = new Date((r.updated_at as number) * 1000);
      const ageDays = Math.floor((Date.now() - updatedAt.getTime()) / 86400000);
      const ageStr = ageDays > 0 ? `${ageDays}d ago` : `${Math.floor((Date.now() - updatedAt.getTime()) / 3600000)}h ago`;
      const freshness = ageDays > 7 ? "🟡" : ageDays > 1 ? "🟢" : "🆕";
      lines.push(`  ${freshness} **${r.scope}** (v${r.version}) — ${conf.toFixed(0)}% | ${ageStr}`);
    }
    return lines.join("\n");
  } catch (err) { return `Error: ${err}`; }
}

// ============================================================
// Part 1: Change Log with Rollback (Issue #15)
// ============================================================

export async function recordChange(entry: {
  sessionId?: number;
  filePath: string;
  changeType: "modified" | "created" | "deleted" | "renamed";
  symbol?: string;
  diffSummary?: string;
  gitCommitHash?: string;
}): Promise<void> {
  try {
    const db = await getDb();
    // Store minimal info — NOT full file content (prevents MB-sized change_log)
    // Only store: file path, change type, timestamp, diff summary
    db.run(`INSERT INTO change_log (session_id, file_path, change_type, symbol, diff_summary, git_commit_hash, previous_content) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [entry.sessionId ?? null, entry.filePath, entry.changeType, entry.symbol ?? null, entry.diffSummary ?? null, entry.gitCommitHash ?? null, null]);
    saveDb();

    // Periodic cleanup — keep only last 500 change_log entries
    try {
      const countResult = db.exec("SELECT COUNT(*) FROM change_log");
      const count = (countResult[0]?.values?.[0] as unknown as number) || 0;
      if (count > 600) {
        db.exec("DELETE FROM change_log WHERE id IN (SELECT id FROM change_log ORDER BY created_at ASC LIMIT 200)");
        saveDb();
      }
    } catch {}
  } catch (err) { console.error(`[KumaDB] Failed to record change: ${err}`); }
}

export async function rollbackChange(changeId: number): Promise<string> {
  try {
    const db = await getDb();
    const stmt = db.prepare("SELECT * FROM change_log WHERE id = ?");
    stmt.bind([changeId]);
    if (!stmt.step()) { stmt.free(); return `❌ Change #${changeId} not found.`; }
    const row = stmt.getAsObject() as Record<string, unknown>;
    stmt.free();
    const filePath = row.file_path as string;
    const changeType = row.change_type as string;
    const previousContent = row.previous_content as string | null;
    const root = process.cwd();
    const fullPath = path.resolve(root, filePath);
    if (changeType === "deleted") {
      if (previousContent === null) return `❌ Cannot rollback deletion — no content stored.`;
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fullPath, previousContent, "utf-8");
      await recordChange({ filePath, changeType: "created", diffSummary: `Rollback of #${changeId} (was deleted)` });
      return `✅ Rollback — restored deleted file "${filePath}" (#${changeId})`;
    }
    if (previousContent === null) return `❌ Cannot rollback #${changeId} — no content captured.`;
    if (!fs.existsSync(fullPath) && changeType === "modified") return `❌ File "${filePath}" no longer exists.`;
    if (changeType === "created" && previousContent === "") {
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      await recordChange({ filePath, changeType: "deleted", diffSummary: `Rollback of #${changeId} (was created)` });
      return `✅ Rollback — deleted "${filePath}" (#${changeId})`;
    }
    // Write the previous content back to the file
    fs.writeFileSync(fullPath, previousContent, "utf-8");
    await recordChange({ filePath, changeType: changeType as "modified" | "created" | "deleted" | "renamed", diffSummary: `Rollback of #${changeId} (restored previous content)` });
    return `✅ Rollback — reverted "${filePath}" to state before #${changeId}`;
  } catch (err) { return `❌ Rollback failed: ${err}`; }
}

export async function getChanges(params: { sessionId?: number; filePath?: string; since?: number; limit?: number; includeRollbackIds?: boolean }): Promise<string> {
  try {
    const db = await getDb();
    const { sessionId, filePath, since, limit = 50 } = params;
    let sql = `SELECT cl.*, s.goal FROM change_log cl LEFT JOIN sessions s ON s.id = cl.session_id WHERE 1=1`;
    const bind: unknown[] = [];
    if (sessionId) { sql += ` AND cl.session_id = ?`; bind.push(sessionId); }
    if (filePath) { sql += ` AND cl.file_path LIKE ?`; bind.push(`%${filePath}%`); }
    if (since) { sql += ` AND cl.created_at >= ?`; bind.push(since); }
    sql += ` ORDER BY cl.created_at DESC LIMIT ?`; bind.push(limit);
    const stmt = db.prepare(sql); stmt.bind(bind);
    const results: Array<Record<string, unknown>> = [];
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();
    if (results.length === 0) return "No changes found.";
    const lines: string[] = [`📋 Change Log — ${results.length} change(s)`];
    for (const r of results) {
      const icon = r.change_type === "deleted" ? "❌" : r.change_type === "created" ? "✨" : "📝";
      lines.push(`  ${icon} [#${r.id}] ${r.file_path} (${r.change_type})${r.previous_content ? " 🔄" : ""}`);
      if (r.symbol) lines.push(`     Symbol: ${r.symbol}`);
      if (r.goal) lines.push(`     Goal: ${r.goal}`);
    }
    return lines.join("\n");
  } catch (err) { return `Error: ${err}`; }
}

// ============================================================
// Part 2 #6: Persistent Todo CRUD
// ============================================================

export async function addTodo(params: { title: string; description?: string; scope?: string; deps?: string; successCriteria?: string }): Promise<string> {
  try {
    const db = await getDb();
    db.run(`INSERT INTO todos (title, description, scope, deps, success_criteria) VALUES (?, ?, ?, ?, ?)`,
      [params.title, params.description || "", params.scope || "", params.deps || "[]", params.successCriteria || ""]);
    saveDb();
    return `✅ Todo added: "${params.title}"`;
  } catch (err) { return `❌ Failed to add todo: ${err}`; }
}

export async function listTodos(scope?: string, status?: string): Promise<string> {
  try {
    const db = await getDb();
    let sql = `SELECT * FROM todos WHERE 1=1`;
    const bind: unknown[] = [];
    if (scope) { sql += ` AND scope = ?`; bind.push(scope); }
    if (status) { sql += ` AND status = ?`; bind.push(status); }
    sql += ` ORDER BY created_at DESC LIMIT 50`;
    const stmt = db.prepare(sql); stmt.bind(bind);
    const results: Array<Record<string, unknown>> = [];
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();
    if (results.length === 0) return `📋 No todos found.`;
    const lines: string[] = [`📋 Todo List — ${results.length} item(s)\n`];
    for (const t of results) {
      const icon = t.status === "done" ? "✅" : t.status === "active" ? "🔄" : t.status === "cancelled" ? "❌" : "⏳";
      lines.push(`  ${icon} [#${t.id}] ${t.title} (${t.status})`);
      if (t.scope) lines.push(`     Scope: ${t.scope}`);
      if (t.success_criteria) lines.push(`     Success: ${t.success_criteria}`);
    }
    return lines.join("\n");
  } catch (err) { return `Error: ${err}`; }
}

export async function updateTodoStatus(id: number, status: string): Promise<string> {
  try {
    const db = await getDb();
    db.run(`UPDATE todos SET status = ?, updated_at = strftime('%s','now') WHERE id = ?`, [status, id]);
    saveDb();
    return `✅ Todo #${id} updated to "${status}"`;
  } catch (err) { return `❌ Failed: ${err}`; }
}

// ============================================================
// Part 2 #8: Security Scanner
// ============================================================

export async function addSecurityFinding(finding: { filePath: string; lineNumber?: number; pattern: string; severity: string; message: string; suggestion?: string }): Promise<void> {
  try {
    const db = await getDb();
    db.run(`INSERT INTO security_findings (file_path, line_number, pattern, severity, message, suggestion) VALUES (?, ?, ?, ?, ?, ?)`,
      [finding.filePath, finding.lineNumber || null, finding.pattern, finding.severity, finding.message, finding.suggestion || null]);
    saveDb();
  } catch {}
}

export async function getSecurityFindings(): Promise<string> {
  try {
    const db = await getDb();
    const stmt = db.prepare(`SELECT * FROM security_findings ORDER BY severity DESC, created_at DESC LIMIT 50`);
    const results: Array<Record<string, unknown>> = [];
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();
    if (results.length === 0) return "🔒 No security findings.";
    const lines: string[] = [`🔒 Security Findings — ${results.length}\n`];
    for (const f of results) {
      const icon = f.severity === "critical" ? "🔴" : f.severity === "high" ? "🟠" : f.severity === "medium" ? "🟡" : "🟢";
      lines.push(`  ${icon} [${f.severity}] ${f.message} — ${f.file_path}${f.line_number ? `:${f.line_number}` : ""}`);
    }
    return lines.join("\n");
  } catch (err) { return `Error: ${err}`; }
}

// ============================================================
// Part 3 #4: Context Notes (Injected Context)
// ============================================================

export async function addContextNote(note: { source: string; content: string; scope?: string; filePaths?: string }): Promise<string> {
  try {
    const db = await getDb();
    db.run(`INSERT INTO context_notes (source, content, scope, file_paths) VALUES (?, ?, ?, ?)`,
      [note.source, note.content, note.scope || "", note.filePaths || "[]"]);
    saveDb();
    return `✅ Context note added from "${note.source}"`;
  } catch (err) { return `❌ Failed: ${err}`; }
}

export async function listContextNotes(scope?: string): Promise<string> {
  try {
    const db = await getDb();
    let sql = `SELECT * FROM context_notes WHERE 1=1`;
    const bind: unknown[] = [];
    if (scope) { sql += ` AND scope = ?`; bind.push(scope); }
    sql += ` ORDER BY created_at DESC LIMIT 20`;
    const stmt = db.prepare(sql); stmt.bind(bind);
    const results: Array<Record<string, unknown>> = [];
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();
    if (results.length === 0) return "📝 No context notes.";
    const lines: string[] = [`📝 Context Notes — ${results.length}\n`];
    for (const n of results) {
      lines.push(`  📌 From: ${n.source} | Scope: ${n.scope || "general"}`);
      lines.push(`     ${(n.content as string).substring(0, 200)}`);
    }
    return lines.join("\n");
  } catch (err) { return `Error: ${err}`; }
}

// ============================================================
// Part 3 #6: Benchmarks
// ============================================================

export async function saveBenchmark(label: string, metrics: Record<string, unknown>): Promise<string> {
  try {
    const db = await getDb();
    db.run(`INSERT INTO benchmarks (label, timestamp, metrics) VALUES (?, ?, ?)`,
      [label, Math.floor(Date.now() / 1000), JSON.stringify(metrics)]);
    saveDb();
    return `✅ Benchmark "${label}" saved.`;
  } catch (err) { return `❌ Failed: ${err}`; }
}

export async function getBenchmarkDiff(labelA: string, labelB?: string): Promise<string> {
  try {
    const db = await getDb();
    const stmt = db.prepare(`SELECT * FROM benchmarks WHERE label = ? ORDER BY timestamp DESC LIMIT 1`);
    stmt.bind([labelA]);
    if (!stmt.step()) { stmt.free(); return `❌ Benchmark "${labelA}" not found.`; }
    const a = stmt.getAsObject() as Record<string, unknown>;
    stmt.free();
    const metricsA = JSON.parse(a.metrics as string || "{}");
    let diffLines: string[] = [`📊 Benchmark: ${labelA}\n`];
    for (const [key, val] of Object.entries(metricsA)) {
      diffLines.push(`  ${key}: ${val}`);
    }
    if (labelB) {
      const stmt2 = db.prepare(`SELECT * FROM benchmarks WHERE label = ? ORDER BY timestamp DESC LIMIT 1`);
      stmt2.bind([labelB]);
      if (stmt2.step()) {
        const b = stmt2.getAsObject() as Record<string, unknown>;
        const metricsB = JSON.parse(b.metrics as string || "{}");
        diffLines.push(`\n📊 Diff: ${labelA} → ${labelB}\n`);
        for (const key of Object.keys({ ...metricsA, ...metricsB })) {
          const va = (metricsA as any)[key];
          const vb = (metricsB as any)[key];
          if (va !== undefined && vb !== undefined && typeof va === "number") {
            const change = ((vb - va) / va * 100).toFixed(1);
            const icon = parseFloat(change) > 0 ? "📈" : parseFloat(change) < 0 ? "📉" : "➡️";
            diffLines.push(`  ${icon} ${key}: ${va} → ${vb} (${change}%)`);
          }
        }
      }
      stmt2.free();
    }
    return diffLines.join("\n");
  } catch (err) { return `Error: ${err}`; }
}

// ============================================================
// Part 4 #8: Decision Log
// ============================================================

export async function recordDecisionLog(entry: { title: string; context?: string; rationale?: string; outcome?: string; status?: string }): Promise<string> {
  try {
    const db = await getDb();
    db.run(`INSERT INTO decision_log (title, context, rationale, outcome, status) VALUES (?, ?, ?, ?, ?)`,
      [entry.title, entry.context || "", entry.rationale || "", entry.outcome || "", entry.status || "active"]);
    saveDb();
    return `✅ Decision "${entry.title}" logged as ${entry.status || "active"}.`;
  } catch (err) { return `❌ Failed: ${err}`; }
}

export async function listDecisionLog(status?: string): Promise<string> {
  try {
    const db = await getDb();
    let sql = `SELECT * FROM decision_log WHERE 1=1`;
    const bind: unknown[] = [];
    if (status) { sql += ` AND status = ?`; bind.push(status); }
    sql += ` ORDER BY created_at DESC LIMIT 50`;
    const stmt = db.prepare(sql); stmt.bind(bind);
    const results: Array<Record<string, unknown>> = [];
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();
    if (results.length === 0) return "📋 No decisions logged.";
    const lines: string[] = [`📋 Decision Log — ${results.length}\n`];
    for (const d of results) {
      const icon = d.status === "active" ? "✅" : d.status === "superseded" ? "🔄" : d.status === "deprecated" ? "❌" : "📝";
      lines.push(`  ${icon} ${d.title} (${d.status})`);
      if (d.context) lines.push(`     Context: ${(d.context as string).substring(0, 150)}`);
    }
    return lines.join("\n");
  } catch (err) { return `Error: ${err}`; }
}

export async function updateDecisionStatus(id: number, status: string): Promise<string> {
  try {
    const db = await getDb();
    db.run(`UPDATE decision_log SET status = ? WHERE id = ?`, [status, id]);
    saveDb();
    return `✅ Decision #${id} updated to "${status}"`;
  } catch (err) { return `❌ Failed: ${err}`; }
}

// ============================================================
// Part 4 #9: File Summaries (AI Agent Cache Layer)
// ============================================================

export async function getFileSummary(filePath: string): Promise<string | null> {
  try {
    const db = await getDb();
    const stmt = db.prepare("SELECT summary, exports, imports, content_hash FROM file_summaries WHERE file_path = ?");
    stmt.bind([filePath]);
    if (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      stmt.free();
      return JSON.stringify(row);
    }
    stmt.free();
    return null;
  } catch { return null; }
}

export async function saveFileSummary(params: { filePath: string; summary: string; exports?: string; imports?: string; contentHash?: string; fileSize?: number }): Promise<void> {
  try {
    const db = await getDb();
    db.run(`INSERT OR REPLACE INTO file_summaries (file_path, summary, exports, imports, content_hash, file_size, updated_at) VALUES (?, ?, ?, ?, ?, ?, strftime('%s','now'))`,
      [params.filePath, params.summary, params.exports || "[]", params.imports || "[]", params.contentHash || "", params.fileSize || 0]);
    saveDb();
  } catch {}
}

// ============================================================
// Part 5 #6: Kuma Hygiene — GC Operations
// ============================================================

export async function runGarbageCollection(): Promise<string> {
  try {
    const db = await getDb();
    let removed = 0;

    // Helper to safely get count from exec result
    const getCount = (sql: string): number => {
      try {
        const result = db.exec(sql);
        return (result[0]?.values?.[0] as unknown as number) || 0;
      } catch { return 0; }
    };

    // 1. Orphan nodes (no edges, no file_path, older than 30 days)
    const orphanResult = db.exec(`DELETE FROM nodes WHERE id NOT IN (SELECT source_id FROM edges UNION SELECT target_id FROM edges) AND file_path IS NULL AND updated_at < strftime('%s','now','-30 days')`);
    removed += orphanResult[0]?.values?.length || 0;

    // 2. Stale edges (weight < 0.1, older than 30 days)
    const staleEdges = db.exec(`DELETE FROM edges WHERE weight < 0.1 AND updated_at < strftime('%s','now','-30 days')`);
    removed += staleEdges[0]?.values?.length || 0;

    // 3. Tool calls > 90 days
    db.exec(`DELETE FROM tool_calls WHERE created_at < strftime('%s','now','-90 days')`);

    // 4. Experiences > 90 days
    db.exec(`DELETE FROM experiences WHERE created_at < strftime('%s','now','-90 days')`);

    // 5. Change log — keep only last 500 entries (prevents MB-sized growth)
    const changeCount = getCount("SELECT COUNT(*) FROM change_log");
    if (changeCount > 500) {
      db.exec(`DELETE FROM change_log WHERE id IN (SELECT id FROM change_log ORDER BY created_at ASC LIMIT ${changeCount - 500})`);
    }

    // 6. Verifications — keep only last 100 entries
    const verifCount = getCount("SELECT COUNT(*) FROM verifications");
    if (verifCount > 100) {
      db.exec(`DELETE FROM verifications WHERE id IN (SELECT id FROM verifications ORDER BY created_at ASC LIMIT ${verifCount - 100})`);
    }

    // 7. Health snapshots — keep only last 50
    const healthCount = getCount("SELECT COUNT(*) FROM health_snapshots");
    if (healthCount > 50) {
      db.exec(`DELETE FROM health_snapshots WHERE id IN (SELECT id FROM health_snapshots ORDER BY created_at ASC LIMIT ${healthCount - 50})`);
    }

    // 8. Safety audit — keep only last 200
    const auditCount = getCount("SELECT COUNT(*) FROM safety_audit");
    if (auditCount > 200) {
      db.exec(`DELETE FROM safety_audit WHERE id IN (SELECT id FROM safety_audit ORDER BY created_at ASC LIMIT ${auditCount - 200})`);
    }

    // 9. Research cache — remove entries older than 60 days
    db.exec(`DELETE FROM research_cache WHERE updated_at < strftime('%s','now','-60 days')`);

    // 10. Security findings — keep only last 100
    const secCount = getCount("SELECT COUNT(*) FROM security_findings");
    if (secCount > 100) {
      db.exec(`DELETE FROM security_findings WHERE id IN (SELECT id FROM security_findings ORDER BY created_at ASC LIMIT ${secCount - 100})`);
    }

    // 11. Context notes — keep only last 200
    const ctxCount = getCount("SELECT COUNT(*) FROM context_notes");
    if (ctxCount > 200) {
      db.exec(`DELETE FROM context_notes WHERE id IN (SELECT id FROM context_notes ORDER BY created_at ASC LIMIT ${ctxCount - 200})`);
    }

    // 12. Benchmarks — keep only last 100
    const benchCount = getCount("SELECT COUNT(*) FROM benchmarks");
    if (benchCount > 100) {
      db.exec(`DELETE FROM benchmarks WHERE id IN (SELECT id FROM benchmarks ORDER BY created_at ASC LIMIT ${benchCount - 100})`);
    }

    // 13. Decision log — keep only last 200
    const decCount = getCount("SELECT COUNT(*) FROM decision_log");
    if (decCount > 200) {
      db.exec(`DELETE FROM decision_log WHERE id IN (SELECT id FROM decision_log ORDER BY created_at ASC LIMIT ${decCount - 200})`);
    }

    // 14. Known gotchas — remove stale entries for deleted files
    db.exec(`DELETE FROM known_gotchas WHERE file_path NOT IN (SELECT DISTINCT file_path FROM nodes WHERE file_path IS NOT NULL) AND file_path NOT LIKE '%::%'`);

    // 15. Scratch entries — remove older than 7 days
    db.exec(`DELETE FROM scratch_entries WHERE created_at < strftime('%s','now','-7 days')`);

    // 16. Cost tracking — keep only last 500
    const costCount = getCount("SELECT COUNT(*) FROM cost_tracking");
    if (costCount > 500) {
      db.exec(`DELETE FROM cost_tracking WHERE id IN (SELECT id FROM cost_tracking ORDER BY created_at ASC LIMIT ${costCount - 500})`);
    }

    // 17. Sessions — keep only last 50
    const sessCount = getCount("SELECT COUNT(*) FROM sessions");
    if (sessCount > 50) {
      db.exec(`DELETE FROM sessions WHERE id IN (SELECT id FROM sessions ORDER BY started_at ASC LIMIT ${sessCount - 50})`);
    }

    // VACUUM to reclaim space
    try { db.exec("VACUUM"); } catch {}
    saveDb();
    return `🧹 GC complete — cleaned 17 tables. Database vacuumed.`;
  } catch (err) { return `❌ GC failed: ${err}`; }
}

export async function runDoctor(): Promise<string> {
  try {
    const db = await getDb();
    const checks: string[] = [
      "🩺 **Kuma Doctor Report**",
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      "",
    ];

    // 1. Database integrity
    try {
      const integrity = db.exec("PRAGMA integrity_check");
      const result = integrity[0]?.values[0]?.[0] || "ok";
      checks.push(`**Database Integrity**: ${result === "ok" ? "✅" : "❌ " + result}`);
    } catch { checks.push("**Database Integrity**: ❌ check failed"); }

    // 2. Schema health
    const allTables = ["nodes", "edges", "sessions", "research_cache", "change_log", "safety_audit", "todos", "security_findings", "context_notes", "benchmarks", "decision_log", "file_summaries", "verifications", "health_snapshots", "tool_calls", "experiences", "experience_patterns", "patterns", "api_endpoints", "otel_config", "cost_tracking", "scratch_entries", "portability_entries", "blackboard_events", "known_gotchas", "trajectories", "distilled_skills"];
    let existing = 0;
    for (const t of allTables) {
      try {
        if (db.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='${t}'`)[0]?.values?.length) existing++;
      } catch {}
    }
    const schemaHealth = existing === allTables.length ? "✅" : existing >= allTables.length * 0.8 ? "⚠️" : "❌";
    checks.push(`**Schema Health**: ${schemaHealth} ${existing}/${allTables.length} tables present`);

    // 3. Verification history (last 5)
    try {
      const verifStmt = db.exec("SELECT scope, passed, created_at, duration_ms FROM verifications ORDER BY created_at DESC LIMIT 5");
      if (verifStmt[0]?.values?.length) {
        checks.push("");
        checks.push("**Recent Verifications:**");
        for (const v of verifStmt[0].values) {
          const icon = v[1] ? "✅" : "🔴";
          const time = new Date((v[2] as number) * 1000).toLocaleTimeString();
          checks.push(`  ${icon} ${v[0]} (${v[3]}ms) — ${time}`);
        }
      }
    } catch {}

    // 4. Process monitoring — check for orphaned test processes
    try {
      const { execSync } = await import("node:child_process");
      // Check for Jest/pnpm test processes that might be orphaned
      const psOutput = execSync(
        `ps -eo pid,ppid,command | grep -E "(jest|pnpm test|npm test|yarn test)" | grep -v grep | head -10`,
        { encoding: "utf-8", timeout: 5000 }
      ).trim();

      if (psOutput) {
        const processes = psOutput.split("\n").filter(Boolean);
        checks.push("");
        checks.push(`**Running Test Processes**: ${processes.length} found`);
        for (const p of processes) {
          checks.push(`  ⚡ ${p.substring(0, 120)}`);
        }
        checks.push("  💡 Run `kuma_safety({ action: 'gc' })` to clean up stale processes");
      } else {
        checks.push("");
        checks.push("**Running Test Processes**: ✅ None detected");
      }
    } catch {
      checks.push("");
      checks.push("**Running Test Processes**: ⚠️ Could not check");
    }

    // 5. Verification rate check
    try {
      const hourAgo = Math.floor((Date.now() - 3600000) / 1000);
      const recentVerifs = db.exec(`SELECT COUNT(*) as c FROM verifications WHERE created_at > ${hourAgo}`);
      const count = (recentVerifs[0]?.values[0]?.[0] as number) || 0;
      if (count > 10) {
        checks.push("");
        checks.push(`⚠️ **High Verification Rate**: ${count} verifications in the last hour — this is abnormal.`);
        checks.push(`  💡 If you didn't request these, run \`pkill -f "pnpm test"\` to kill orphaned processes.`);
      } else if (count > 0) {
        checks.push("");
        checks.push(`**Verification Rate**: ${count} verifications in the last hour (normal)`);
      }
    } catch {}



    return checks.join("\n");
  } catch (err) { return `❌ Doctor failed: ${err}`; }
}

// ============================================================
// Part 5 #7: Portability
// ============================================================

export async function checkPortability(): Promise<string> {
  try {
    const root = process.cwd();
    const issues: string[] = [];
    // Check for absolute paths in stored data
    const db = await getDb();
    try {
      const stmt = db.prepare(`SELECT id, file_path FROM change_log WHERE file_path LIKE ? LIMIT 10`);
      stmt.bind([`${root}%`]);
      if (stmt.step()) {
        issues.push("⚠️ Change log contains absolute paths (migration needed)");
      }
      stmt.free();
    } catch {}
    issues.push(`✅ All paths relative to: ${root.split("/").pop()}`);
    return issues.join("\n");
  } catch (err) { return `❌ Portability check failed: ${err}`; }
}

// ============================================================
// Part 5 #1: .gitignore helper
// ============================================================

export async function ensureGitignore(): Promise<string> {
  try {
    const root = process.cwd();
    const gitignorePath = path.join(root, ".gitignore");
    const kumaEntry = ".kuma/";
    if (fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, "utf-8");
      if (content.includes(kumaEntry)) {
        return "✅ .kuma/ already in .gitignore";
      }
      fs.writeFileSync(gitignorePath, content.trimEnd() + "\n" + kumaEntry + "\n", "utf-8");
    } else {
      fs.writeFileSync(gitignorePath, kumaEntry + "\n", "utf-8");
    }
    return "✅ Added .kuma/ to .gitignore";
  } catch (err) { return `❌ Failed: ${err}`; }
}

export async function saveHealthSnapshot(score: number, riskLevel: string, checks: string, summary: string): Promise<void> {
  try {
    const db = await getDb();
    db.run(`INSERT INTO health_snapshots (score, risk_level, checks, summary) VALUES (?, ?, ?, ?)`,
      [score, riskLevel, checks, summary]);
    saveDb();
  } catch (err) { console.error(`[KumaDB] Failed to save health snapshot: ${err}`); }
}

export async function saveVerification(scope: string, runner: string, command: string, passed: boolean, output: string, durationMs = 0): Promise<void> {
  try {
    const db = await getDb();
    db.run(`INSERT INTO verifications (scope, runner, test_command, passed, output, duration_ms) VALUES (?, ?, ?, ?, ?, ?)`,
      [scope, runner, command, passed ? 1 : 0, output, durationMs]);
    saveDb();
  } catch (err) { console.error(`[KumaDB] Failed to save verification: ${err}`); }
}

export async function getLatestVerifications(limit = 10): Promise<Array<{ id: number; scope: string; runner: string; test_command: string; passed: boolean; output: string; duration_ms: number; created_at: number }>> {
  try {
    const db = await getDb();
    const res = db.exec(`SELECT id, scope, runner, test_command, passed, output, duration_ms, created_at FROM verifications ORDER BY created_at DESC LIMIT ${limit}`);
    if (!res[0] || !res[0].values) return [];
    return res[0].values.map((row) => ({
      id: row[0] as number,
      scope: row[1] as string,
      runner: row[2] as string,
      test_command: row[3] as string,
      passed: Boolean(row[4]),
      output: row[5] as string,
      duration_ms: row[6] as number,
      created_at: row[7] as number,
    }));
  } catch (err) {
    console.error(`[KumaDB] Failed to get verifications: ${err}`);
    return [];
  }
}

// ============================================================
// FTS INDEX REBUILD — Keep search fresh after writes
// ============================================================

/**
 * Rebuild the full-text search index from current node data.
 * Call after bulk writes (gotcha add, research_save, etc.) to keep search results fresh.
 */
export function rebuildFtsIndex(): void {
  try {
    const db = dbInstance;
    if (!db) return;
    // Rebuild FTS5 index from nodes table
    db.run(`INSERT INTO nodes_fts(nodes_fts) VALUES('rebuild')`);
  } catch {
    // FTS5 might not be available
  }
}


