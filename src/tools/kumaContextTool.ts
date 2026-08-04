import { sessionMemory } from "../engine/sessionMemory.js";
import { getDb, getResearchCache, saveResearchCache, getChanges, rollbackChange } from "../engine/kumaDb.js";
import { searchGraph, analyzeImpact, formatImpact, traceFlow, formatFlow } from "../engine/kumaGraph.js";
import { scoreMemoryRelevance, getProactiveMemories } from "../engine/kumaMemory.js";
import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "../utils/pathValidator.js";
import crypto from "node:crypto";

type ContextAction = "init" | "research" | "impact" | "navigate" | "flow" | "changes" | "history" | "rollback" | "digest" | "drift" | "resume";

const CONTEXT_ALIASES: Record<string, ContextAction> = {
  "research": "research", "search": "research", "explore": "research", "inspect": "research",
  "impact": "impact", "analyze": "impact", "whatif": "impact", "refactor": "impact",
  "navigate": "navigate", "trace": "navigate", "flow-trace": "navigate",
  "flow": "flow", "domain-flow": "flow", "domain_flow": "flow", "flow-cache": "flow",
  "init": "init", "start": "init", "load": "init", "brief": "init", "project": "init",
  "resume": "resume", "continue": "resume", "restore": "resume", "reload": "resume",
  "changes": "changes", "log": "changes", "changelog": "changes",
  "history": "history", "why": "history", "touched": "history", "provenance": "history",
  "rollback": "rollback", "undo": "rollback", "revert": "rollback",
  "digest": "digest", "bootstrap": "digest", "briefing": "digest", "overview": "digest",
  "drift": "drift", "staleness": "drift", "code-drift": "drift", "freshness": "drift",
};

interface ContextParams {
  action?: ContextAction | string;
  scope?: string;
  target?: string;
  goal?: string;
  since?: number;
}

export async function handleContext(params: ContextParams): Promise<string> {
  const rawAction = params.action || "init";
  const resolvedAction = CONTEXT_ALIASES[rawAction.toLowerCase()] || rawAction;
  const action = resolvedAction as ContextAction;

  switch (action) {
    case "init": return handleInit(params);
    case "research": return handleResearch(params);
    case "impact": return handleImpact(params);
    case "navigate": return handleNavigate(params);
    case "flow": return handleFlow(params);
    case "history": return handleHistory(params);
    case "changes": return handleChanges(params);
    case "rollback": return handleRollback(params);
    case "digest": return handleDigest(params);
    case "drift": return handleDrift(params);
    case "resume": return handleResume(params);
    default: return `Unknown action "${action}". Use: init, research, impact, navigate, flow, history, changes, rollback, digest, drift, resume`;
  }
}

// ============================================================
// RESUME — Load Previous Session Context
// ============================================================

async function handleResume(_params: ContextParams): Promise<string> {
  sessionMemory.recordToolCall("kuma_context_resume", {});
  const lines: string[] = [
    "🔄 **Kuma — Session Resume**",
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    "",
  ];
  try {
    const db = await getDb();
    const res = db.exec("SELECT goal, tool_calls, edits, rollbacks, failures, safety_score, started_at FROM sessions ORDER BY started_at DESC LIMIT 1");
    if (res[0]?.values.length) {
      const row = res[0].values[0];
      const goal = (row[0] as string) || "no goal";
      const calls = (row[1] as number) || 0;
      const edits = (row[2] as number) || 0;
      const rollbacks = (row[3] as number) || 0;
      const failures = (row[4] as number) || 0;
      const safety = row[5] == null ? null : (row[5] as number);
      const time = new Date((row[6] as number) * 1000).toLocaleString();
      lines.push("**Last Session**");
      lines.push(`  🎯 Goal: ${goal.substring(0, 80)}`);
      lines.push(`  🕐 ${time}`);
      lines.push(`  🔧 ${calls} calls · 📝 ${edits} edits · ↩ ${rollbacks} rollbacks · ❌ ${failures} failures${safety != null ? ` · 🛡 safety ${safety}` : ""}`);
      lines.push("");
    }
  } catch {}

  const summary = sessionMemory.getSummary();
  lines.push("**Current State**");
  lines.push(`  🎯 Goal: ${(summary.currentGoal as string) || "not set"}`);
  const progress = sessionMemory.getGoalProgress();
  if (progress) lines.push(`  📊 Progress: ${progress.percentage}%${progress.milestone ? ` — ${progress.milestone}` : ""}`);
  lines.push(`  📝 Modified: ${(summary.modifiedFiles as unknown[])?.length || 0} file(s)`);
  lines.push(`  ✅ Completed steps: ${(summary.completedSteps as string[])?.length || 0}`);
  lines.push(`  🛠️ Tool calls: ${summary.toolCallCount}`);
  lines.push(`  ⏱️ Session duration: ${summary.sessionDuration}`);
  const failures = summary.unresolvedFailures as Array<{ task: string; error: string }> | undefined;
  if (failures?.length) lines.push(`  ⚠️ Unresolved failures: ${failures.length}`);
  lines.push("");

  try {
    const changes = await getChanges({ limit: 5 });
    if (changes && !changes.startsWith("No changes")) { lines.push("**Recent Changes**"); lines.push(changes); lines.push(""); }
  } catch {}

  const history = sessionMemory.getToolCallHistory(5);
  if (history.length) {
    lines.push("**Recent Tool Calls**");
    for (const h of history) {
      const action = (h.params as Record<string, unknown>)?.action || "";
      lines.push(`  🛠 ${h.toolName}${action ? ` (${action})` : ""}`);
    }
    lines.push("");
  }
  lines.push("💡 Continue: kuma_context({ action: 'research', scope: '<area>' }) to pick up where you left off.");
  return lines.join("\n");
}

// ============================================================
// INIT — Lean Project Brief
// ============================================================

async function handleInit(_params: ContextParams): Promise<string> {
  sessionMemory.setGoal(_params.goal || "Exploring project");
  sessionMemory.recordToolCall("kuma_context_init", {});

  const lines: string[] = [
    "🧠 **Kuma — Project Brief (lean)**",
    `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    "",
    `📁 Project: ${getProjectRoot().split("/").pop() || "unknown"}`,
    "",
  ];

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
    const modified = (summary.modifiedFiles as Array<{ filePath: string }> | undefined) || [];
    const seen = new Set<string>();
    let gotchasPushed = 0;
    for (const f of modified.slice(0, 4)) {
      if (!f.filePath || seen.has(f.filePath)) continue;
      seen.add(f.filePath);
      const gotchas = await getFreshGotchasForFile(f.filePath, 3);
      for (const g of gotchas) {
        if (gotchasPushed === 0) lines.push("**Active Gotchas (fresh)**");
        gotchasPushed++;
        const icon = g.severity === "critical" ? "🔴" : g.severity === "high" ? "🟠" : g.severity === "medium" ? "🟡" : "🟢";
        lines.push(`  ${icon} ${g.filePath} — ${g.description.substring(0, 90)}`);
      }
    }
    if (gotchasPushed > 0) lines.push("");
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

  lines.push("💡 Full view: kuma_context({ action: 'digest' }) · Research: kuma_context({ action: 'research', scope: '<area>' })");
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

  lines.push("**Step 4/5: Impact Analysis**");
  try {
    const impact = await analyzeImpact(scope);
    lines.push(`  📊 ${impact.references} reference(s) across ${impact.files} file(s)`);
    lines.push(`  🧪 ${impact.testFiles} test file(s) related`);
    lines.push(`  ⚠️ Risk: ${impact.risk.toUpperCase()}`);
    if (impact.entryPoints.length > 0) lines.push(`  🎯 Entry: ${impact.entryPoints.slice(0, 3).join(", ")}`);
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
// IMPACT, NAVIGATE, CHANGES, FLOW, HISTORY, ROLLBACK, DIGEST, DRIFT
// ============================================================

async function handleImpact(params: ContextParams): Promise<string> {
  const target = params.target || params.scope;
  if (!target) return "⚠️ target or scope parameter required.";
  sessionMemory.recordToolCall("kuma_context_impact", { target });
  const impact = await analyzeImpact(target);
  return formatImpact(impact);
}

async function handleNavigate(params: ContextParams): Promise<string> {
  const entryPoint = params.target || params.scope;
  if (!entryPoint) return "⚠️ target or scope parameter required.";
  sessionMemory.recordToolCall("kuma_context_navigate", { entryPoint });
  const steps = await traceFlow(entryPoint);
  return formatFlow(entryPoint, steps);
}

async function handleChanges(params: ContextParams): Promise<string> {
  const filePath = params.target;
  const since = params.since;
  return await getChanges({ filePath, since });
}

async function handleFlow(params: ContextParams): Promise<string> {
  const domain = params.target || params.scope;
  sessionMemory.recordToolCall("kuma_context_flow", { domain });
  if (!domain) return "ℹ️ **kuma_context({ action: 'flow' })** — requires a `target` (domain name).\n\n  kuma_context({ action: 'flow', target: 'WhatsApp Omnichannel' })\n\nServes the domain flow from cache, re-deriving it from imports when stale (F13).";
  const { getFreshDomainFlow } = await import("../engine/kumaFlowCache.js");
  return await getFreshDomainFlow(domain);
}

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
        if (g.workaround) lines.push(`     💡 ${g.workaround.substring(0, 140)}`);
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
      if (resolved.length > 0) { lines.push("✅ **Resolved gotchas** (fixed):"); for (const r of resolved) lines.push(`  ✅ ${r.description.substring(0, 100)}`); lines.push(""); }
    } catch {}
    const decisions = await getDecisionsForFile(target, 3);
    if (decisions.length > 0) { lines.push("📌 **Relevant decisions**"); for (const d of decisions) lines.push(`  ${d}`); lines.push(""); }
  } catch {}
  lines.push("💡 This content is injected automatically before edits via the Claude Code PreToolUse hook (`kuma hook pre-edit`).");
  return lines.join("\n");
}

async function handleRollback(params: ContextParams): Promise<string> {
  const target = params.target;
  if (!target) return "⚠️ target parameter required (change ID, e.g. '5').";
  const changeId = parseInt(target, 10);
  if (isNaN(changeId)) return `⚠️ Invalid change ID: "${target}". Use a numeric ID from kuma_context({ action: 'changes' }).`;
  sessionMemory.recordToolCall("kuma_context_rollback", { changeId });
  return await rollbackChange(changeId);
}

async function handleDigest(_params: ContextParams): Promise<string> {
  sessionMemory.recordToolCall("kuma_context_digest", {});
  try {
    const { generateContextDigest } = await import("../engine/contextDigest.js");
    return await generateContextDigest();
  } catch (err) {
    try {
      const { generateDigest } = await import("../engine/domainRules.js");
      return generateDigest();
    } catch { return `Error generating digest: ${err}`; }
  }
}

async function handleDrift(_params: ContextParams): Promise<string> {
  sessionMemory.recordToolCall("kuma_context_drift", {});
  try {
    const { detectDrift, formatDriftReport, flagStaleRecords } = await import("../engine/kumaDriftDetector.js");
    await flagStaleRecords();
    const records = await detectDrift();
    return formatDriftReport(records);
  } catch (err) { return `Error detecting drift: ${err}`; }
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
