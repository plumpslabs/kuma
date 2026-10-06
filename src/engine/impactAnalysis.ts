// ============================================================
// KUMA IMPACT ANALYSIS — Blast Radius & Downstream Dependency Tracing
// ============================================================
// Calculates the full blast radius of a change:
//   - Directly affected file/symbol
//   - Package owner & downstream consumer packages
//   - Importing files (direct dependents)
//   - Associated unit and integration tests
//   - Risk assessment (low / medium / high / critical) with risk flags
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import fastGlob from "fast-glob";
import { getProjectRoot, normalizeScope } from "../utils/pathValidator.js";
import { getDb } from "./kumaDb.js";
import {
  getWorkspaceInfo,
  findPackageForFile,
  getReverseDependencies,
  type WorkspacePackage,
} from "./workspaceIntelligence.js";

export type ImpactRisk = "low" | "medium" | "high" | "critical";

/** Issue #33/#35 — diff shape: what kind of change is this? */
export type DiffShape = "runtime-code" | "config-or-docs" | "comment-only";

const RUNTIME_CODE_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".java", ".rb", ".php",
  ".swift", ".kt", ".cs", ".scala", ".vue", ".svelte",
]);

const COMMENT_PREFIXES: Record<string, string[]> = {
  ".ts": ["//", "*", "/*"], ".tsx": ["//", "*", "/*"],
  ".js": ["//", "*", "/*"], ".jsx": ["//", "*", "/*"],
  ".mjs": ["//", "*", "/*"], ".cjs": ["//", "*", "/*"],
  ".py": ["#"], ".go": ["//"], ".rs": ["//"],
  ".java": ["//", "*", "/*"], ".rb": ["#"], ".php": ["//", "#", "*"],
};

function extOf(target: string): string {
  const base = path.basename(target);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot).toLowerCase() : "";
}

function isExampleOrDocName(target: string): boolean {
  const base = path.basename(target).toLowerCase();
  return (
    base.endsWith(".example") || base.startsWith(".env") ||
    base.endsWith(".md") || base.endsWith(".txt") ||
    base.endsWith(".rst") || base === "license" ||
    base.startsWith("license.")
  );
}

/**
 * Issue #33 — classify the diff shape of a target.
 * - `comment-only`: git diff exists and every changed line is a comment/blank
 * - `config-or-docs`: non-runtime file (docs, .env*, *.example, etc.)
 * - `runtime-code`: everything else (full analysis applies)
 */
export function classifyDiffShape(target: string, root?: string): { shape: DiffShape; detail: string } {
  if (isExampleOrDocName(target)) {
    return { shape: "config-or-docs", detail: "non-runtime file (docs/config/example)" };
  }
  const ext = extOf(target);
  if (ext && !RUNTIME_CODE_EXTS.has(ext)) {
    return { shape: "config-or-docs", detail: `non-runtime extension (${ext})` };
  }
  // Runtime-code file (or extensionless/unknown): check whether the actual
  // working-tree diff is comment-only.
  try {
    const cwd = root || getProjectRoot();
    const diff = execSync(`git diff --unified=0 -- "${target}"`, {
      cwd, encoding: "utf-8", timeout: 4000, stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (!diff) return { shape: "runtime-code", detail: "no working-tree diff; analyzed by file kind" };
    const prefixes = COMMENT_PREFIXES[ext] || ["//", "#", "*", "/*", "--"];
    const changed = diff.split("\n").filter((l) => (l.startsWith("+") || l.startsWith("-")) && !l.startsWith("+++") && !l.startsWith("---"));
    if (changed.length === 0) return { shape: "runtime-code", detail: "no working-tree diff; analyzed by file kind" };
    const allTrivial = changed.every((l) => {
      const body = l.slice(1).trim();
      return body === "" || prefixes.some((p) => body.startsWith(p));
    });
    if (allTrivial) return { shape: "comment-only", detail: `${changed.length} changed line(s), all comments/blank` };
  } catch { /* git unavailable → fall through to runtime-code */ }
  return { shape: "runtime-code", detail: "runtime code change" };
}

export interface DetailedImpactResult {
  target: string;
  targetType: "file" | "package" | "symbol" | "session";
  owningPackage: WorkspacePackage | null;
  directDependents: string[];
  downstreamPackages: string[];
  affectedTests: string[];
  risk: ImpactRisk;
  riskFlags: string[];
  summary: string;
  confidence: number;
  /** Issue #33/#35: diff shape + file:line evidence behind the verdict. */
  diffShape?: DiffShape;
  evidence?: string[];
}

/**
 * Find files in the repository that import or call a given file/symbol.
 * Graph-First: queries SQLite edges in <1ms, falls back to disk scan if graph is empty.
 * Returns grounded dependents + file:line evidence (issue #35: every verdict
 * carries evidence; ungrounded keyword mentions are NEVER returned here).
 */
async function findImportingFiles(
  targetFile: string,
  root: string,
): Promise<{ dependents: string[]; evidence: string[] }> {
  const normTarget = normalizeScope(path.normalize(targetFile)) || path.normalize(targetFile);

  // 1. Try Knowledge Graph edges first (blazing fast)
  try {
    const db = await getDb();
    const targetFileId = `file::${normTarget}`;

    const dependents: string[] = [];

    // Direct importing files (imports & depends_on edges)
    const importStmt = db.prepare(`
      SELECT DISTINCT n.file_path, n.name
      FROM edges e
      JOIN nodes n ON n.id = e.source_id
      WHERE (e.target_id = ? OR e.target_id LIKE ?)
        AND e.type IN ('imports', 'depends_on')
    `);
    importStmt.bind([targetFileId, `%::${normTarget}%`]);
    while (importStmt.step()) {
      const row = importStmt.getAsObject() as { file_path: string; name: string };
      const f = row.file_path || row.name;
      if (f && f !== normTarget && !dependents.includes(f)) dependents.push(f);
    }
    importStmt.free();

    // Callers of symbols defined in this file
    const callStmt = db.prepare(`
      SELECT DISTINCT n_src.file_path, n_src.name
      FROM nodes n_tgt
      JOIN edges e ON e.target_id = n_tgt.id
      JOIN nodes n_src ON n_src.id = e.source_id
      WHERE (n_tgt.file_path = ? OR n_tgt.name = ? OR n_tgt.id LIKE ?)
        AND e.type = 'calls'
    `);
    callStmt.bind([normTarget, normTarget, `%::${normTarget}::%`]);
    while (callStmt.step()) {
      const row = callStmt.getAsObject() as { file_path: string; name: string };
      const f = row.file_path || row.name;
      if (f && f !== normTarget && !dependents.includes(f)) dependents.push(f);
    }
    callStmt.free();

    if (dependents.length > 0) {
      return { dependents, evidence: dependents.map((d) => `${d} (graph edge)`) };
    }
  } catch {
    // Fall back to disk scan
  }

  // 2. Fallback: disk scan via glob & regex (with file:line evidence)
  const baseName = path.basename(normTarget, path.extname(normTarget));
  const relTarget = path.isAbsolute(normTarget) ? path.relative(root, normTarget) : normTarget;

  try {
    const files = await fastGlob(
      ["**/*.{ts,tsx,js,jsx,mjs,cjs,py,go,rs}"],
      {
        cwd: root,
        ignore: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.git/**", "**/.kuma/**"],
        onlyFiles: true,
      }
    );

    const dependents: string[] = [];
    const evidence: string[] = [];
    // Alias-tolerant: `import gmath "pkg/x"`, `import {a} from 'x'`, `from x import y`.
    const importRegex = new RegExp(
      `(?:import|from|require\\s*\\()[\\w{}*,.\\s]*['"][^'"]*\\b${baseName}(?:\\.[a-zA-Z0-9]+)?['"]`,
      "i"
    );

    for (const f of files) {
      if (path.normalize(f) === path.normalize(relTarget)) continue;
      const fullPath = path.join(root, f);
      try {
        const content = fs.readFileSync(fullPath, "utf-8");
        const lines = content.split("\n");
        const hitIdx = lines.findIndex((l) => importRegex.test(l));
        if (hitIdx >= 0) {
          dependents.push(f);
          evidence.push(`${f}:${hitIdx + 1} (import match)`);
        }
      } catch {}
    }

    return { dependents, evidence };
  } catch {
    return { dependents: [], evidence: [] };
  }
}

/**
 * Find related test files for a target file or package.
 * Graph-First: queries 'tests' edges in SQLite first, falls back to naming patterns.
 * Issue #33: stems are FULL basenames only (no 3-char part splitting — that is
 * what exploded "env.example" into 148 unrelated suites). For non-runtime
 * shapes only the exact basename matches.
 */
async function findRelatedTests(
  targetFile: string,
  root: string,
  owningPackage: WorkspacePackage | null,
  additionalDependents: string[] = [],
  exactOnly = false,
): Promise<string[]> {
  const normTarget = normalizeScope(path.normalize(targetFile)) || path.normalize(targetFile);

  // 1. Try Knowledge Graph 'tests' edges first
  try {
    const db = await getDb();
    const targetFileId = `file::${normTarget}`;
    const testStmt = db.prepare(`
      SELECT DISTINCT n.file_path, n.name
      FROM edges e
      JOIN nodes n ON n.id = e.source_id
      WHERE (e.target_id = ? OR e.target_id LIKE ?)
        AND e.type = 'tests'
    `);
    testStmt.bind([targetFileId, `%::${normTarget}%`]);
    const graphTests: string[] = [];
    while (testStmt.step()) {
      const row = testStmt.getAsObject() as { file_path: string; name: string };
      const t = row.file_path || row.name;
      if (t && !graphTests.includes(t)) graphTests.push(t);
    }
    testStmt.free();

    if (graphTests.length > 0) {
      return graphTests;
    }
  } catch {
    // Fall back to pattern search
  }

  // 2. Pattern search fallback
  const baseName = path.basename(normTarget, path.extname(normTarget));
  const testFiles: string[] = [];

  // Candidate stems: FULL basenames only (issue #33 — no sub-part splitting).
  const stems = new Set<string>();
  if (baseName) stems.add(baseName);
  if (!exactOnly) {
    for (const dep of additionalDependents.slice(0, 3)) {
      const depBase = path.basename(dep, path.extname(dep));
      if (depBase) stems.add(depBase);
    }
  }

  const testPatterns: string[] = [];
  for (const stem of stems) {
    testPatterns.push(
      `**/*${stem}*.test.*`,
      `**/*${stem}*.spec.*`,
      `**/*${stem}*_test.*`,
      `**/tests/**/*${stem}*.*`,
      `**/test/**/*${stem}*.*`,
      `**/__tests__/**/*${stem}*.*`
    );
  }

  try {
    const matches = await fastGlob(testPatterns, {
      cwd: root,
      ignore: ["**/node_modules/**", "**/dist/**", "**/.git/**", "**/.kuma/**"],
      onlyFiles: true,
    });
    testFiles.push(...matches);
  } catch {}

  // If owning package has its own test directory, check tests in that package
  if (owningPackage && owningPackage.path !== ".") {
    try {
      const pkgPatterns: string[] = [];
      for (const stem of stems) {
        pkgPatterns.push(
          `**/*${stem}*.{test,spec}.*`,
          `**/tests/**/*${stem}*.*`,
          `**/test/**/*${stem}*.*`,
          `**/__tests__/**/*${stem}*.*`
        );
      }
      const pkgTests = await fastGlob(pkgPatterns, {
        cwd: path.join(root, owningPackage.path),
        ignore: ["**/node_modules/**", "**/dist/**"],
        onlyFiles: true,
      });
      for (const pt of pkgTests) {
        const fullRel = path.join(owningPackage.path, pt);
        if (!testFiles.includes(fullRel)) {
          testFiles.push(fullRel);
        }
      }
    } catch {}
  }

  return Array.from(new Set(testFiles));
}

/**
 * Determine risk level and risk flags
 */
function assessRisk(
  target: string,
  targetType: string,
  directDependents: string[],
  downstreamPackages: string[],
  affectedTests: string[],
  owningPackage: WorkspacePackage | null
): { risk: ImpactRisk; riskFlags: string[] } {
  const riskFlags: string[] = [];

  // 1. Critical path indicators
  const isSecurityOrCritical = /(database|schema|migration|auth|security|safety|guard|policy|payment|secret|billing)/i.test(target);
  const isUserDestructive = /(user|account|member|customer|profile).*(delet|destro|remov|wipe|terminat)|(delet|destro|remov|wipe|terminat).*(user|account|member|customer|profile)/i.test(target);
  const hasAuthMiddleware = directDependents.some((d) => /auth.*middleware|auth|security|jwt/i.test(d));

  if (isSecurityOrCritical) {
    riskFlags.push("Security/Critical domain file");
  }
  if (isUserDestructive) {
    riskFlags.push("Destructive user data/identity operation");
  }
  if (hasAuthMiddleware) {
    riskFlags.push("Protected by critical security middleware (auth-middleware in pipeline)");
  }

  // 2. Public entrypoint
  if (owningPackage?.entryPoints.some((e) => target.endsWith(e) || e.includes(target))) {
    riskFlags.push("Public package entrypoint/export");
  }

  // 3. Cross-package impact
  if (downstreamPackages.length > 0) {
    riskFlags.push(`Cross-package impact: ${downstreamPackages.length} consumer package(s) affected`);
  }

  // 4. Dependents count
  if (directDependents.length > 8) {
    riskFlags.push(`High fan-in: ${directDependents.length} files depend directly on this`);
  }

  // 5. Test coverage check
  if (affectedTests.length === 0) {
    riskFlags.push("No direct test suite found for this target");
  }

  // 6. Target scope
  if (targetType === "package") {
    riskFlags.push("Package-level modification scope");
  }

  let risk: ImpactRisk = "low";
  if (
    isSecurityOrCritical ||
    isUserDestructive ||
    hasAuthMiddleware ||
    riskFlags.includes("Security/Critical domain file") ||
    riskFlags.includes("Destructive user data/identity operation") ||
    riskFlags.includes("Protected by critical security middleware (auth-middleware in pipeline)") ||
    (downstreamPackages.length > 2 && riskFlags.includes("Public package entrypoint/export"))
  ) {
    risk = "critical";
  } else if (
    targetType === "package" ||
    downstreamPackages.length > 0 ||
    directDependents.length > 5 ||
    riskFlags.includes("Public package entrypoint/export")
  ) {
    risk = "high";
  } else if (directDependents.length > 0 || riskFlags.includes("No direct test suite found for this target")) {
    risk = "medium";
  }

  return { risk, riskFlags };
}

/**
 * Issue #35 (EPIC, phase 1) — indexer capability table.
 * Tier 1 (grounded): knowledge-graph edges (imports/depends_on/calls/tests).
 * Tier 2 (grounded): ripgrep import-regex fallback with file:line evidence.
 * Tier 3 (future): per-language LSP/AST indexers (tsserver/gopls/rust-analyzer/
 * pyright/tree-sitter/ctags). Status is reported honestly so consumers know
 * which tier produced a verdict.
 */
export interface IndexerStatus {
  tier: 1 | 2;
  graphEdges: boolean;
  languages: string[];
  note: string;
  /** Issue #42: true when the map is backbone-only (imports, no symbols). */
  backboneOnly: boolean;
}

export async function getIndexerStatus(): Promise<IndexerStatus> {
  let graphEdges = false;
  let backboneOnly = false;
  try {
    const db = await getDb();
    const stmt = db.prepare(`SELECT COUNT(*) as cnt FROM edges WHERE type IN ('imports','depends_on','calls','tests')`);
    if (stmt.step()) graphEdges = Number((stmt.getAsObject() as { cnt: number }).cnt) > 0;
    stmt.free();
    // Backbone-only: file nodes exist but zero symbol nodes.
    const fStmt = db.prepare(`SELECT COUNT(*) as cnt FROM nodes WHERE type = 'file'`);
    let files = 0;
    if (fStmt.step()) files = Number((fStmt.getAsObject() as { cnt: number }).cnt) || 0;
    fStmt.free();
    const sStmt = db.prepare(`SELECT COUNT(*) as cnt FROM nodes WHERE type IN ('function','class','method','interface')`);
    let syms = 0;
    if (sStmt.step()) syms = Number((sStmt.getAsObject() as { cnt: number }).cnt) || 0;
    sStmt.free();
    backboneOnly = files > 0 && syms === 0;
  } catch { /* graph unavailable → tier 2 */ }
  return {
    tier: graphEdges ? 1 : 2,
    graphEdges,
    backboneOnly,
    languages: ["ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "go", "rs"],
    note: backboneOnly
      ? "Backbone-tier coverage: import graph only (approximate) — symbols fill in on demand when impact/research touches an area"
      : graphEdges
        ? "Tier 1: graph edges grounded the verdict (Tier 2 ripgrep fallback available)"
        : "Tier 2: ripgrep import-regex fallback (no graph edges; run a scan to reach Tier 1; LSP indexers are future work per #35)",
  };
}

/**
 * Calculate the comprehensive Blast Radius of changing a file, package, or symbol
 */export async function calculateBlastRadius(
  target: string,
  options: { root?: string } = {}
): Promise<DetailedImpactResult> {
  const root = options.root || getProjectRoot();
  const wsInfo = await getWorkspaceInfo(root);

  // 1. Determine target type
  let targetType: DetailedImpactResult["targetType"] = "file";
  const isPkg = wsInfo.packages.some((p) => p.name === target);
  if (isPkg) {
    targetType = "package";
  } else if (target.includes("/") || target.includes(".")) {
    targetType = "file";
  } else {
    targetType = "symbol";
  }

  // 2. Identify owning package
  let owningPackage: WorkspacePackage | null = null;
  if (targetType === "package") {
    owningPackage = wsInfo.packageMap.get(target) || null;
  } else {
    owningPackage = findPackageForFile(target, wsInfo);
  }

  // 3. Determine downstream packages
  const downstreamPackages: string[] = [];
  if (owningPackage && !owningPackage.isRoot) {
    const rev = getReverseDependencies(owningPackage.name, wsInfo);
    downstreamPackages.push(...rev.map((p) => p.name));
  }

  // 3b. Issue #42 precision on demand: file target with no symbol
  // coverage → force-scan exactly that area once, then proceed.
  if (targetType === "file") {
    try {
      const { ensureMapped } = await import("./mapBackbone.js");
      await ensureMapped([target]);
    } catch {}
  }

  // 4. Find direct dependents (files importing this) — GROUNDED ONLY.
  // Issue #33: the old keyword/auth-middleware fallback injected ungrounded
  // mentions that poisoned risk (comment-only .env.example → CRITICAL).
  let directDependents: string[] = [];
  let evidence: string[] = [];
  if (targetType === "file" || targetType === "symbol") {
    const found = await findImportingFiles(target, root);
    directDependents = found.dependents;
    evidence = found.evidence;
  }

  const { shape: diffShape, detail: shapeDetail } = classifyDiffShape(target, root);
  const nonRuntime = diffShape !== "runtime-code";

  // 5. Find affected tests (exact-basename only for non-runtime shapes)
  const affectedTests = await findRelatedTests(target, root, owningPackage, directDependents, nonRuntime);

  // 5b. Predictive ranking (issue: Meta PTS lite) — history beats static order.
  let testReasons = new Map<string, string>();
  // Issue #35 phase 2: symbol targets get reachability-grounded tests too.
  if (targetType === "symbol") {
    try {
      const { symbolReachability } = await import("./symbolReach.js");
      const reach = await symbolReachability(target, 10, root);
      for (const r of reach.rows) {
        if (!affectedTests.includes(r.test)) {
          affectedTests.push(r.test);
          testReasons.set(r.test, `reachability tier ${reach.tier}: ${r.evidence.substring(0, 80)}`);
        }
        evidence.push(r.evidence);
      }
    } catch {}
  }
  try {
    const { rankTestsByHistory } = await import("./testHistory.js");
    const ranked = await rankTestsByHistory(target, affectedTests);
    affectedTests.length = 0;
    for (const r of ranked) {
      affectedTests.push(r.path);
      if (r.reason !== "static match") testReasons.set(r.path, r.reason);
    }
  } catch {}
  // 6. Risk assessment — non-runtime shapes are capped at LOW (issue #33).
  // Ungrounded keyword mentions are NOT consulted at all (deleted fallback).
  let risk: ImpactRisk;
  let riskFlags: string[];
  if (nonRuntime) {
    risk = "low";
    riskFlags = [
      `${diffShape === "comment-only" ? "Comment-only change" : "Non-runtime file"} (${shapeDetail}) — risk capped at LOW`,
      ...((directDependents.length > 0 || affectedTests.length > 0)
        ? [`Grounded refs kept for reference: ${directDependents.length} importer(s), ${affectedTests.length} test(s)`]
        : []),
    ];
    // Cap the blast display too: a docs/config change cannot "affect" suites
    // it does not import or test.
    directDependents = [];
    affectedTests.length = 0;
  } else {
    ({ risk, riskFlags } = assessRisk(
      target,
      targetType,
      directDependents,
      downstreamPackages,
      affectedTests,
      owningPackage,
    ));
  }

  // 7. Format markdown summary
  const summaryLines: string[] = [
    `🎯 **Impact / Blast Radius: \`${target}\`**`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `⚠️ **Risk Level: ${risk.toUpperCase()}**`,
    `📐 Diff shape: \`${diffShape}\` (${shapeDetail})`,
    owningPackage ? `📦 Owning package: \`${owningPackage.name}\` (${owningPackage.path})` : "",
  ];

  if (riskFlags.length > 0) {
    summaryLines.push("");
    summaryLines.push(`🚨 **Risk Flags:**`);
    for (const flag of riskFlags) {
      summaryLines.push(`  • ${flag}`);
    }
  }

  if (downstreamPackages.length > 0) {
    summaryLines.push("");
    summaryLines.push(`🌐 **Downstream Consumer Packages (${downstreamPackages.length}):**`);
    for (const dp of downstreamPackages) {
      summaryLines.push(`  • \`${dp}\``);
    }
  }

  if (directDependents.length > 0) {
    summaryLines.push("");
    summaryLines.push(`📄 **Direct Dependents (${directDependents.length} file(s)):**`);
    for (const dep of directDependents.slice(0, 6)) {
      summaryLines.push(`  • \`${dep}\``);
    }
    if (directDependents.length > 6) {
      summaryLines.push(`  ... and ${directDependents.length - 6} more`);
    }
  }

  if (evidence.length > 0) {
    summaryLines.push("");
    summaryLines.push(`🔎 **Evidence (${evidence.length}):**`);
    for (const e of evidence.slice(0, 3)) {
      summaryLines.push(`  • \`${e}\``);
    }
    if (evidence.length > 3) {
      summaryLines.push(`  ... and ${evidence.length - 3} more`);
    }
  }

  if (affectedTests.length > 0) {
    summaryLines.push("");
    summaryLines.push(`🧪 **Affected Test Suites (${affectedTests.length}):**`);
    for (const t of affectedTests.slice(0, 5)) {
      const why = testReasons.get(t) ? ` — ${testReasons.get(t)}` : "";
      summaryLines.push(`  • \`${t}\`${why}`);
    }
    if (affectedTests.length > 5) {
      summaryLines.push(`  ... and ${affectedTests.length - 5} more`);
    }
  } else {
    summaryLines.push("");
    summaryLines.push(`⚠️ **No test suites detected for this scope.** Consider adding tests before editing.`);
  }

  return {
    target,
    targetType,
    owningPackage,
    directDependents,
    downstreamPackages,
    affectedTests,
    risk,
    riskFlags,
    summary: summaryLines.filter(Boolean).join("\n"),
    confidence: nonRuntime ? 0.95 : 0.85,
    diffShape,
    evidence,
  };
}
