import { sessionMemory } from "../engine/sessionMemory.js";
import { getResearchCache, saveResearchCache } from "../engine/kumaDb.js";
import { searchGraph, analyzeImpact } from "../engine/kumaGraph.js";
import { scoreMemoryRelevance, getProactiveMemories } from "../engine/kumaMemory.js";
import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "../utils/pathValidator.js";
import crypto from "node:crypto";

type ContextAction = "init" | "research" | "history" | "flow" | "map" | "impact";

const CONTEXT_ALIASES: Record<string, ContextAction> = {
  "research": "research", "search": "research", "explore": "research", "inspect": "research",
  "flow": "flow", "domain-flow": "flow", "domain_flow": "flow", "flow-cache": "flow",
  "init": "init", "start": "init", "load": "init", "brief": "init", "project": "init",
  "history": "history", "why": "history", "touched": "history", "provenance": "history",
  "map": "map", "repo-map": "map", "repo_map": "map", "workspace": "map", "topology": "map",
  "impact": "impact", "blast-radius": "impact", "blast_radius": "impact", "blast": "impact",
};

interface ContextParams {
  action?: ContextAction | string;
  scope?: string;
  target?: string;
  goal?: string;
}

export async function handleContext(params: ContextParams): Promise<string> {
  const rawAction = params.action || "init";
  const resolvedAction = CONTEXT_ALIASES[rawAction.toLowerCase()] || rawAction;
  const action = resolvedAction as ContextAction;

  switch (action) {
    case "init": return handleInit(params);
    case "research": return handleResearch(params);
    case "history": return handleHistory(params);
    case "flow": return handleFlow(params);
    case "map": return handleMap(params);
    case "impact": return handleImpact(params);
    default: return `Unknown action "${action}". Use: init, research, history, flow, map, impact`;
  }
}

// ============================================================
// INIT — Lean Project Brief
// ============================================================

async function handleInit(_params: ContextParams): Promise<string> {
  sessionMemory.setGoal(_params.goal || "Exploring project");
  sessionMemory.recordToolCall("kuma_context_init", {});

  const branch = sessionMemory.getCurrentBranch();
  const branchTag = branch ? ` [git: \`${branch}\`]` : "";
  const lines: string[] = [
    "🧠 **Kuma — Project Brief (lean)**",
    `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    "",
    `📁 Project: ${getProjectRoot().split("/").pop() || "unknown"}${branchTag}`,
    "",
  ];

  const branchTransition = sessionMemory.getBranchTransition();
  if (branchTransition?.switched) {
    lines.push(`🔀 **Branch switched**: from \`${branchTransition.from}\` to \`${branchTransition.to}\`. Session context updated.`);
    lines.push("");
  }

  try {
    const { getWorkspaceInfo } = await import("../engine/workspaceIntelligence.js");
    const wsInfo = await getWorkspaceInfo();
    if (wsInfo.isWorkspace) {
      lines.push(`📦 **Workspace**: ${wsInfo.packages.length} package(s) detected (${wsInfo.type.toUpperCase()})`);
      lines.push(`   ${wsInfo.packages.slice(0, 5).map(p => `\`${p.name}\``).join(", ")}${wsInfo.packages.length > 5 ? ` +${wsInfo.packages.length - 5} more` : ""}`);
      lines.push("");
    }
  } catch {}

  const goal = _params.goal || (sessionMemory.getSummary().currentGoal as string) || "";

  try {
    const { maybeRunAutoCleanup } = await import("../engine/kumaMaintenance.js");
    const note = await maybeRunAutoCleanup();
    if (note) lines.push(note, "");
  } catch {}

  const focus = detectSessionFocus(goal);
  lines.push("🎯 **Session focus: " + focus + "**");
  lines.push("  " + sessionFocusAdvice(focus));
  lines.push("");

  const summary = sessionMemory.getSummary();
  lines.push("**Session State**");
  lines.push(`  🎯 Goal: ${(summary.currentGoal as string) || "not set"}`);
  lines.push(`  📝 Modified: ${(summary.modifiedFiles as unknown[])?.length || 0} file(s) · 🛠️ ${summary.toolCallCount} calls`);
  lines.push("");

  const memories = getProactiveMemories();
  if (memories) { lines.push("**Relevant Memories**"); lines.push(memories); lines.push(""); }

  try {
    const { getFreshGotchasForFile } = await import("../engine/kumaInject.js");
    const { getDb } = await import("../engine/kumaDb.js");
    const modified = (summary.modifiedFiles as Array<{ filePath: string }> | undefined) || [];
    const seen = new Set<string>();
    const collectedGotchas: Array<{ filePath: string; description: string; severity: string }> = [];

    // 1. Fresh gotchas for recently touched files
    for (const f of modified.slice(0, 4)) {
      if (!f.filePath || seen.has(f.filePath)) continue;
      seen.add(f.filePath);
      const gotchas = await getFreshGotchasForFile(f.filePath, 3);
      for (const g of gotchas) {
        const key = `${g.filePath}::${g.description.substring(0, 30)}`;
        if (!seen.has(key)) {
          seen.add(key);
          collectedGotchas.push({
            filePath: g.filePath,
            description: g.description,
            severity: g.severity,
          });
        }
      }
    }

    // 2. Supplement with top critical/high active gotchas across project
    let totalActiveCount = 0;
    try {
      const db = await getDb();
      const countStmt = db.prepare(`SELECT COUNT(*) as cnt FROM known_gotchas WHERE status IN ('active', 'verified')`);
      if (countStmt.step()) totalActiveCount = (countStmt.getAsObject() as { cnt: number }).cnt || 0;
      countStmt.free();

      if (collectedGotchas.length < 5) {
        const stmt = db.prepare(`
          SELECT file_path, description, severity
          FROM known_gotchas
          WHERE status IN ('active', 'verified')
          ORDER BY
            CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
            updated_at DESC
          LIMIT 10
        `);
        while (stmt.step()) {
          const row = stmt.getAsObject() as { file_path: string; description: string; severity: string };
          const key = `${row.file_path}::${row.description.substring(0, 30)}`;
          if (!seen.has(key)) {
            seen.add(key);
            collectedGotchas.push({
              filePath: row.file_path,
              description: row.description,
              severity: row.severity,
            });
          }
          if (collectedGotchas.length >= 5) break;
        }
        stmt.free();
      }
    } catch {}

    // Sort by severity: critical > high > medium > low
    const severityRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    collectedGotchas.sort((a, b) => (severityRank[a.severity] ?? 2) - (severityRank[b.severity] ?? 2));

    const budgetedGotchas = collectedGotchas.slice(0, 5);
    if (budgetedGotchas.length > 0) {
      lines.push("**Active Gotchas (fresh & budgeted)**");
      for (const g of budgetedGotchas) {
        const icon = g.severity === "critical" ? "🔴" : g.severity === "high" ? "🟠" : g.severity === "medium" ? "🟡" : "🟢";
        const desc = g.description.length <= 180
          ? g.description
          : g.description.substring(0, 177).replace(/\s+\S*$/, "") + "...";
        lines.push(`  ${icon} [${g.severity}] ${g.filePath} — ${desc}`);
      }
      if (totalActiveCount > budgetedGotchas.length) {
        lines.push(`  ℹ️ +${totalActiveCount - budgetedGotchas.length} more active gotchas in DB (query: kuma_memory({ action: 'gotcha' }))`);
      }
      lines.push("");
    }
  } catch {}

  try {
    const { getInjectionStats } = await import("../engine/kumaGotchas.js");
    const stats = getInjectionStats(24);
    if (stats.count > 0) lines.push(`🪄 Shadow memory: ${stats.count} injection(s) · ~${Math.round(stats.savedMs / 60000)} min saved (24h)`);
    lines.push("");
  } catch {}

  try {
    const { formatPathRules } = await import("../engine/kumaPathRules.js");
    const rulesBlock = formatPathRules(goal);
    if (rulesBlock) { lines.push(rulesBlock); lines.push(""); }
  } catch {}

  lines.push("💡 Deeper: kuma_context({ action: 'history', target: '<file>' }) · Flow: kuma_context({ action: 'flow', target: '<domain>' }) · Map: kuma_context({ action: 'map' }) · Impact: kuma_context({ action: 'impact', target: '<file>' })");
  return lines.join("\n");
}

function detectSessionFocus(goal: string): "bugfix" | "research" | "feature" | "general" {
  const g = goal.toLowerCase();
  if (/(bug|fix|error|issue|fail|broken|crash|regression|rollback)/.test(g)) return "bugfix";
  if (/(research|investigate|explore|understand|analyze|audit|learn)/.test(g)) return "research";
  if (/(feature|add|implement|build|create|new|support|integrat)/.test(g)) return "feature";
  return "general";
}

function sessionFocusAdvice(focus: string): string {
  switch (focus) {
    case "bugfix": return "Record gotchas immediately on the fix; one decision if the approach changed. Skip arch_flow.";
    case "research": return "research_save findings; record only critical gotchas. Skip arch_flow/feature.";
    case "feature": return "Record arch_flow after tracing + a feature node; gotchas only if you hit a quirk.";
    default: return "Record gotchas & decisions as they happen — skip what isn't worth it.";
  }
}

// ============================================================
// RESEARCH — 5-Step Pipeline
// ============================================================

async function handleResearch(params: ContextParams): Promise<string> {
  const scope = params.scope || "project";
  sessionMemory.setGoal(`Researching: ${scope}`);
  sessionMemory.recordToolCall("kuma_context_research", { scope });
  const lines: string[] = [`🔬 **Research: ${scope}**`, `━━━━━━━━━━━━━━━━━━━━━━━━━━━`, ""];

  lines.push("**Step 1/5: Loading Research Cache**");
  const cached = await getResearchCache(scope);
  let record: Record<string, unknown> | null = null;
  if (cached) { try { record = JSON.parse(cached); } catch {} }
  if (record) {
    const ageSeconds = Math.floor((Date.now() - (record.validatedAt ? new Date(record.validatedAt as string).getTime() : 0)) / 1000);
    const ageStr = ageSeconds > 86400 ? `${Math.floor(ageSeconds / 86400)}d` : ageSeconds > 3600 ? `${Math.floor(ageSeconds / 3600)}h` : `${Math.floor(ageSeconds / 60)}m`;
    lines.push(`  ✅ Found cached research (${ageStr} old)`);
    if (ageSeconds > 86400) lines.push(`  ${ageSeconds > 604800 ? "🔴" : "🟡"} **Staleness:** Cache is ${ageStr} old — may be stale`);
  } else lines.push("  ⏳ No cached research — starting fresh");
  lines.push("");

  lines.push("**Step 2/5: Staleness Check**");
  if (record?.contentHash) {
    try {
      const currentHash = computeProjectHash(scope);
      if (currentHash === record.contentHash) lines.push("  ✅ Content still fresh — no changes detected");
      else { lines.push("  ⚠️ Content changed since cache — will update"); record = null; }
    } catch { lines.push("  ⚠️ Could not verify staleness — will re-research"); record = null; }
  } else lines.push("  ⏳ No content hash available — will research fresh");
  lines.push("");

  lines.push("**Step 3/5: Graph Query + Code Scan**");
  try {
    const graphResult = await searchGraph(scope, 15);
    const graphLines = graphResult.split("\n");
    if (graphLines.length > 1 && !graphResult.includes("No results")) {
      lines.push(`  📊 ${graphLines.filter(l => l.includes("•")).length} relevant node(s) found`);
      for (const l of graphLines.slice(0, 8)) { if (l.includes("•")) lines.push(`  ${l}`); }
    } else {
      lines.push("  ⏳ No graph data — searching codebase...");
      try {
        const fg = (await import("fast-glob")).default;
        const root = getProjectRoot();
        const ignorePatterns = ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**", "**/.kuma/**"];
        const files = await fg([`**/*${scope}*`], { cwd: root, ignore: ignorePatterns, onlyFiles: true, deep: 6 });
        if (files.length > 0) {
          lines.push(`  📁 Found ${files.length} file(s) in codebase matching "${scope}":`);
          for (const f of files.slice(0, 8)) lines.push(`    📄 ${f}`);
          if (files.length > 8) lines.push(`    ... and ${files.length - 8} more`);
        } else lines.push("  ⏳ No codebase matches — build graph by using more tools");
      } catch { lines.push("  ⏳ No graph data yet — build by using more tools"); }
    }
  } catch { lines.push("  ⚠️ Graph query failed"); }
  try {
    const { scanCodebase } = await import("../engine/kumaCodeScanner.js");
    const scanResult = await scanCodebase({ scope, maxFiles: 100 });
    if (scanResult.nodeCount > 0 || scanResult.edgeCount > 0) lines.push(`  🔬 Auto-scanned ${scanResult.filesScanned} files → ${scanResult.nodeCount} nodes, ${scanResult.edgeCount} edges`);
  } catch {}
  lines.push("");

  lines.push("**Step 4/5: Impact Analysis (Blast Radius)**");
  try {
    const impact = await analyzeImpact(scope);
    lines.push(`  📊 ${impact.references} reference(s) across ${impact.files} file(s)`);
    if (impact.packageName) lines.push(`  📦 Package: \`${impact.packageName}\``);
    if (impact.downstreamPackages && impact.downstreamPackages.length > 0) {
      lines.push(`  🌐 Downstream consumers (${impact.downstreamPackages.length}): ${impact.downstreamPackages.slice(0, 4).join(", ")}`);
    }
    lines.push(`  🧪 ${impact.testFiles} test file(s) related`);
    lines.push(`  ⚠️ Risk: ${impact.risk.toUpperCase()}`);
    if (impact.riskFlags && impact.riskFlags.length > 0) {
      for (const rf of impact.riskFlags) lines.push(`     • ${rf}`);
    }
    if (impact.entryPoints && impact.entryPoints.length > 0) lines.push(`  🎯 Entry: ${impact.entryPoints.slice(0, 3).join(", ")}`);
  } catch { lines.push("  ⚠️ Impact analysis unavailable"); }
  lines.push("");

  lines.push("**Step 5/5: Decision & Context Lookup**");
  try {
    const memories = scoreMemoryRelevance(scope, 3);
    if (memories.length > 0) { lines.push("  📝 Relevant decisions/memories:"); for (const m of memories) lines.push(`    • ${m.topic} (${m.score}% match)`); }
    else lines.push("  ✅ No previous decisions found for this scope");
  } catch { lines.push("  ⚠️ Memory lookup failed"); }
  lines.push("");

  try {
    const { formatPathRules } = await import("../engine/kumaPathRules.js");
    const rulesBlock = formatPathRules(scope);
    if (rulesBlock) { lines.push(rulesBlock); lines.push(""); }
  } catch {}

  const newRecord = { scope, confidence: (record?.confidence as number) || 0.7, entryPoints: [], flow: [], dependencies: [], tests: [], riskAreas: [], decisions: [], contentHash: computeProjectHash(scope), validatedAt: new Date().toISOString() };
  await saveResearchCache(scope, JSON.stringify(newRecord), newRecord.contentHash, newRecord.confidence);
  lines.push("📝 Research saved to cache. Call kuma_memory({ action: 'research_save' }) to save custom notes.");
  return lines.join("\n");
}

// ============================================================
// HISTORY — Why is this file written this way
// ============================================================

async function handleHistory(params: ContextParams): Promise<string> {
  const target = params.target || params.scope;
  sessionMemory.recordToolCall("kuma_context_history", { target });
  if (!target) return "ℹ️ **kuma_context({ action: 'history' })** — requires a `target` (file path).\n\n  kuma_context({ action: 'history', target: 'src/services/auth.ts' })\n\nAnswers: *why is this file written this way?* — who changed it, when, why, active gotchas (fresh), and relevant decisions.";
  const lines: string[] = [`🕰️ **File History: ${target}**`, `━━━━━━━━━━━━━━━━━━━━━━━━━━━`, ""];
  try {
    const { getFileTrace, formatFileTrace, getFreshGotchasForFile, getDecisionsForFile } = await import("../engine/kumaInject.js");
    const trace = await getFileTrace(target, 8);
    lines.push(formatFileTrace(trace, target) || "  (no changes recorded for this file yet)");
    lines.push("");
    const gotchas = await getFreshGotchasForFile(target, 5);
    if (gotchas.length > 0) {
      lines.push("⚠️ **Active gotchas** (fresh):");
      for (const g of gotchas) {
        const icon = g.severity === "critical" ? "🔴" : g.severity === "high" ? "🟠" : g.severity === "medium" ? "🟡" : "🟢";
        lines.push(`  ${icon} [${g.severity}] ${g.description}`);
        if ((g as { triggerCommand?: string }).triggerCommand) lines.push(`     ⌨️ when running: \`${(g as { triggerCommand?: string }).triggerCommand}\``);
        if (g.workaround) {
          const work = g.workaround.length <= 180
            ? g.workaround
            : g.workaround.substring(0, 177).replace(/\s+\S*$/, "") + "...";
          lines.push(`     💡 ${work}`);
        }
      }
      lines.push("");
    }
    try {
      const { getDb } = await import("../engine/kumaDb.js");
      const db = await getDb();
      const stmt = db.prepare(`SELECT description, last_verified_at FROM known_gotchas WHERE status = 'resolved' AND file_path LIKE ? ORDER BY last_verified_at DESC LIMIT 3`);
      stmt.bind([`%${path.basename(target)}%`]);
      const resolved: Array<{ description: string; last_verified_at: number | null }> = [];
      while (stmt.step()) resolved.push(stmt.getAsObject() as any);
      stmt.free();
      if (resolved.length > 0) {
        lines.push("✅ **Resolved gotchas** (fixed):");
        for (const r of resolved) {
          const rdesc = r.description.length <= 140
            ? r.description
            : r.description.substring(0, 137).replace(/\s+\S*$/, "") + "...";
          lines.push(`  ✅ ${rdesc}`);
        }
        lines.push("");
      }
    } catch {}
    const decisions = await getDecisionsForFile(target, 3);
    if (decisions.length > 0) { lines.push("📌 **Relevant decisions**"); for (const d of decisions) lines.push(`  ${d}`); lines.push(""); }
  } catch {}
  lines.push("💡 This content is injected automatically before edits via the Claude Code PreToolUse hook (`kuma hook pre-edit`).");
  return lines.join("\n");
}

// ============================================================
// FLOW — Read a recorded domain flow
// ============================================================

async function handleFlow(params: ContextParams): Promise<string> {
  const domain = params.target || params.scope;
  sessionMemory.recordToolCall("kuma_context_flow", { domain });
  if (!domain) return "ℹ️ **kuma_context({ action: 'flow' })** — requires a `target` (domain name).\n\n  kuma_context({ action: 'flow', target: 'WhatsApp Omnichannel' })\n\nServes the domain flow from cache, re-deriving it from imports when stale (F13).";
  const { getFreshDomainFlow } = await import("../engine/kumaFlowCache.js");
  return await getFreshDomainFlow(domain);
}

// ============================================================
// MAP — Workspace / Repository topology map
// ============================================================

async function handleMap(_params: ContextParams): Promise<string> {
  sessionMemory.recordToolCall("kuma_context_map", {});
  const { getWorkspaceInfo, formatWorkspaceMap } = await import("../engine/workspaceIntelligence.js");
  const wsInfo = await getWorkspaceInfo();
  return formatWorkspaceMap(wsInfo);
}

// ============================================================
// IMPACT — Blast radius & downstream impact analysis
// ============================================================

async function handleImpact(params: ContextParams): Promise<string> {
  const target = params.target || params.scope || "project";
  sessionMemory.recordToolCall("kuma_context_impact", { target });
  const { analyzeImpact, formatImpact } = await import("../engine/kumaGraph.js");
  const impact = await analyzeImpact(target);
  return formatImpact(impact);
}

function computeProjectHash(scope: string): string {
  try {
    const root = getProjectRoot();
    const files = fs.readdirSync(root).slice(0, 20);
    const hash = crypto.createHash("md5");
    hash.update(scope);
    for (const f of files) {
      try { const stat = fs.statSync(path.join(root, f)); hash.update(`${f}:${stat.mtimeMs}`); } catch {}
    }
    return hash.digest("hex").substring(0, 12);
  } catch { return Date.now().toString(16); }
}
