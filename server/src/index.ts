// ============================================================
// KOLEKTIF — Kuma Collective Intelligence Server
// ============================================================
// Runs on your VPS — receives anonymized patterns from Kuma
// instances and returns aggregated cross-project insights.
//
// Endpoints:
//   POST /api/v1/patterns      — Submit patterns from a Kuma instance
//   GET  /api/v1/patterns      — Get aggregated patterns (opt. ?lang=)
//   GET  /api/v1/stats         — Dashboard stats
//   GET  /health               — Health check
// ============================================================
//
// Usage:
//   npm run build && node dist/index.js
//   npm run dev (tsx watch)
// ============================================================

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";

import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ============================================================
// DATABASE INIT
// ============================================================

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH =
  process.env.KUMA_DB_PATH || join(__dirname, "..", "data", "kolektif.db");

function initDb(): Database.Database {
  const dataDir = dirname(DB_PATH);
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  // Run schema
  const schemaPath = join(__dirname, "..", "db", "schema.sql");
  if (existsSync(schemaPath)) {
    const schema = readFileSync(schemaPath, "utf-8");
    db.exec(schema);
  } else {
    db.exec(`
      CREATE TABLE IF NOT EXISTS patterns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        instance_id TEXT NOT NULL,
        kuma_version TEXT NOT NULL,
        language TEXT NOT NULL DEFAULT 'unknown',
        pattern_type TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      );
      CREATE TABLE IF NOT EXISTS pattern_aggregates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        language TEXT NOT NULL,
        pattern_type TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        global_count INTEGER DEFAULT 0,
        global_success_rate REAL DEFAULT 0.0,
        first_seen_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        UNIQUE(language, pattern_type, fingerprint)
      );
      CREATE TABLE IF NOT EXISTS contributors (
        instance_id TEXT PRIMARY KEY,
        first_seen_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        total_submissions INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_patterns_lang ON patterns(language);
      CREATE INDEX IF NOT EXISTS idx_patterns_type ON patterns(pattern_type);
      CREATE INDEX IF NOT EXISTS idx_patterns_created ON patterns(created_at);
      CREATE INDEX IF NOT EXISTS idx_agg_lang ON pattern_aggregates(language, pattern_type);
    `);
  }

  return db;
}

const db = initDb();

// ============================================================
// HELPERS
// ============================================================

function fingerprint(data: Record<string, unknown>): string {
  const hash = createHash("sha256");
  hash.update(JSON.stringify(data));
  return hash.digest("hex").slice(0, 16);
}

function now(): number {
  return Math.floor(Date.now() / 1000);
}

// ============================================================
// SERVER
// ============================================================

const app = new Hono();
app.use("/*", cors());

// ── Health ──
app.get("/health", (c) => {
  const patternCount =
    (db.prepare("SELECT COUNT(*) as c FROM patterns").get() as { c: number })
      ?.c ?? 0;
  const contributorCount =
    (
      db.prepare("SELECT COUNT(*) as c FROM contributors").get() as {
        c: number;
      }
    )?.c ?? 0;
  return c.json({
    status: "ok",
    version: "1.0.0",
    uptime: process.uptime(),
    totalPatterns: patternCount,
    totalContributors: contributorCount,
  });
});

// ── POST /api/v1/patterns — Submit patterns ──
app.post("/api/v1/patterns", async (c) => {
  try {
    const body = await c.req.json();
    const instanceId = body.instanceId || `anon-${randomUUID().slice(0, 8)}`;
    const kumaVersion = body.version || "unknown";
    const language = body.language || "unknown";
    const patterns = body.patterns || [];

    if (!Array.isArray(patterns) || patterns.length === 0) {
      return c.json({ error: "patterns must be a non-empty array" }, 400);
    }

    // Record contributor
    const upsertContributor = db.prepare(`
      INSERT INTO contributors (instance_id, first_seen_at, last_seen_at, total_submissions)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(instance_id) DO UPDATE SET
        last_seen_at = ?,
        total_submissions = total_submissions + 1
    `);
    upsertContributor.run(instanceId, now(), now(), now());

    // Insert patterns + update aggregates in a single transaction
    const insertPattern = db.prepare(`
      INSERT INTO patterns (instance_id, kuma_version, language, pattern_type, data, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const upsertAggregate = db.prepare(`
      INSERT INTO pattern_aggregates (language, pattern_type, fingerprint, global_count, global_success_rate, first_seen_at, last_seen_at)
      VALUES (?, ?, ?, 1, ?, ?, ?)
      ON CONFLICT(language, pattern_type, fingerprint) DO UPDATE SET
        global_count = global_count + 1,
        global_success_rate = (global_success_rate * (global_count - 1) + ?) / global_count,
        last_seen_at = ?
    `);

    const tx = db.transaction(() => {
      for (const pattern of patterns) {
        const fp = fingerprint(pattern);
        const type = pattern.type || "unknown";
        const successRate = pattern.successRate ?? 0;
        insertPattern.run(
          instanceId,
          kumaVersion,
          language,
          type,
          JSON.stringify(pattern),
          now(),
        );
        upsertAggregate.run(
          language,
          type,
          fp,
          successRate,
          now(),
          now(),
          successRate,
          now(),
        );
      }
    });
    tx();

    return c.json({
      received: patterns.length,
      message: `✅ ${patterns.length} pattern(s) recorded from ${language}`,
    });
  } catch (err) {
    return c.json({ error: `Failed to process patterns: ${err}` }, 500);
  }
});

// ── GET /api/v1/patterns — Get aggregated patterns ──
app.get("/api/v1/patterns", (c) => {
  try {
    const language = c.req.query("lang") || null;
    const type = c.req.query("type") || null;
    const limit = Math.min(parseInt(c.req.query("limit") || "50"), 100);

    let sql = "SELECT * FROM pattern_aggregates WHERE 1=1";
    const params: unknown[] = [];

    if (language) {
      sql += " AND language = ?";
      params.push(language);
    }
    if (type) {
      sql += " AND pattern_type = ?";
      params.push(type);
    }

    sql += " ORDER BY global_count DESC LIMIT ?";
    params.push(limit);

    const rows = db.prepare(sql).all(...params) as Array<
      Record<string, unknown>
    >;
    const totalContributors =
      (
        db.prepare("SELECT COUNT(*) as c FROM contributors").get() as {
          c: number;
        }
      )?.c ?? 0;

    return c.json({
      language: language || "all",
      totalContributors,
      totalPatterns: rows.length,
      patterns: rows.map((r) => ({
        patternType: r.pattern_type,
        language: r.language,
        globalCount: r.global_count,
        globalSuccessRate: r.global_success_rate,
        lastSeen: r.last_seen_at,
      })),
    });
  } catch (err) {
    return c.json({ error: `Failed to query patterns: ${err}` }, 500);
  }
});

// ── GET /api/v1/stats — Dashboard statistics ──
app.get("/api/v1/stats", (c) => {
  try {
    const totalPatterns =
      (db.prepare("SELECT COUNT(*) as c FROM patterns").get() as { c: number })
        ?.c ?? 0;
    const totalContributors =
      (
        db.prepare("SELECT COUNT(*) as c FROM contributors").get() as {
          c: number;
        }
      )?.c ?? 0;

    const langRows = db
      .prepare(
        `
      SELECT language, COUNT(*) as cnt FROM pattern_aggregates
      GROUP BY language ORDER BY cnt DESC LIMIT 10
    `,
      )
      .all() as Array<Record<string, unknown>>;

    const topRows = db
      .prepare(
        `
      SELECT language, pattern_type, global_count, global_success_rate
      FROM pattern_aggregates ORDER BY global_count DESC LIMIT 20
    `,
      )
      .all() as Array<Record<string, unknown>>;

    return c.json({
      totalPatterns,
      totalContributors,
      languages: Object.fromEntries(langRows.map((r) => [r.language, r.cnt])),
      topPatterns: topRows.map((r) => ({
        language: r.language,
        patternType: r.pattern_type,
        count: r.global_count,
        successRate: r.global_success_rate,
      })),
    });
  } catch (err) {
    return c.json({ error: `Failed to get stats: ${err}` }, 500);
  }
});

// ── Start server (via @hono/node-server) ──
const PORT = parseInt(process.env.PORT || "3000");
const HOST = process.env.HOST || "0.0.0.0";

console.log(`
🐻 Kolektif Server v1.0.0
━━━━━━━━━━━━━━━━━━━━━━━━━━━
📍 http://${HOST}:${PORT}
📊 Database: ${DB_PATH}
`);

serve({ fetch: app.fetch, port: PORT, hostname: HOST });
console.log("🚀 Server started");

export default app;
