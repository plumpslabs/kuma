// ============================================================
// KUMA INJECT — Shadow Memory (Roadmap F2/F3/F4/F5)
// ============================================================
// Injects "where is this file fragile and why is it written this
// way" right BEFORE the agent touches it — via the Claude Code
// PreToolUse hook (`kuma hook pre-edit`) and
// `kuma_context({ action: "history" })`.
//
// Principles (Roadmap 3.2):
//   - Code & markdown remain the source of truth; the DB is only a cache.
//   - Gotcha freshness is validated via content_hash (F3).
//   - Selective output: 3-5 most relevant gotchas/decisions, <500 tokens (F4).
//   - Zero extra steps required from the agent (F2).
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "../utils/pathValidator.js";
import { hashFile } from "./kumaDriftDetector.js";

const MAX_INJECT_CHARS = 2400; // ~400 token budget — never dump

// I5/I3 — hook-side state (dedupe + loop auto-capture)
const HOOK_STATE_FILE = ".kuma/hook-state.json";
const INJECT_DEDUPE_MS = 15 * 60 * 1000; // I5: don't re-inject the same file within 15 min
const LOOP_THRESHOLD = 4; // I3: 4+ edits to the same file = potential fragility
const LOOP_WINDOW_MS = 30 * 60 * 1000;

// ============================================================
// F3 — CONTENT HASH (staleness detection)
// ============================================================

/**
 * SHA-256 of a file's content. Returns null if the file is missing
 * or cannot be read. Delegates to kumaDriftDetector (single source
 * of file hashing in the codebase).
 */
export function hashFileContent(filePath: string): string | null {
  return hashFile(filePath);
}

/**
 * F3: a gotcha is considered FRESH when:
 *  - no hash was stored (legacy/unknown → do not drop prematurely), OR
 *  - the stored hash matches the current file content.
 * When the file changes, the hash differs and the gotcha is excluded
 * from injection (ranked down, never deleted).
 */
export function isGotchaFresh(
  storedHash: string | null | undefined,
  currentHash: string | null,
): boolean {
  if (!storedHash) return true; // unknown → assume fresh
  if (!currentHash) return true; // file gone → handled by self-heal
  return storedHash === currentHash;
}

// ============================================================
// F3 — FRESH GOTCHA QUERY (DB + markdown fallback)
// ============================================================

export interface FreshGotcha {
  id?: number;
  filePath: string;
  description: string;
  severity: string;
  workaround: string | null;
  stale: boolean;
}

/**
 * Fetches active gotchas for a file, ordered by severity
 * (critical > high > medium > low), keeping only FRESH ones
 * (hash matches / not yet hashed). Small limit = relevance (F4).
 * If the DB is not present yet (fresh project), falls back to reading
 * the markdown layer — cheap and side-effect free.
 */
export async function getFreshGotchasForFile(
  filePath: string,
  limit = 5,
): Promise<FreshGotcha[]> {
  const root = getProjectRoot();
  // 1. Structured DB — but never trigger DB creation from the hook
  try {
    const dbFile = path.join(root, ".kuma", "kuma.db");
    if (fs.existsSync(dbFile)) {
      const { getDb } = await import("./kumaDb.js");
      const db = await getDb();
      const stmt = db.prepare(`
        SELECT id, file_path, description, severity, workaround, content_hash
        FROM known_gotchas
        WHERE status = 'active'
          AND (file_path = ? OR ? LIKE ('%' || file_path || '%'))
        ORDER BY
          CASE WHEN file_path = ? THEN 0 ELSE 1 END, -- exact match first
          CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
          updated_at DESC
        LIMIT ?
      `);
      stmt.bind([filePath, filePath, filePath, limit]);
      const rows: Array<Record<string, unknown>> = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();

      const currentHash = hashFileContent(filePath);
      return rows
        .map((r) => ({
          id: r.id as number,
          filePath: r.file_path as string,
          description: r.description as string,
          severity: r.severity as string,
          workaround: (r.workaround as string | null) ?? null,
          stale: !isGotchaFresh((r.content_hash as string | null) ?? null, currentHash),
        }))
        .filter((g) => !g.stale)
        .slice(0, limit);
    }
  } catch { /* non-critical — fall through to markdown */ }

  // 2. Markdown fallback — only when .kuma already exists so the hook
  //    stays read-only and side-effect free (never creates .kuma files)
  try {
    if (!fs.existsSync(path.join(root, ".kuma"))) return [];
    const { checkFileGotchas } = await import("./domainRules.js");
    const warnings = checkFileGotchas(filePath) as unknown as string[];
    if (warnings.length === 0) return [];
    return warnings.slice(0, limit).map((w) => ({
      filePath,
      description: w,
      severity: "medium",
      workaround: null,
      stale: false,
    }));
  } catch {
    return [];
  }
}

// ============================================================
// F5 — CROSS-SESSION TRACE ("why is this file written this way")
// ============================================================

export interface FileTraceEntry {
  changeType: string;
  filePath: string;
  symbol: string | null;
  goal: string | null;
  createdAt: number;
}

/** File change history from change_log (joined with session goals). */
export async function getFileTrace(filePath: string, limit = 8): Promise<FileTraceEntry[]> {
  try {
    const root = getProjectRoot();
    const dbFile = path.join(root, ".kuma", "kuma.db");
    if (!fs.existsSync(dbFile)) return [];
    const { getDb } = await import("./kumaDb.js");
    const db = await getDb();
    const stmt = db.prepare(`
      SELECT cl.change_type, cl.file_path, cl.symbol, cl.created_at, s.goal
      FROM change_log cl LEFT JOIN sessions s ON s.id = cl.session_id
      WHERE cl.file_path LIKE ?
      ORDER BY cl.created_at DESC
      LIMIT ?
    `);
    stmt.bind([`%${path.basename(filePath)}%`, limit]);
    const rows: Array<Record<string, unknown>> = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows.map((r) => ({
      changeType: r.change_type as string,
      filePath: r.file_path as string,
      symbol: (r.symbol as string | null) ?? null,
      goal: (r.goal as string | null) ?? null,
      createdAt: (r.created_at as number) || 0,
    }));
  } catch {
    return [];
  }
}

const TRACE_ICONS: Record<string, string> = {
  created: "✨",
  modified: "📝",
  deleted: "❌",
};

/** Formats change history as a concise narrative (not a dump). */
export function formatFileTrace(entries: FileTraceEntry[], filePath: string): string {
  if (entries.length === 0) return "";
  const lines = [
    `🕰️ **Why is ${path.basename(filePath)} written this way?** — ${entries.length} change(s) recorded:`,
  ];
  for (const e of entries) {
    const date = new Date((e.createdAt || 0) * 1000).toLocaleDateString("en-US", {
      day: "numeric",
      month: "short",
    });
    const icon = TRACE_ICONS[e.changeType] || "📝";
    const goal = e.goal ? ` — *${e.goal.substring(0, 60)}*` : "";
    lines.push(`  ${icon} ${date} ${e.changeType}${goal}`);
  }
  return lines.join("\n");
}

// ============================================================
// F4 — RELEVANCE RANKING (decisions from markdown memory)
// ============================================================

/** Relevant decisions/knowledge for a file (from .kuma/memories/*.md via scoring). */
export async function getDecisionsForFile(filePath: string, limit = 3): Promise<string[]> {
  try {
    const { scoreMemoryRelevance } = await import("./kumaMemory.js");
    const base = path.basename(filePath);
    const scored = scoreMemoryRelevance(`${filePath} ${base}`, limit);
    return scored.map((m) => `📌 ${m.topic} — ${m.score}% match (${m.reason})`);
  } catch {
    return [];
  }
}

// ============================================================
// F2/F4 — INJECT CONTEXT COMPOSITION (<500 tokens)
// ============================================================

/**
 * Composes the "shadow memory" for a file: fresh gotchas + relevant
 * decisions + cross-session trace. Plain-text, compact output with a
 * ~400 token budget. An empty string means "inject nothing"
 * (anti-noise, Roadmap F10).
 */
export async function getRelevantContext(
  filePath: string,
  goal?: string,
): Promise<string> {
  const parts: string[] = [];

  // 1. Fresh gotchas (F3 + F4)
  const gotchas = await getFreshGotchasForFile(filePath, 4);
  if (gotchas.length > 0) {
    const lines = ["⚠️ ACTIVE GOTCHAS (fresh):"];
    for (const g of gotchas) {
      const icon =
        g.severity === "critical" ? "🔴" : g.severity === "high" ? "🟠" : g.severity === "medium" ? "🟡" : "🟢";
      lines.push(`  ${icon} [${g.severity}] ${g.description}`);
      if (g.workaround) lines.push(`     💡 ${g.workaround.substring(0, 140)}`);
    }
    parts.push(lines.join("\n"));
  }

  // 2. Relevant decisions (F4 — goal keywords + file name)
  const decisions = await getDecisionsForFile(filePath, goal ? 3 : 2);
  if (decisions.length > 0) {
    parts.push("📌 RELEVANT DECISIONS:\n  " + decisions.join("\n  "));
  }

  // 3. Cross-session trace (F5)
  const trace = await getFileTrace(filePath, 5);
  const traceStr = formatFileTrace(trace, filePath);
  if (traceStr) parts.push(traceStr);

  // 4. I1: regression watch — previously resolved gotchas on this file
  try {
    const root = getProjectRoot();
    if (fs.existsSync(path.join(root, ".kuma", "kuma.db"))) {
      const { getDb } = await import("./kumaDb.js");
      const db = await getDb();
      const stmt = db.prepare(
        `SELECT COUNT(*) FROM known_gotchas WHERE status = 'resolved' AND file_path LIKE ?`
      );
      stmt.bind([`%${path.basename(filePath)}%`]);
      const found = stmt.step();
      const count = found ? Number((stmt.getAsObject() as Record<string, unknown>)["COUNT(*)"]) : 0;
      stmt.free();
      if (count > 0) {
        parts.push(`⚠️ Regression watch: ${count} gotcha(s) previously resolved on this file — confirm your change does not reintroduce them.`);
      }
    }
  } catch { /* non-critical */ }

  // 5. I6: verify hint — close the edit→verify loop proactively
  if (gotchas.length > 0) {
    const scopeHint = path.basename(path.dirname(filePath)) || "current change";
    parts.push(
      `✅ AFTER editing, verify: kuma_safety({ action: "verify", scope: "${scopeHint}" })`
    );
  }

  // 6. Auto-digest: file summary — count of gotchas, decisions, resolved (P0 evolution)
  const summary = await getFileSummary(filePath);
  if (summary) parts.push(summary);

  let out = parts.join("\n\n");
  if (out.length > MAX_INJECT_CHARS) {
    out = out.substring(0, MAX_INJECT_CHARS) + "\n…(truncated — use kuma_context history for the full view)";
  }
  return out;
}

/**
 * P0: Auto-digest — inject a compact file summary showing gotcha count,
 * decision count, and resolved count. This is the evolution of F2:
 * not just injecting raw gotchas, but injecting *context* about the file.
 */
export async function getFileSummary(filePath: string): Promise<string | null> {
  try {
    const root = getProjectRoot();
    const dbFile = path.join(root, ".kuma", "kuma.db");
    if (!fs.existsSync(dbFile)) return null;
    const { getDb } = await import("./kumaDb.js");
    const db = await getDb();

    const base = path.basename(filePath);
    const stmt = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM known_gotchas WHERE status = 'active' AND (file_path = ? OR file_path LIKE ?)) as active_gotchas,
        (SELECT COUNT(*) FROM known_gotchas WHERE status = 'resolved' AND (file_path = ? OR file_path LIKE ?)) as resolved_gotchas,
        (SELECT COUNT(*) FROM nodes WHERE type = 'decision' AND (file_path = ? OR name LIKE ?)) as decisions
    `);
    stmt.bind([filePath, `%${base}%`, filePath, `%${base}%`, filePath, `%${base}%`]);
    const hasRow = stmt.step();
    if (!hasRow) { stmt.free(); return null; }
    const row = stmt.getAsObject() as Record<string, unknown>;
    stmt.free();

    const active = Number(row.active_gotchas ?? 0);
    const resolved = Number(row.resolved_gotchas ?? 0);
    const decisions = Number(row.decisions ?? 0);

    const parts: string[] = [];
    if (active > 0) parts.push(`⚠️ ${active} active gotcha(s)`);
    if (resolved > 0) parts.push(`✅ ${resolved} resolved`);
    if (decisions > 0) parts.push(`📌 ${decisions} decision(s)`);

    if (parts.length === 0) return null;
    return `📄 **${base}**: ${parts.join(" · ")}`;
  } catch {
    return null;
  }
}

// ============================================================
// F2 — CLAUDE CODE PRETOOLUSE HOOK (stdin JSON → stdout JSON)
// ============================================================

export interface HookInput {
  filePaths: string[];
  goal?: string;
}

/**
 * Parses the Claude Code hook stdin payload:
 * { tool_name, tool_input: { file_path?, new_file_path?, notebook_path?, ... } }
 */
export function parseHookInput(raw: string): HookInput {
  try {
    const data = JSON.parse(raw);
    const ti = (data && typeof data === "object" ? data.tool_input : {}) || {};
    const paths = new Set<string>();
    const add = (p: unknown): void => {
      if (typeof p === "string" && p.trim()) paths.add(p.trim());
    };
    add(ti.file_path);
    add(ti.new_file_path);
    add(ti.notebook_path);
    if (Array.isArray(ti.file_paths)) ti.file_paths.forEach(add);
    return {
      filePaths: [...paths],
      goal: typeof ti.goal === "string" ? ti.goal : undefined,
    };
  } catch {
    return { filePaths: [] };
  }
}

/** Builds the PreToolUse response: {} = no injection, or inject via additionalContext. */
export function buildHookResponse(context: string): string {
  if (!context || !context.trim()) return "{}";
  return JSON.stringify({
    hookSpecificOutput: {
      hookSpecificOutput: {
        additionalContext:
          "📡 [KUMA shadow memory — read before editing this file]\n" + context,
      },
    },
  });
}

// ============================================================
// I2 — COMMAND-TRIGGER GOTCHAS (Bash PreToolUse hook)
// ============================================================

/**
 * Composes a compact inject payload for a shell command (e.g. "npm run seed")
 * using gotchas that carry a trigger_command. Empty string = inject nothing.
 */
export async function getCommandContext(command: string): Promise<string> {
  try {
    const { getActiveGotchasForCommand } = await import("./kumaGotchas.js");
    const gotchas = await getActiveGotchasForCommand(command);
    if (gotchas.length === 0) return "";

    const lines = ["⌨️ [KUMA shadow memory] — this command has known gotchas:"];
    for (const g of gotchas.slice(0, 4)) {
      const icon =
        g.severity === "critical" ? "🔴" : g.severity === "high" ? "🟠" : g.severity === "medium" ? "🟡" : "🟢";
      lines.push(`  ${icon} [${g.severity}] ${g.description}`);
      if (g.workaround) lines.push(`     💡 ${g.workaround.substring(0, 140)}`);
    }
    let out = lines.join("\n");
    if (out.length > MAX_INJECT_CHARS) out = out.substring(0, MAX_INJECT_CHARS);
    return out;
  } catch {
    return "";
  }
}

// ============================================================
// I5/I3 — HOOK STATE (dedupe + loop auto-capture)
// ============================================================

interface HookState {
  injected: Record<string, number>; // filePath → last injected timestamp
  edits: Record<string, { count: number; windowStart: number; gotchaRecorded: boolean }>;
}

function loadHookState(root: string): HookState {
  try {
    const fp = path.join(root, HOOK_STATE_FILE);
    if (fs.existsSync(fp)) {
      return JSON.parse(fs.readFileSync(fp, "utf-8")) as HookState;
    }
  } catch { /* fresh state */ }
  return { injected: {}, edits: {} };
}

function saveHookState(root: string, state: HookState): void {
  try {
    const fp = path.join(root, HOOK_STATE_FILE);
    const dir = path.dirname(fp);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(state), "utf-8");
  } catch { /* non-critical */ }
}

/**
 * I5: returns true when the file should be injected now (not injected
 * within the dedupe window). Updates the state as a side effect.
 */
export function checkInjectDedupe(filePath: string): boolean {
  const root = getProjectRoot();
  const state = loadHookState(root);
  const now = Date.now();
  const last = state.injected[filePath] || 0;
  if (now - last < INJECT_DEDUPE_MS) return false;
  state.injected[filePath] = now;
  saveHookState(root, state);
  return true;
}

/**
 * I3: count edits to a file within a rolling window. Returns the count.
 * When the threshold is crossed, auto-records a low-severity gotcha once
 * (per file, per window) so repeated fights with a file become knowledge.
 */
export async function trackFileEditLoop(filePath: string): Promise<number> {
  const root = getProjectRoot();
  const state = loadHookState(root);
  const now = Date.now();
  const entry = state.edits[filePath] || { count: 0, windowStart: now, gotchaRecorded: false };

  if (now - entry.windowStart > LOOP_WINDOW_MS) {
    entry.count = 0;
    entry.windowStart = now;
    entry.gotchaRecorded = false;
  }
  entry.count++;

  let recorded = false;
  if (entry.count >= LOOP_THRESHOLD && !entry.gotchaRecorded) {
    entry.gotchaRecorded = true;
    recorded = true;
  }
  state.edits[filePath] = entry;
  saveHookState(root, state);

  if (recorded) {
    // Guard: never bootstrap a fresh DB from inside a hook (read-only philosophy).
    // Only auto-record when .kuma/kuma.db already exists.
    try {
      if (!fs.existsSync(path.join(root, ".kuma", "kuma.db"))) return entry.count;
      const { addGotcha } = await import("./kumaGotchas.js");
      await addGotcha({
        filePath,
        description: `Edited ${entry.count} times within ${Math.round(LOOP_WINDOW_MS / 60000)} min — fragile area, rework likely`,
        severity: "low",
        workaround: "Trace why this file keeps needing changes before the next edit (kuma_context history).",
      });
    } catch { /* non-critical */ }
  }
  return entry.count;
}
