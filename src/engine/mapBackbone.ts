// ============================================================
// MAP BACKBONE — Issue #42 tier 1 (seconds, always)
// ============================================================
// File list + import graph via fast regex scan. No AST, no symbols,
// no per-file parsing beyond line matching: O(files), capped.
// Runs on first init AND on daemon start when the map is empty —
// edges exist from second zero. Covers ~80% of "where is this used".
// Precision (symbols) fills in on demand via ensureMapped().
// ============================================================

import fs from "node:fs";
import path from "node:path";
import fastGlob from "fast-glob";
import { execSync } from "node:child_process";
import { getProjectRoot } from "../utils/pathValidator.js";
import { upsertNode, addEdge } from "./kumaGraph.js";
import { resolveImportPath } from "./kumaCodeScanner.js";
import { DEFAULT_SOURCE_INCLUDES } from "./languageSupport.js";

export const BACKBONE_MAX_FILES = 2000;
const MAP_META = ".kuma/map-meta.json";

export interface BackboneResult {
  files: number;
  capped: boolean;
  nodes: number;
  edges: number;
  ms: number;
  filesPerSec: number;
}

// Static import forms across TS/JS/Py/Go/Rs (no AST needed).
// Alias-tolerant: `import gmath "./x"`, `import {a} from 'x'`.
const IMPORT_RES = [
  /(?:import)\s+(?:[\w*{},\s]+\s+from\s+|[\w$]+\s+)?['"]([^'"]+)['"]/g,
  /(?:from)\s+["']?([a-zA-Z0-9_./-]+)["']?\s+import\s+/g,
  /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

/** Extract relative import sources from one line (exported for tests). */
export function extractImportSources(line: string): string[] {
  const out: string[] = [];
  const t = line.trim();
  if (t.startsWith("//") || t.startsWith("#") || t.startsWith("*")) return out;
  for (const re of IMPORT_RES) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      if (m[1] && m[1].startsWith(".")) out.push(m[1]);
    }
  }
  return out;
}

function mapMetaPath(root?: string): string {
  return path.join(root || getProjectRoot(), MAP_META);
}

export function readMapMeta(root?: string): Record<string, unknown> {
  try {
    const fp = mapMetaPath(root);
    if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, "utf-8"));
  } catch {}
  return {};
}

function writeMapMeta(patch: Record<string, unknown>, root?: string): void {
  try {
    const fp = mapMetaPath(root);
    const prev = readMapMeta(root);
    fs.writeFileSync(fp, JSON.stringify({ ...prev, ...patch }, null, 2), "utf-8");
  } catch {}
}

/** True when the map has no file nodes (cold start). */
export async function isMapEmpty(): Promise<boolean> {
  try {
    const { getDb } = await import("./kumaDb.js");
    const db = await getDb();
    const stmt = db.prepare(`SELECT COUNT(*) as cnt FROM nodes WHERE type = 'file'`);
    let n = 0;
    if (stmt.step()) n = Number((stmt.getAsObject() as { cnt: number }).cnt) || 0;
    stmt.free();
    return n === 0;
  } catch {
    return true;
  }
}

/**
 * Build the backbone: file nodes + import edges only.
 * Bounded (BACKBONE_MAX_FILES), timed, meta-persisted.
 */
export async function buildBackbone(maxFiles = BACKBONE_MAX_FILES): Promise<BackboneResult> {
  const started = Date.now();
  const root = getProjectRoot();
  const result: BackboneResult = { files: 0, capped: false, nodes: 0, edges: 0, ms: 0, filesPerSec: 0 };

  let files: string[] = [];
  try {
    files = await fastGlob([...DEFAULT_SOURCE_INCLUDES], {
      cwd: root,
      ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**", "**/.next/**", "**/coverage/**", "**/*.d.ts", "**/.kuma/**"],
      onlyFiles: true,
      deep: 7,
      dot: false,
    });
  } catch {
    return result;
  }

  const capped = files.length > maxFiles;
  const batch = files.slice(0, maxFiles);
  result.files = batch.length;
  result.capped = capped;

  // Idempotency snapshot: existing import edges, loaded ONCE so a re-run
  // is a no-op instead of inflating weights via addEdge's ON CONFLICT bump.
  // Same for file nodes: upsertNode REPLACES metadata, so the backbone only
  // inserts missing file nodes and never touches precision-tier metadata.
  const existingEdges = new Set<string>();
  const existingFiles = new Set<string>();
  try {
    const { getDb } = await import("./kumaDb.js");
    const db = await getDb();
    const stmt = db.prepare(`SELECT source_id, target_id FROM edges WHERE type = 'imports'`);
    while (stmt.step()) {
      const r = stmt.getAsObject() as { source_id: string; target_id: string };
      existingEdges.add(`${r.source_id}→${r.target_id}`);
    }
    stmt.free();
    const fStmt = db.prepare(`SELECT id FROM nodes WHERE type = 'file'`);
    while (fStmt.step()) existingFiles.add((fStmt.getAsObject() as { id: string }).id);
    fStmt.free();
  } catch {}

  for (const filePath of batch) {
    try {
      const full = path.join(root, filePath);
      const stat = fs.statSync(full);
      if (!stat.isFile() || stat.size > 512 * 1024) continue;
      const fileId = `file::${filePath}`;
      if (!existingFiles.has(fileId)) {
        try {
          await upsertNode({ id: fileId, type: "file", name: filePath, filePath, metadata: { backbone: true } });
          existingFiles.add(fileId);
          result.nodes++;
        } catch { continue; }
      }
      const content = fs.readFileSync(full, "utf-8");
      const seen = new Set<string>();
      for (const line of content.split("\n")) {
        for (const src of extractImportSources(line)) {
          if (seen.has(src)) continue;
          seen.add(src);
          try {
            const resolved = resolveImportPath(filePath, src, root);
            const key = resolved ? `${fileId}→file::${resolved}` : "";
            if (resolved && !existingEdges.has(key)) {
              await addEdge({ sourceId: fileId, targetId: `file::${resolved}`, type: "imports" });
              existingEdges.add(key);
              result.edges++;
            }
          } catch {}
        }
      }
    } catch {}
  }

  result.ms = Date.now() - started;
  result.filesPerSec = result.ms > 0 ? Math.round((result.files / result.ms) * 1000) : result.files;
  writeMapMeta({
    backboneAt: Date.now(),
    backboneFiles: result.files,
    backboneCapped: result.capped,
    backboneMs: result.ms,
    filesPerSec: result.filesPerSec,
  });
  return result;
}

/** Build the backbone only when the map is empty. Returns null when skipped. */
export async function ensureBackbone(): Promise<BackboneResult | null> {
  try {
    if (!(await isMapEmpty())) return null;
    return await buildBackbone();
  } catch {
    return null;
  }
}

export function formatBackbone(r: BackboneResult): string {
  return `🗺️ Backbone: ${r.files} file(s)${r.capped ? ` (capped at ${BACKBONE_MAX_FILES})` : ""}, ${r.edges} import edge(s) in ${r.ms}ms (~${r.filesPerSec} files/s) — approximate tier, symbols fill in on demand.`;
}

// ============================================================
// WORKTREE SYNC — Issue #43 (commit-blind daemon)
// ============================================================
// mtime-cache syncs mirror committed state; hours of uncommitted work
// stay invisible. These helpers read the worktree diff explicitly
// (modified + untracked, ignored files excluded by git itself) so the
// daemon force-scans exactly what's dirty, and queries surface the flag.

export interface WorktreeFile {
  file: string;
  state: "modified" | "untracked";
}

const WORKTREE_CAP = 50;
const WORKTREE_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".java", ".rb", ".php",
  ".swift", ".kt", ".cs", ".vue", ".svelte",
  ".json", ".yml", ".yaml", ".toml", ".md",
]);

/** Worktree-changed files (modified + untracked), bounded. [] on any error. */
export function getWorktreeChangedFiles(root?: string, cap = WORKTREE_CAP): WorktreeFile[] {
  const out: WorktreeFile[] = [];
  try {
    const cwd = root || getProjectRoot();
    const porcelain = execSync("git status --porcelain --untracked-files=all", {
      cwd, encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"],
    });
    if (!porcelain.trim()) return out;
    // NOTE: never trim() whole lines — the XY status codes are positional
    // (leading space is significant: " M file" vs "M  file").
    for (const rawLine of porcelain.split("\n")) {
      if (out.length >= cap) break;
      const line = rawLine.replace(/\s+$/, "");
      if (!line) continue;
      // Rename format: "R  old -> new" — take the new path.
      const m = line.match(/^(.{2})\s+(.+)$/);
      if (!m) continue;
      const code = m[1];
      let p = m[2].trim();
      const arrow = p.indexOf(" -> ");
      if (arrow >= 0) p = p.slice(arrow + 4).trim();
      p = p.replace(/^"|"$/g, "");
      if (!p) continue;
      const ext = p.slice(p.lastIndexOf(".")).toLowerCase();
      if (!WORKTREE_EXTS.has(ext)) continue;
      const untracked = code[0] === "?" || code[1] === "?";
      out.push({ file: p, state: untracked ? "untracked" : "modified" });
    }
  } catch { /* not a git repo or timeout → no worktree signal */ }
  return out;
}

/** Persist the worktree-dirty set into map-meta (survives restarts). */
export function updateWorktreeDirty(files: string[], root?: string): void {
  writeMapMeta({ worktreeDirty: [...new Set(files)].slice(0, WORKTREE_CAP), worktreeDirtyAt: Date.now() }, root);
}

/** Files dirty at the last sync (for query surfacing). */
export function readWorktreeDirty(root?: string): string[] {
  const meta = readMapMeta(root);
  return Array.isArray(meta.worktreeDirty) ? (meta.worktreeDirty as string[]).filter((f) => typeof f === "string") : [];
}

/** True when the target carries uncommitted worktree changes. */
export function isWorktreeDirty(target: string, root?: string): boolean {
  const norm = target.replace(/\\/g, "/");
  return readWorktreeDirty(root).some((f) => {
    const nf = f.replace(/\\/g, "/");
    return nf === norm || nf.endsWith(`/${norm}`) || norm.endsWith(`/${nf}`);
  });
}

/**
 * Precision on demand (issue #42 tier 2): when impact/research touches
 * files with no symbol coverage, force-scan exactly those files once.
 * Bounded: max 10 files per call.
 */
export async function ensureMapped(files: string[]): Promise<{ filled: number }> {
  const targets = [...new Set(files.map((f) => f.trim()).filter(Boolean))].slice(0, 10);
  if (targets.length === 0) return { filled: 0 };
  let missing: string[] = [];
  try {
    const { getDb } = await import("./kumaDb.js");
    const db = await getDb();
    for (const f of targets) {
      const stmt = db.prepare(
        `SELECT COUNT(*) as cnt FROM nodes WHERE type IN ('function','class','method','interface') AND file_path LIKE ?`
      );
      stmt.bind([`%${path.basename(f)}%`]);
      let n = 0;
      if (stmt.step()) n = Number((stmt.getAsObject() as { cnt: number }).cnt) || 0;
      stmt.free();
      if (n === 0) missing.push(f);
    }
  } catch {
    missing = targets;
  }
  if (missing.length === 0) return { filled: 0 };
  try {
    const { scanCodebase } = await import("./kumaCodeScanner.js");
    const res = await scanCodebase({ include: missing, force: true, maxFiles: missing.length });
    if (res.filesScanned > 0) writeMapMeta({ precisionAt: Date.now() });
    return { filled: Math.min(missing.length, res.filesScanned) };
  } catch {
    return { filled: 0 };
  }
}
