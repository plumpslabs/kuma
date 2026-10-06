// ============================================================
// GUARD LEDGER — Issue #36 (precision-tracked safety)
// ============================================================
// Every guard flag is recorded (rule → verdict → timestamp).
// Post-hoc feedback marks false positives; rules exceeding the FP
// budget are auto-downtiered (alert fatigue is a safety bug).
// Computational-first: pure SQLite, zero LLM, ~1ms per call.
// ============================================================

import { getDb, saveDb } from "./kumaDb.js";

export const GUARD_FP_BUDGET_RATE = 0.5;
export const GUARD_FP_MIN_FEEDBACK = 5;

async function ensureLedgerSchema(): Promise<void> {
  const db = await getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS guard_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule TEXT NOT NULL,
      verdict TEXT NOT NULL DEFAULT 'flag',
      false_positive INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ledger_rule ON guard_ledger(rule);
  `);
  saveDb();
}

/** Record a guard flag (call for every warning pattern emitted). */
export async function recordGuardFlag(rule: string): Promise<void> {
  try {
    await ensureLedgerSchema();
    const db = await getDb();
    db.run(`INSERT INTO guard_ledger (rule, verdict) VALUES (?, 'flag')`, [rule]);
    saveDb();
  } catch { /* non-critical */ }
}

/**
 * Post-hoc feedback: was this rule's flag a false positive?
 * (Called by evals, CI, or explicit human/agent feedback.)
 */
export async function recordGuardFeedback(rule: string, wasFalsePositive: boolean): Promise<void> {
  try {
    await ensureLedgerSchema();
    const db = await getDb();
    db.run(
      `INSERT INTO guard_ledger (rule, verdict, false_positive) VALUES (?, 'feedback', ?)`,
      [rule, wasFalsePositive ? 1 : 0],
    );
    saveDb();
  } catch { /* non-critical */ }
}

export interface RulePrecision {
  rule: string;
  flags: number;
  feedbacks: number;
  falsePositives: number;
  fpRate: number | null;
  overBudget: boolean;
}

/** Per-rule precision table (published signal for #36 acceptance). */
export async function getRulePrecision(): Promise<RulePrecision[]> {
  try {
    await ensureLedgerSchema();
    const db = await getDb();
    const stmt = db.prepare(`
      SELECT rule,
        SUM(CASE WHEN verdict = 'flag' THEN 1 ELSE 0 END) as flags,
        SUM(CASE WHEN verdict = 'feedback' THEN 1 ELSE 0 END) as feedbacks,
        SUM(CASE WHEN verdict = 'feedback' AND false_positive = 1 THEN 1 ELSE 0 END) as fps
      FROM guard_ledger GROUP BY rule
    `);
    const out: RulePrecision[] = [];
    while (stmt.step()) {
      const r = stmt.getAsObject() as { rule: string; flags: number; feedbacks: number; fps: number };
      const fpRate = r.feedbacks >= GUARD_FP_MIN_FEEDBACK ? r.fps / r.feedbacks : null;
      out.push({
        rule: r.rule,
        flags: Number(r.flags) || 0,
        feedbacks: Number(r.feedbacks) || 0,
        falsePositives: Number(r.fps) || 0,
        fpRate,
        overBudget: fpRate !== null && fpRate > GUARD_FP_BUDGET_RATE,
      });
    }
    stmt.free();
    return out;
  } catch {
    return [];
  }
}

/** Rules currently over budget → demote one severity level. */
export async function getDowntieredRules(): Promise<Set<string>> {
  const precision = await getRulePrecision();
  return new Set(precision.filter((p) => p.overBudget).map((p) => p.rule));
}

export function demoteSeverity(sev: string): string {
  if (sev === "high") return "medium";
  if (sev === "medium") return "low";
  return "low";
}

export function formatPrecisionLedger(rows: RulePrecision[]): string {
  if (rows.length === 0) return "📏 **Guard precision ledger** — no flags recorded yet.";
  const lines = ["📏 **Guard precision ledger** (per-rule, FP budget 50% / ≥5 feedbacks)", ""];
  for (const r of rows) {
    const fp = r.fpRate === null ? "n/a" : `${Math.round(r.fpRate * 100)}%`;
    lines.push(`  ${r.overBudget ? "🔻" : "✅"} \`${r.rule}\` — ${r.flags} flag(s), FP ${fp}${r.overBudget ? " OVER BUDGET (auto-downtiered)" : ""}`);
  }
  return lines.join("\n");
}
