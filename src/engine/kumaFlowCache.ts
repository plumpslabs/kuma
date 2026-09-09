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
      `SELECT metadata FROM nodes WHERE type IN ('feature_domain', 'arch_flow') AND name = ? LIMIT 1`
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

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function getHopsForDomain(
  domain: string
): Promise<Array<{ from: string; to: string; relation?: string; description?: string }>> {
  const hops: Array<{ from: string; to: string; relation?: string; description?: string }> = [];
  try {
    const { getDb } = await import("./kumaDb.js");
    const db = await getDb();

    // 1. Check feature_domain or arch_flow metadata.hops
    const stmt = db.prepare(`SELECT metadata FROM nodes WHERE type IN ('feature_domain', 'arch_flow') AND name = ? LIMIT 1`);
    stmt.bind([domain]);
    if (stmt.step()) {
      const meta = JSON.parse((stmt.getAsObject().metadata as string) || "{}");
      if (Array.isArray(meta.hops) && meta.hops.length > 0 && typeof meta.hops[0] === "object") {
        stmt.free();
        return meta.hops;
      }
    }
    stmt.free();

    // 2. Check cross_service_link nodes ordered by hopIndex
    const nodeStmt = db.prepare(`
      SELECT name, metadata FROM nodes
      WHERE type = 'cross_service_link' AND (metadata LIKE ? OR id LIKE ?)
      LIMIT 25
    `);
    nodeStmt.bind([`%"domain":"${domain}"%`, `%${domain}::%`]);
    const rawNodes: Array<{ name: string; hopIndex: number; relation?: string; description?: string }> = [];
    while (nodeStmt.step()) {
      const row = nodeStmt.getAsObject() as { name: string; metadata: string };
      try {
        const meta = JSON.parse(row.metadata || "{}");
        rawNodes.push({
          name: row.name,
          hopIndex: typeof meta.hopIndex === "number" ? meta.hopIndex : 999,
          relation: meta.relation,
          description: meta.description,
        });
      } catch {}
    }
    nodeStmt.free();

    if (rawNodes.length >= 2) {
      rawNodes.sort((a, b) => a.hopIndex - b.hopIndex);
      const uniqueSteps: string[] = [];
      for (const n of rawNodes) {
        if (uniqueSteps.length === 0 || uniqueSteps[uniqueSteps.length - 1] !== n.name) {
          uniqueSteps.push(n.name);
        }
      }
      for (let i = 0; i < uniqueSteps.length - 1; i++) {
        hops.push({ from: uniqueSteps[i], to: uniqueSteps[i + 1] });
      }
      if (hops.length > 0) return hops;
    }
  } catch {}

  // 3. Fallback: Parse ARCHITECTURE_FLOW.md
  try {
    const root = getProjectRoot();
    const archPath = path.join(root, ".kuma", "ARCHITECTURE_FLOW.md");
    if (fs.existsSync(archPath)) {
      const content = fs.readFileSync(archPath, "utf-8");
      const lines = content.split("\n");
      for (const line of lines) {
        const domMatch = line.match(new RegExp(`domain:\\s*${escapeRegex(domain)}\\s*\\|\\s*hops:\\s*(.+)`, "i"));
        if (domMatch) {
          const hopsPart = domMatch[1].trim();
          const arrowSteps = hopsPart.split(/→|->/).map((s) => s.trim()).filter(Boolean);
          for (let i = 0; i < arrowSteps.length - 1; i++) {
            hops.push({ from: arrowSteps[i], to: arrowSteps[i + 1] });
          }
          if (hops.length > 0) return hops;
        }
      }
    }
  } catch {}

  return hops;
}

/**
 * F13: serve a fresh domain flow.
 *  - fresh cache → serve as-is (with freshness flag)
 *  - stale cache → re-derive via imports, refresh the stored flow, serve new
 * Returns a human-readable description of the flow with sequence hops.
 */
export async function getFreshDomainFlow(domain: string): Promise<string> {
  const freshness = await getFlowFreshness(domain);
  const hops = await getHopsForDomain(domain);

  if (!freshness && hops.length === 0) {
    return `ℹ️ No arch_flow recorded for domain "${domain}".\nRecord one with kuma_memory({ action: 'arch_flow', content: 'domain: ${domain} | hops: a.ts → b.ts → c.ts' }).`;
  }

  const lines: string[] = [
    `🏛️ **Flow: ${domain}**`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    "",
  ];

  if (freshness) {
    if (freshness.fresh) {
      lines.push(`✅ Cache FRESH — served as-is (${freshness.filePaths.length} file(s) tracked).`);
    } else {
      // Re-derive from the first tracked file (grep engine = source of truth)
      lines.push(`🔁 Cache STALE (${freshness.staleFiles.length} file(s) changed) — re-deriving from imports...`);
      try {
        const entry = freshness.filePaths[0];
        const derivedHops = deriveHopsFromImports(entry);
        if (derivedHops.length > 0) {
          const { recordDomainFlow } = await import("./kumaGraph.js");
          await recordDomainFlow({
            domain,
            hops: derivedHops,
            filePaths: freshness.filePaths,
          });
          lines.push(`✅ Re-derived ${derivedHops.length} hop(s) from ${path.basename(entry)} — cache refreshed.`);
          hops.splice(0, hops.length, ...derivedHops);
        } else {
          lines.push("⚠️ No imports to follow — cache left as-is (record hops manually if needed).");
        }
      } catch (err) {
        lines.push(`⚠️ Re-derivation failed: ${err}`);
      }
    }
  } else {
    lines.push(`ℹ️ Serving flow from markdown definition.`);
  }

  lines.push("");

  // Print Hops Sequence
  if (hops.length > 0) {
    lines.push("🔄 **Flow Sequence (Hops):**");
    for (let i = 0; i < hops.length; i++) {
      const h = hops[i];
      const detail = h.relation && h.relation !== "flows" ? ` (${h.relation})` : "";
      if (i === 0) {
        lines.push(`  1. ${h.from} →`);
      }
      const isLast = i === hops.length - 1;
      lines.push(`  ${i + 2}. ${h.to}${detail}${isLast ? "" : " →"}`);
    }
    lines.push("");
  }

  if (freshness && freshness.filePaths.length > 0) {
    lines.push("📁 **Tracked Files:**");
    for (const fp of freshness.filePaths) {
      lines.push(`  📄 ${fp}${freshness.staleFiles.includes(fp) ? " ⚠️ changed" : ""}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}
