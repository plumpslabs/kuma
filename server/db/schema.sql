-- ============================================================
-- KOLEKTIF — Collective Intelligence Database Schema
-- ============================================================
-- Stores anonymized patterns from Kuma instances worldwide.
-- No source code, no file paths, no function names.
-- ============================================================

-- Raw pattern submissions (append-only audit trail)
CREATE TABLE IF NOT EXISTS patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_id TEXT NOT NULL,
  kuma_version TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'unknown',
  pattern_type TEXT NOT NULL,         -- 'error_frequency' | 'tool_sequence' | 'node_distribution'
  data TEXT NOT NULL,                 -- JSON payload
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

-- Aggregated patterns for fast querying
CREATE TABLE IF NOT EXISTS pattern_aggregates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  language TEXT NOT NULL,
  pattern_type TEXT NOT NULL,
  fingerprint TEXT NOT NULL,           -- content hash for dedup
  global_count INTEGER DEFAULT 0,
  global_success_rate REAL DEFAULT 0.0,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  UNIQUE(language, pattern_type, fingerprint)
);

-- Anonymous contributor tracking
CREATE TABLE IF NOT EXISTS contributors (
  instance_id TEXT PRIMARY KEY,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  total_submissions INTEGER DEFAULT 0
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_patterns_lang ON patterns(language);
CREATE INDEX IF NOT EXISTS idx_patterns_type ON patterns(pattern_type);
CREATE INDEX IF NOT EXISTS idx_patterns_created ON patterns(created_at);
CREATE INDEX IF NOT EXISTS idx_agg_lang ON pattern_aggregates(language, pattern_type);
