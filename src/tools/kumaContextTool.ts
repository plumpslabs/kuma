import { sessionMemory } from "../engine/sessionMemory.js";
import { getDb, getResearchCache, saveResearchCache } from "../engine/kumaDb.js";
import { queryGraph, searchGraph, analyzeImpact, formatImpact, traceFlow, formatFlow, getGraphStats } from "../engine/kumaGraph.js";
import { buildContextForGoal, formatContextItems } from "../engine/kumaContextEngine.js";
import { scoreConfidence } from "../engine/kumaSelfHeal.js";
import { scoreMemoryRelevance, formatScoredMemories, getProactiveMemories } from "../engine/kumaMemory.js";
import { computeSafetyScore, formatSafetyScore } from "../engine/safetyScore.js";
import { getChanges } from "../engine/kumaDb.js";
import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "../utils/pathValidator.js";
import crypto from "node:crypto";

type ContextAction = "init" | "research" | "impact" | "navigate" | "changes" | "health";

interface ContextParams {
  action: ContextAction;
  scope?: string;
  target?: string;
  goal?: string;
  since?: number;
  compact?: boolean;
}

export async function handleContext(params: ContextParams): Promise<string> {
  const { action } = params;

  switch (action) {
    case "init": return handleInit(params);
    case "research": return handleResearch(params);
    case "impact": return handleImpact(params);
    case "navigate": return handleNavigate(params);
    case "changes": return handleChanges(params);
    case "health": return handleHealth(params);
    default: return `Unknown action "${action}". Use: init, research, impact, navigate, changes, health`;
  }
}

// ============================================================
// INIT — Project Brief (coarse-grained pipeline)
// ============================================================

async function handleInit(_params: ContextParams): Promise<string> {
  sessionMemory.setGoal(_params.goal || "Exploring project");
  sessionMemory.recordToolCall("kuma_context_init", {});

  const lines: string[] = [
    "🧠 **Kuma — Project Brief**",
    `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    "",
    `📁 Project: ${getProjectRoot().split("/").pop() || "unknown"}`,
    `🕐 Session: ${new Date().toISOString()}`,
    "",
  ];

  // 1. Graph stats
  try {
    const graphStats = await getGraphStats();
    lines.push("**Knowledge Graph**");
    lines.push(graphStats);
    lines.push("");
  } catch {}

  // 2. Research cache
  try {
    const db = await getDb();
    const researchResult = db.exec("SELECT scope, updated_at, confidence FROM research_cache ORDER BY updated_at DESC LIMIT 10");
    if (researchResult[0]?.values.length) {
      lines.push("**Recent Research**");
      for (const row of researchResult[0].values) {
        const conf = (row[2] as number) || 0;
        lines.push(`  📚 ${row[0]} (${(conf * 100).toFixed(0)}% confidence)`);
      }
      lines.push("");
    }
  } catch {}

  // 3. Recent sessions
  try {
    const db = await getDb();
    const sessionResult = db.exec("SELECT goal, tool_calls, started_at FROM sessions ORDER BY started_at DESC LIMIT 3");
    if (sessionResult[0]?.values.length) {
      lines.push("**Recent Sessions**");
      for (const row of sessionResult[0].values) {
        const goal = (row[0] as string) || "no goal";
        const calls = row[1] as number || 0;
        const time = new Date((row[2] as number) * 1000).toLocaleDateString();
        lines.push(`  📋 ${goal.substring(0, 50)} — ${calls} calls, ${time}`);
      }
      lines.push("");
    }
  } catch {}

  // 4. Proactive memories
  const memories = getProactiveMemories();
  if (memories) {
    lines.push("**Relevant Memories**");
    lines.push(memories);
    lines.push("");
  }

  // 5. Session state
  const summary = sessionMemory.getSummary();
  lines.push("**Session State**");
  lines.push(`  🎯 Goal: ${(summary.currentGoal as string) || "not set"}`);
  lines.push(`  📝 Modified: ${(summary.modifiedFiles as Array<unknown>)?.length || 0} file(s)`);
  lines.push(`  🛠️ Tool calls: ${summary.toolCallCount}`);

  lines.push("", "💡 Call kuma_context({ action: 'research', scope: '<area>' }) to research a specific area.");

  return lines.join("\n");
}

// ============================================================
// RESEARCH — 5-Step Pipeline (coarse-grained)
// ============================================================

async function handleResearch(params: ContextParams): Promise<string> {
  const scope = params.scope || "project";
  sessionMemory.setGoal(`Researching: ${scope}`);
  sessionMemory.recordToolCall("kuma_context_research", { scope });

  const lines: string[] = [
    `🔬 **Research: ${scope}**`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    "",
  ];

  // STEP 1: Load Research Cache
  lines.push("**Step 1/5: Loading Research Cache**");
  const cached = await getResearchCache(scope);
  let record: Record<string, unknown> | null = null;
  if (cached) {
    try { record = JSON.parse(cached); } catch {}
  }
  if (record) {
    const age = Math.floor((Date.now() - (record.validatedAt ? new Date(record.validatedAt as string).getTime() : 0)) / 1000);
    lines.push(`  ✅ Found cached research (${age > 86400 ? `${Math.floor(age / 86400)}d` : `${Math.floor(age / 3600)}h`} old)`);
  } else {
    lines.push("  ⏳ No cached research — starting fresh");
  }
  lines.push("");

  // STEP 2: Check Staleness
  lines.push("**Step 2/5: Staleness Check**");
  if (record?.contentHash) {
    try {
      const currentHash = computeProjectHash(scope);
      if (currentHash === record.contentHash) {
        lines.push("  ✅ Content still fresh — no changes detected");
      } else {
        lines.push("  ⚠️ Content changed since cache — will update");
        record = null;
      }
    } catch {
      lines.push("  ⚠️ Could not verify staleness — will re-research");
      record = null;
    }
  } else {
    lines.push("  ⏳ No content hash available — will research fresh");
  }
  lines.push("");

  // STEP 3: Graph Query
  lines.push("**Step 3/5: Graph Query**");
  try {
    const graphResult = await searchGraph(scope, 15);
    const graphLines = graphResult.split("\n");
    if (graphLines.length > 1) {
      lines.push(`  📊 ${graphLines.filter(l => l.includes("•")).length} relevant node(s) found`);
      for (const l of graphLines.slice(0, 8)) {
        if (l.includes("•")) lines.push(`  ${l}`);
      }
    } else {
      lines.push("  ⏳ No graph data yet — build by using more tools");
    }
  } catch {
    lines.push("  ⚠️ Graph query failed");
  }
  lines.push("");

  // STEP 4: Impact Analysis
  lines.push("**Step 4/5: Impact Analysis**");
  try {
    const impact = await analyzeImpact(scope);
    lines.push(`  📊 ${impact.references} reference(s) across ${impact.files} file(s)`);
    lines.push(`  🧪 ${impact.testFiles} test file(s) related`);
    lines.push(`  ⚠️ Risk: ${impact.risk.toUpperCase()}`);
    if (impact.entryPoints.length > 0) {
      lines.push(`  🎯 Entry: ${impact.entryPoints.slice(0, 3).join(", ")}`);
    }
  } catch {
    lines.push("  ⚠️ Impact analysis unavailable");
  }
  lines.push("");

  // STEP 5: Decision & Failure Lookup
  lines.push("**Step 5/5: Decision & Context Lookup**");
  try {
    const memories = scoreMemoryRelevance(scope, 3);
    if (memories.length > 0) {
      lines.push("  📝 Relevant decisions/memories:");
      for (const m of memories) {
        lines.push(`    • ${m.topic} (${m.score}% match)`);
      }
    } else {
      lines.push("  ✅ No previous decisions found for this scope");
    }
  } catch {
    lines.push("  ⚠️ Memory lookup failed");
  }
  lines.push("");

  // Save to research cache
  const newRecord = {
    scope,
    confidence: record?.confidence || 0.7,
    entryPoints: [],
    flow: [],
    dependencies: [],
    tests: [],
    riskAreas: [],
    decisions: [],
    contentHash: computeProjectHash(scope),
    validatedAt: new Date().toISOString(),
  };
  await saveResearchCache(scope, JSON.stringify(newRecord), newRecord.contentHash, newRecord.confidence);

  lines.push("📝 Research saved to cache. Call kuma_memory({ action: 'research_save' }) to save custom notes.");

  return lines.join("\n");
}

// ============================================================
// IMPACT — Impact Analysis
// ============================================================

async function handleImpact(params: ContextParams): Promise<string> {
  const target = params.target || params.scope;
  if (!target) return "⚠️ target or scope parameter required.";

  sessionMemory.recordToolCall("kuma_context_impact", { target });
  const impact = await analyzeImpact(target);
  return formatImpact(impact);
}

// ============================================================
// NAVIGATE — Flow Navigation
// ============================================================

async function handleNavigate(params: ContextParams): Promise<string> {
  const entryPoint = params.target || params.scope;
  if (!entryPoint) return "⚠️ target or scope parameter required.";

  sessionMemory.recordToolCall("kuma_context_navigate", { entryPoint });
  const steps = await traceFlow(entryPoint);
  return formatFlow(entryPoint, steps);
}

// ============================================================
// CHANGES — Change Log
// ============================================================

async function handleChanges(params: ContextParams): Promise<string> {
  const filePath = params.target;
  const since = params.since;
  return await getChanges({ filePath, since });
}

// ============================================================
// HEALTH — Project Health Dashboard
// ============================================================

async function handleHealth(_params: ContextParams): Promise<string> {
  sessionMemory.recordToolCall("kuma_context_health", {});
  try {
    const score = await computeSafetyScore();
    const { saveHealthSnapshot } = await import("../engine/kumaDb.js");
    const checksStr = JSON.stringify(score.checks);
    await saveHealthSnapshot(score.score, score.risk, checksStr, score.summary);
    return formatSafetyScore(score);
  } catch (err) {
    return `Error computing health: ${err}`;
  }
}

// ============================================================
// HELPERS
// ============================================================

function computeProjectHash(scope: string): string {
  try {
    const root = getProjectRoot();
    const files = fs.readdirSync(root).slice(0, 20);
    const hash = crypto.createHash("md5");
    hash.update(scope);
    for (const f of files) {
      try {
        const stat = fs.statSync(path.join(root, f));
        hash.update(`${f}:${stat.mtimeMs}`);
      } catch {}
    }
    return hash.digest("hex").substring(0, 12);
  } catch {
    return Date.now().toString(16);
  }
}
