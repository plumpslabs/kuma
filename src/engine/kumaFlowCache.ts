// ============================================================
// KUMA FLOW CACHE — F13 (Roadmap): arch_flow as derived cache
// ============================================================
// Graph flows are NEVER the source of truth — code is. A stored
// arch_flow is just a cache: every serve re-checks freshness via
// file content hashes. When stale, the flow is re-derived on demand
// by following imports (grep-based), then the cache is refreshed.
//
// Query path:
//   getFreshDomainFlow(domain)
//   → hash check on the flow's files (F3-style)
//   → fresh? serve cache      |  stale? re-derive via imports → update cache
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "../utils/pathValidator.js";
import { hashFile } from "./kumaDriftDetector.js";
import { matchImportPath, SOURCE_EXTENSIONS } from "./languageSupport.js";

export interface FlowFreshness {
  domain: string;
  fresh: boolean;
  filePaths: string[];
  staleFiles: string[];
}

/**
 * F13: checks whether a stored domain flow is still fresh by hashing
 * every file the flow touches. Returns null when no flow exists.
 */
export async function getFlowFreshness(domain: string): Promise<FlowFreshness | null> {
  try {
    const { getDb } = await import("./kumaDb.js");
    const db = await getDb();
    const stmt = db.prepare(
      `SELECT metadata FROM nodes WHERE type = 'feature_domain' AND name = ? LIMIT 1`
    );
    stmt.bind([domain]);
    const found = stmt.step();
    const row = found ? (stmt.getAsObject() as { metadata: string }) : null;
    stmt.free();
    if (!row) return null;

    const meta = JSON.parse(row.metadata || "{}");
    const filePaths: string[] = Array.isArray(meta.filePaths) ? meta.filePaths : [];
    if (filePaths.length === 0) {
      return { domain, fresh: true, filePaths, staleFiles: [] };
    }

    const storedHashes = meta.fileHashes as Record<string, string> | undefined;
    const staleFiles: string[] = [];
    for (const fp of filePaths) {
      const current = hashFile(fp);
      if (current === null) {
        staleFiles.push(fp); // file gone → stale
      } else if (storedHashes && storedHashes[fp] && storedHashes[fp] !== current) {
        staleFiles.push(fp); // content changed → stale
      }
    }
    return { domain, fresh: staleFiles.length === 0, filePaths, staleFiles };
  } catch {
    return null;
  }
}

/**
 * F13: resolve an import specifier to an existing source file on disk.
 * Tries relative resolution with every supported source extension.
 */
function resolveImport(fromFile: string, spec: string): string | null {
  const root = getProjectRoot();
  const fromDir = path.dirname(fromFile);
  const candidates: string[] = [];
  if (spec.startsWith(".")) {
    const abs = path.resolve(fromDir, spec);
    candidates.push(abs);
  } else {
    candidates.push(path.join(root, spec));
  }
  for (const c of candidates) {
    for (const ext of SOURCE_EXTENSIONS) {
      const withExt = `${c}${ext}`;
      if (fs.existsSync(withExt)) return path.relative(root, withExt);
      if (fs.existsSync(c) && fs.statSync(c).isDirectory()) {
        const idx = path.join(c, "index") + ext;
        if (fs.existsSync(idx)) return path.relative(root, idx);
      }
    }
    if (fs.existsSync(c)) {
      try {
        if (fs.statSync(c).isFile()) return path.relative(root, c);
      } catch { /* skip */ }
    }
  }
  return null;
}

/**
 * F13: re-derive a domain flow by scanning the entry file's imports.
 * Builds a shallow hop chain (entry → direct imports, max 6 hops).
 * Returns hops suitable for recordDomainFlow.
 */
export function deriveHopsFromImports(entryFile: string, maxHops = 6): Array<{
  from: string;
  to: string;
  relation: string;
  description?: string;
}> {
  const root = getProjectRoot();
  const absEntry = path.isAbsolute(entryFile)
    ? entryFile
    : path.resolve(root, entryFile);
  if (!fs.existsSync(absEntry)) return [];

  const hops: Array<{ from: string; to: string; relation: string; description?: string }> = [];
  const seen = new Set<string>([entryFile]);
  const fromName = path.basename(absEntry);

  try {
    const lines = fs.readFileSync(absEntry, "utf-8").split("\n");
    for (const line of lines) {
      if (hops.length >= maxHops) break;
      const spec = matchImportPath(line);
      if (!spec || spec.startsWith("@types/")) continue;
      const resolved = resolveImport(absEntry, spec);
      if (!resolved || seen.has(resolved)) continue;
      seen.add(resolved);
      hops.push({
        from: fromName,
        to: path.basename(resolved),
        relation: "imports",
        description: `${fromName} imports ${path.basename(resolved)}`,
      });
    }
  } catch { /* non-critical */ }

  return hops;
}

/**
 * F13: serve a fresh domain flow.
 *  - fresh cache → serve as-is (with freshness flag)
 *  - stale cache → re-derive via imports, refresh the stored flow, serve new
 * Returns a human-readable description of the flow.
 */
export async function getFreshDomainFlow(domain: string): Promise<string> {
  const freshness = await getFlowFreshness(domain);
  if (!freshness) {
    return `ℹ️ No arch_flow recorded for domain "${domain}".\nRecord one with kuma_memory({ action: 'arch_flow', content: 'domain: ${domain} | hops: a.ts → b.ts → c.ts' }).`;
  }

  const lines: string[] = [
    `🏛️ **Flow: ${domain}**`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    "",
  ];

  if (freshness.fresh) {
    lines.push(`✅ Cache FRESH — served as-is (${freshness.filePaths.length} file(s) tracked).`);
  } else {
    // Re-derive from the first tracked file (grep engine = source of truth)
    lines.push(`🔁 Cache STALE (${freshness.staleFiles.length} file(s) changed) — re-deriving from imports...`);
    try {
      const entry = freshness.filePaths[0];
      const hops = deriveHopsFromImports(entry);
      if (hops.length > 0) {
        const { recordDomainFlow } = await import("./kumaGraph.js");
        await recordDomainFlow({
          domain,
          hops,
          filePaths: freshness.filePaths,
        });
        lines.push(`✅ Re-derived ${hops.length} hop(s) from ${path.basename(entry)} — cache refreshed.`);
      } else {
        lines.push("⚠️ No imports to follow — cache left as-is (record hops manually if needed).");
      }
    } catch (err) {
      lines.push(`⚠️ Re-derivation failed: ${err}`);
    }
  }

  lines.push("");
  for (const fp of freshness.filePaths) {
    lines.push(`  📄 ${fp}${freshness.staleFiles.includes(fp) ? " ⚠️ changed" : ""}`);
  }

  return lines.join("\n");
}
