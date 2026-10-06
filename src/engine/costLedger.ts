// ============================================================
// COST LEDGER — cost-per-success instrumentation (not token counts)
// ============================================================
// The MCP server never sees model tokens, so it records what it CAN
// measure per tool call: duration, output size (chars), and outcome.
// Agents/CI may attach real token counts via `tokens`. Aggregates answer
// "which intervention costs what per success" — the honest metric.
// ============================================================

import { getDb, saveDb } from "./kumaDb.js";

export interface CostRecord {
  tool: string;
  action?: string;
  durationMs: number;
  outputChars: number;
  outcome: "ok" | "error";
  tokens?: number;
}

async function ensureCostSchema(): Promise<void> {
  const db = await getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS cost_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tool TEXT NOT NULL,
      action TEXT,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      output_chars INTEGER NOT NULL DEFAULT 0,
      outcome TEXT NOT NULL DEFAULT 'ok',
      tokens INTEGER,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_cost_tool ON cost_ledger(tool);
  `);
  saveDb();
}

/** Record one tool call's cost (fire-and-forget, never throws). */
export async function recordCost(r: CostRecord): Promise<void> {
  try {
    await ensureCostSchema();
    const db = await getDb();
    db.run(
      `INSERT INTO cost_ledger (tool, action, duration_ms, output_chars, outcome, tokens) VALUES (?, ?, ?, ?, ?, ?)`,
      [r.tool, r.action || null, Math.round(r.durationMs), r.outputChars, r.outcome, r.tokens ?? null],
    );
    saveDb();
  } catch { /* non-critical */ }
}

export interface CostStats {
  tool: string;
  calls: number;
  errors: number;
  avgMs: number;
  avgChars: number;
  totalTokens: number | null;
}

/** Aggregate cost-per-tool (the publishable signal). */
export async function getCostStats(limit = 15): Promise<CostStats[]> {
  try {
    await ensureCostSchema();
    const db = await getDb();
    const stmt = db.prepare(`
      SELECT tool, COUNT(*) as calls,
        SUM(CASE WHEN outcome = 'error' THEN 1 ELSE 0 END) as errors,
        AVG(duration_ms) as avgMs, AVG(output_chars) as avgChars,
        SUM(tokens) as totalTokens
      FROM cost_ledger GROUP BY tool ORDER BY calls DESC LIMIT ?
    `);
    stmt.bind([limit]);
    const out: CostStats[] = [];
    while (stmt.step()) {
      const r = stmt.getAsObject() as Record<string, unknown>;
      out.push({
        tool: String(r.tool),
        calls: Number(r.calls) || 0,
        errors: Number(r.errors) || 0,
        avgMs: Math.round(Number(r.avgMs) || 0),
        avgChars: Math.round(Number(r.avgChars) || 0),
        totalTokens: r.totalTokens === null ? null : Number(r.totalTokens),
      });
    }
    stmt.free();
    return out;
  } catch {
    return [];
  }
}

export function formatCostStats(rows: CostStats[]): string {
  if (rows.length === 0) return "💰 **Cost ledger** — no tool calls recorded yet.";
  const lines = ["💰 **Cost per tool** (duration × output size → cost-per-success signal)", ""];
  for (const r of rows) {
    const err = r.errors > 0 ? `, ❌${r.errors}` : "";
    const tok = r.totalTokens !== null ? `, ${r.totalTokens} tokens` : "";
    lines.push(`  • \`${r.tool}\` — ${r.calls} call(s), ~${r.avgMs}ms, ~${r.avgChars} chars${err}${tok}`);
  }
  return lines.join("\n");
}

/** Wrap an async handler with cost recording. */
export async function withCost<T>(tool: string, action: string | undefined, fn: () => Promise<T>): Promise<{ result: T; outcome: "ok" | "error" }> {
  const start = Date.now();
  try {
    const result = await fn();
    const chars = typeof result === "string" ? result.length : JSON.stringify(result ?? "").length;
    await recordCost({ tool, action, durationMs: Date.now() - start, outputChars: chars, outcome: "ok" });
    return { result, outcome: "ok" };
  } catch (err) {
    await recordCost({ tool, action, durationMs: Date.now() - start, outputChars: String(err).length, outcome: "error" });
    throw err;
  }
}
