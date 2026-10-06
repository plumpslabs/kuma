// ============================================================
// COMPACTION CONTEXT — what must survive summarization
// ============================================================
// OpenDev (2026): compaction with progressive reduction; the harness
// must state what survives. This module builds the minimal survival
// set: goal + critical/high gotchas + dirty files + unresolved items.
// Served via `kuma hook pre-compact` (Claude PreCompact) and
// `experimental.session.compacting` (OpenCode plugin).
// Budget: ~600 chars, never a dump.
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "../utils/pathValidator.js";

const BUDGET = 600;

/** Build the survival set as plain text (empty = nothing worth keeping). */
export async function getCompactionContext(): Promise<string> {
  const parts: string[] = [];
  try {
    const { sessionMemory } = await import("./sessionMemory.js");
    const summary = sessionMemory.getSummary();
    const goal = String(summary.currentGoal || "");
    if (goal) parts.push(`Goal: ${goal.substring(0, 120)}`);
    const modified = ((summary.modifiedFiles as unknown[]) || []).length;
    if (modified > 0) parts.push(`Modified: ${modified} file(s)`);
  } catch {}
  // Critical/high gotchas (top 3, titles only)
  try {
    const dbFile = path.join(getProjectRoot(), ".kuma", "kuma.db");
    if (fs.existsSync(dbFile)) {
      const { getDb } = await import("./kumaDb.js");
      const db = await getDb();
      const stmt = db.prepare(
        `SELECT file_path, description FROM known_gotchas
         WHERE status IN ('active','verified') AND severity IN ('critical','high')
         AND (quarantined IS NULL OR quarantined = 0)
         ORDER BY updated_at DESC LIMIT 3`
      );
      const rows: string[] = [];
      while (stmt.step()) {
        const r = stmt.getAsObject() as { file_path: string; description: string };
        rows.push(`[${r.file_path}] ${String(r.description).substring(0, 80)}`);
      }
      stmt.free();
      if (rows.length > 0) parts.push(`Gotchas: ${rows.join(" | ")}`);
    }
  } catch {}
  // Dirty files (un-synced map state)
  try {
    const { getDirtyFiles } = await import("./cacheFreshness.js");
    const dirty = getDirtyFiles().slice(0, 5);
    if (dirty.length > 0) parts.push(`Dirty: ${dirty.join(", ")}`);
  } catch {}
  // Checkpoints worth keeping
  try {
    const cpDir = path.join(getProjectRoot(), ".kuma", "checkpoints");
    if (fs.existsSync(cpDir)) {
      const cps = fs.readdirSync(cpDir).slice(0, 3);
      if (cps.length > 0) parts.push(`Checkpoints: ${cps.join(", ")}`);
    }
  } catch {}
  let out = parts.join("\n");
  if (out.length > BUDGET) out = out.slice(0, BUDGET) + "…";
  return out;
}
