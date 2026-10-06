// ============================================================
// SYMBOL REACHABILITY — Issue #35 phase 2 (symbol → tests query)
// ============================================================
// Answers "which tests can REALLY reach this symbol" from graph edges
// (defines → calls → tests), with file:line evidence. Falls back to a
// bounded ripgrep wave when the graph is empty. Every row carries
// evidence — no verdict without it.
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { getProjectRoot } from "../utils/pathValidator.js";

export interface ReachRow {
  test: string;
  via: string;
  evidence: string;
}

const BERBEDA = 10;

/** Graph tier: symbol node → callers → test files. */
async function graphReach(symbol: string, limit: number): Promise<ReachRow[]> {
  const rows: ReachRow[] = [];
  try {
    const { getDb } = await import("./kumaDb.js");
    const db = await getDb();
    // 1. Candidate symbol nodes (function/class nodes matching the name)
    const symStmt = db.prepare(
      `SELECT id, file_path FROM nodes WHERE type IN ('function','class','method') AND (name = ? OR name LIKE ?) LIMIT 5`
    );
    symStmt.bind([symbol, `%::${symbol}`]);
    const symIds: Array<{ id: string; file: string }> = [];
    while (symStmt.step()) {
      const r = symStmt.getAsObject() as { id: string; file_path: string };
      symIds.push({ id: r.id, file: r.file_path });
    }
    symStmt.free();
    if (symIds.length === 0) return [];
    // 2. Callers of those symbols → their files
    for (const s of symIds) {
      const cStmt = db.prepare(
        `SELECT DISTINCT n_src.file_path as fp FROM edges e JOIN nodes n_src ON n_src.id = e.source_id WHERE e.target_id = ? AND e.type = 'calls' LIMIT 20`
      );
      cStmt.bind([s.id]);
      const callers = new Set<string>();
      while (cStmt.step()) {
        const fp = (cStmt.getAsObject() as { fp: string }).fp;
        if (fp) callers.add(fp);
      }
      cStmt.free();
      // 3. Tests covering the symbol file or its callers
      for (const fp of [...callers, s.file]) {
        const tStmt = db.prepare(
          `SELECT DISTINCT n.file_path as tfp FROM edges e JOIN nodes n ON n.id = e.source_id WHERE e.type = 'tests' AND (e.target_id LIKE ? OR e.target_id LIKE ?) LIMIT 5`
        );
        tStmt.bind([`%${fp}%`, `%${s.id}%`]);
        while (tStmt.step()) {
          const tfp = (tStmt.getAsObject() as { tfp: string }).tfp;
          if (tfp && !rows.some((r) => r.test === tfp)) {
            rows.push({ test: tfp, via: fp, evidence: `${tfp} tests ${fp} (graph edge)` });
          }
          if (rows.length >= limit) break;
        }
        tStmt.free();
        if (rows.length >= limit) break;
      }
      if (rows.length >= limit) break;
    }
  } catch { /* fall through to ripgrep tier */ }
  return rows;
}

/** Ripgrep tier: files calling symbol → sibling test files. */
function ripgrepReach(symbol: string, root: string, limit: number): ReachRow[] {
  const rows: ReachRow[] = [];
  try {
    const out = execSync(
      `grep -rn -F --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.py" --include="*.go" --include="*.rs" "${symbol.replace(/"/g, "")}" . 2>/dev/null | grep -v node_modules | grep -v "/dist/" | grep -v "/.git/" | grep -v "/.kuma/" | head -40`,
      { cwd: root, encoding: "utf-8", timeout: 8000, maxBuffer: 256 * 1024 },
    ).trim();
    if (!out) return [];
    const callers = new Set<string>();
    for (const line of out.split("\n")) {
      const m = line.match(/^([^:]+):(\d+):(.*)$/);
      if (!m) continue;
      const [, fp, ln, code] = m;
      if (new RegExp(`\\b${symbol}\\s*\\(`).test(code)) callers.add(`${fp}:${ln}`);
    }
    // Sibling tests: same dir, name contains caller stem or symbol
    for (const c of [...callers].slice(0, BERBEDA)) {
      const [fp] = c.split(":");
      const dir = path.dirname(fp);
      const stem = path.basename(fp, path.extname(fp)).split(/[-_.]/)[0];
      try {
        const dirFull = path.join(root, dir);
        if (!fs.existsSync(dirFull)) continue;
        for (const f of fs.readdirSync(dirFull)) {
          if (!/(\.test\.|\.spec\.|_test\.)/i.test(f)) continue;
          const low = f.toLowerCase();
          if (low.includes(stem.toLowerCase()) || low.includes(symbol.toLowerCase())) {
            const rel = path.join(dir, f);
            if (!rows.some((r) => r.test === rel)) {
              rows.push({ test: rel, via: fp, evidence: `${rel} sibling-matches caller ${fp} (called at ${c})` });
            }
          }
          if (rows.length >= limit) break;
        }
      } catch {}
      if (rows.length >= limit) break;
    }
  } catch { /* grep exit 1 = no match */ }
  return rows;
}

/**
 * Reachability query: which tests reach `symbol`.
 * Graph tier first (grounded edges), ripgrep tier when empty.
 */
export async function symbolReachability(symbol: string, limit = 10, root?: string): Promise<{ tier: 1 | 2; rows: ReachRow[] }> {
  const g = await graphReach(symbol, limit);
  if (g.length > 0) return { tier: 1, rows: g };
  return { tier: 2, rows: ripgrepReach(symbol, root || getProjectRoot(), limit) };
}

export function formatReachability(symbol: string, tier: 1 | 2, rows: ReachRow[]): string {
  if (rows.length === 0) return `🔎 Reachability \`${symbol}\` (tier ${tier}): no tests reach this symbol.`;
  const lines = [`🔎 Reachability \`${symbol}\` (tier ${tier}, ${rows.length} test(s)):`];
  for (const r of rows.slice(0, 5)) lines.push(`  • \`${r.test}\` via \`${r.via}\` — ${r.evidence}`);
  return lines.join("\n");
}
