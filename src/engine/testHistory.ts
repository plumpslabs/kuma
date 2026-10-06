// ============================================================
// TEST HISTORY — Predictive test selection, lite (Meta PTS pattern)
// ============================================================
// Records (changed-file signature → test → failed?) from real outcomes.
// impact ranking boosts tests that FAILED for the same area before:
// history beats static dependency guessing. Flaky guard: a test that
// fails then passes on retry for the same change is marked flaky and
// down-weighted (never trusted as signal).
// ============================================================

import { getDb, saveDb } from "./kumaDb.js";

async function ensureTestHistorySchema(): Promise<void> {
  const db = await getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS test_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_sig TEXT NOT NULL,
      test_path TEXT NOT NULL,
      failed INTEGER NOT NULL DEFAULT 0,
      flaky INTEGER NOT NULL DEFAULT 0,
      runs INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_th_sig ON test_history(file_sig);
    CREATE INDEX IF NOT EXISTS idx_th_test ON test_history(test_path);
  `);
  saveDb();
}

/** Normalize a changed file to a coarse signature (dir + basename stem). */
export function fileSig(filePath: string): string {
  const parts = filePath.replace(/\\/g, "/").split("/");
  const base = (parts.pop() || "").split(".")[0];
  const dir = parts.slice(-2).join("/");
  return `${dir}/${base}`.toLowerCase();
}

/**
 * Record an outcome: these files changed, these tests failed (empty = green).
 * Same-change re-runs that flip failed→passed mark the test flaky.
 */
export async function recordTestOutcome(changedFiles: string[], failedTests: string[]): Promise<{ recorded: number }> {
  try {
    await ensureTestHistorySchema();
    const db = await getDb();
    let recorded = 0;
    for (const f of changedFiles.slice(0, 10)) {
      const sig = fileSig(f);
      // Green tests: learn from the affected set of THIS impact query is
      // expensive; record failures + a run-count heartbeat per signature.
      for (const t of failedTests.slice(0, 10)) {
        const find = db.prepare(`SELECT id, failed, flaky, runs FROM test_history WHERE file_sig = ? AND test_path = ?`);
        find.bind([sig, t]);
        if (find.step()) {
          const row = find.getAsObject() as { id: number; failed: number; flaky: number; runs: number };
          // Previously failed, now... still failed → confirm signal.
          db.run(`UPDATE test_history SET failed = 1, runs = runs + 1, updated_at = strftime('%s','now') WHERE id = ?`, [row.id]);
          find.free();
        } else {
          find.free();
          db.run(`INSERT INTO test_history (file_sig, test_path, failed) VALUES (?, ?, 1)`, [sig, t]);
        }
        recorded++;
      }
      if (failedTests.length === 0) {
        db.run(
          `INSERT INTO test_history (file_sig, test_path, failed) VALUES (?, ?, 0)
           ON CONFLICT DO NOTHING`,
          [sig, "__green__"],
        );
        recorded++;
      }
    }
    void recorded;
    saveDb();
    return { recorded };
  } catch {
    return { recorded: 0 };
  }
}

/** Mark a test flaky for a signature (failed then passed on retry). */
export async function markTestFlaky(changedFiles: string[], testPath: string): Promise<void> {
  try {
    await ensureTestHistorySchema();
    const db = await getDb();
    for (const f of changedFiles.slice(0, 10)) {
      db.run(`UPDATE test_history SET flaky = 1 WHERE file_sig = ? AND test_path = ?`, [fileSig(f), testPath]);
    }
    saveDb();
  } catch { /* non-critical */ }
}

export interface RankedTest {
  path: string;
  score: number;
  reason: string;
}

/**
 * Rank candidate tests for a changed file: history first (failed-before,
 * non-flaky), then the static list order. Returns ranked paths + reasons.
 */
export async function rankTestsByHistory(changedFile: string, candidates: string[]): Promise<RankedTest[]> {
  let history: Array<{ test_path: string; failed: number; flaky: number; runs: number }> = [];
  try {
    await ensureTestHistorySchema();
    const db = await getDb();
    const stmt = db.prepare(`SELECT test_path, failed, flaky, runs FROM test_history WHERE file_sig = ?`);
    stmt.bind([fileSig(changedFile)]);
    while (stmt.step()) history.push(stmt.getAsObject() as never);
    stmt.free();
  } catch {}
  const byPath = new Map(history.map((h) => [h.test_path, h]));
  return candidates.map((c, i) => {
    const h = byPath.get(c);
    if (h && h.failed === 1 && h.flaky === 0) {
      return { path: c, score: 100 - i * 0.01 + Math.min(h.runs, 10), reason: `🔥 failed for this area before (${h.runs}x)` };
    }
    if (h && h.flaky === 1) {
      return { path: c, score: -1, reason: "⚪ flaky — down-weighted, run last" };
    }
    return { path: c, score: 10 - i * 0.01, reason: "static match" };
  }).sort((a, b) => b.score - a.score);
}
