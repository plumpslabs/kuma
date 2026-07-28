import { sessionMemory } from "../engine/sessionMemory.js";
import { getDb, getResearchCache, saveResearchCache, getChanges, rollbackChange, listResearchCache } from "../engine/kumaDb.js";
import { searchGraph, analyzeImpact, formatImpact, traceFlow, formatFlow, getGraphStats } from "../engine/kumaGraph.js";
import { scoreMemoryRelevance, getProactiveMemories } from "../engine/kumaMemory.js";
import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "../utils/pathValidator.js";
import crypto from "node:crypto";

type ContextAction = "init" | "research" | "impact" | "navigate" | "changes" | "health" | "rollback" | "researches" | "sync" | "visualize" | "digest" | "drift" | "progressive";

const CONTEXT_ALIASES: Record<string, ContextAction> = {
  // Research synonyms
  "research": "research",
  "search": "research",
  "explore": "research",
  "inspect": "research",
  // Impact synonyms
  "analyze": "impact",
  "impact": "impact",
  "whatif": "impact",
  "refactor": "impact",
  // Navigate synonyms
  "trace": "navigate",
  "flow-trace": "navigate",
  "navigate": "navigate",
  // Init synonyms
  "init": "init",
  "start": "init",
  "load": "init",
  "brief": "init",
  "project": "init",
  "summary": "init",
  // Changes synonyms
  "changes": "changes",
  "log": "changes",
  "history": "changes",
  // Health synonyms
  "health": "health",
  "score": "health",
  "status": "health",
  // Rollback synonyms
  "rollback": "rollback",
  "undo": "rollback",
  "revert": "rollback",
  // Researches synonyms
  "researches": "researches",
  "research-list": "researches",
  "list-research": "researches",
  // Sync/Batch synonyms (Issue #12)
  "sync": "sync",
  "batch": "sync",
  "kuma_sync": "sync",
  "unified": "sync",
  "state": "sync",
  // Visualize synonyms (Issue #16)
  "visualize": "visualize",
  "graph": "visualize",
  "diagram": "visualize",
  "flow": "visualize",
  "viz": "visualize",
  "kuma_visualize": "visualize",
  // Digest synonyms (Issue #18)
  "digest": "digest",
  "bootstrap": "digest",
  "kuma_digest": "digest",
  "kuma_bootstrap": "digest",
  "briefing": "digest",
  "overview": "digest",
  // Drift detection synonyms (Issue #20)
  "drift": "drift",
  "staleness": "drift",
  "code-drift": "drift",
  "freshness": "drift",
  // Progressive context synonyms (Issue #25)
  "progressive": "progressive",
  "prog": "progressive",
  "section": "progressive",
  "sectional": "progressive",
};

interface ContextParams {
  action?: ContextAction | string;
  scope?: string;
  target?: string;
  goal?: string;
  since?: number;
  compact?: boolean;
  section?: string;
}

export async function handleContext(params: ContextParams): Promise<string> {
  // Resolve action with default + aliases
  const rawAction = params.action || "init";
  const resolvedAction = CONTEXT_ALIASES[rawAction.toLowerCase()] || rawAction;
  const action = resolvedAction as ContextAction;

  switch (action) {
    case "init": return handleInit(params);
    case "research": return handleResearch(params);
    case "impact": return handleImpact(params);
    case "navigate": return handleNavigate(params);
    case "changes": return handleChanges(params);
    case "rollback": return handleRollback(params);
    case "researches": return handleResearches(params);
    case "health": return handleHealth(params);
    case "sync": return handleSync(params);
    case "visualize": return handleVisualize(params);
    case "digest": return handleDigest(params);
    case "drift": return handleDrift(params);
    case "progressive": return handleProgressive(params);
    default: return `Unknown action "${action}". Use: init, research, impact, navigate, changes, rollback, researches, health, sync, visualize, digest, drift, progressive`;
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

  // 6. AUTO-COMPUTE HEALTH SCORE on init
  try {
    const { computeSafetyScore, formatSafetyScore } = await import("../engine/safetyScore.js");
    const { saveHealthSnapshot } = await import("../engine/kumaDb.js");
    const score = await computeSafetyScore(_params.goal);
    const checksStr = JSON.stringify(score.checks);
    await saveHealthSnapshot(score.score, score.risk, checksStr, score.summary);
    lines.push("");
    lines.push("**Health Score**");
    lines.push(formatSafetyScore(score));
  } catch {
    // Health score is non-critical
  }

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
    const ageSeconds = Math.floor((Date.now() - (record.validatedAt ? new Date(record.validatedAt as string).getTime() : 0)) / 1000);
    const ageStr = ageSeconds > 86400 ? `${Math.floor(ageSeconds / 86400)}d` : ageSeconds > 3600 ? `${Math.floor(ageSeconds / 3600)}h` : `${Math.floor(ageSeconds / 60)}m`;
    lines.push(`  ✅ Found cached research (${ageStr} old)`);

    // STALE CACHE WARNING: Surface staleness info when serving cached result
    if (ageSeconds > 86400) {
      lines.push(`  ${ageSeconds > 604800 ? "🔴" : "🟡"} **Staleness:** Cache is ${ageStr} old — may be stale`);
      if (ageSeconds > 604800) {
        lines.push("  💡 Consider re-researching: cache is over a week old");
      }
    }
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

  // STEP 3: Graph Query + Codebase Fallback + Auto-Scan
  lines.push("**Step 3/5: Graph Query + Code Scan**");
  try {
    const graphResult = await searchGraph(scope, 15);
    const graphLines = graphResult.split("\n");
    if (graphLines.length > 1 && !graphResult.includes("No results")) {
      lines.push(`  📊 ${graphLines.filter(l => l.includes("•")).length} relevant node(s) found`);
      for (const l of graphLines.slice(0, 8)) {
        if (l.includes("•")) lines.push(`  ${l}`);
      }
    } else {
      // CODEBASE FALLBACK: Use fast-glob to find relevant files
      lines.push("  ⏳ No graph data — searching codebase...");
      try {
        const fg = (await import("fast-glob")).default;
        const root = getProjectRoot();
        const ignorePatterns = ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**", "**/.kuma/**"];
        const files = await fg([`**/*${scope}*`], { cwd: root, ignore: ignorePatterns, onlyFiles: true, deep: 6 });
        if (files.length > 0) {
          lines.push(`  📁 Found ${files.length} file(s) in codebase matching "${scope}":`);
          for (const f of files.slice(0, 8)) {
            lines.push(`    📄 ${f}`);
          }
          if (files.length > 8) lines.push(`    ... and ${files.length - 8} more`);
        } else {
          lines.push("  ⏳ No codebase matches — build graph by using more tools");
        }
      } catch {
        lines.push("  ⏳ No graph data yet — build by using more tools");
      }
    }
  } catch {
    lines.push("  ⚠️ Graph query failed");
  }
  // Auto-scan: if graph is sparse, run code scanner to populate it
  try {
    const { scanCodebase } = await import("../engine/kumaCodeScanner.js");
    const scanResult = await scanCodebase({ scope, maxFiles: 100 });
    if (scanResult.nodeCount > 0 || scanResult.edgeCount > 0) {
      lines.push(`  🔬 Auto-scanned ${scanResult.filesScanned} files → ${scanResult.nodeCount} nodes, ${scanResult.edgeCount} edges`);
    }
  } catch { /* scanner unavailable — non-critical */ }

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
    confidence: (record?.confidence as number) || 0.7,
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
// ROLLBACK — Selective Undo by Change ID (Issue #15)
// ============================================================

async function handleRollback(params: ContextParams): Promise<string> {
  const target = params.target;
  if (!target) return "⚠️ target parameter required (change ID, e.g. '5').";

  const changeId = parseInt(target, 10);
  if (isNaN(changeId)) return `⚠️ Invalid change ID: "${target}". Use a numeric ID from kuma_context({ action: 'changes' }).`;

  sessionMemory.recordToolCall("kuma_context_rollback", { changeId });
  return await rollbackChange(changeId);
}

// ============================================================
// RESEARCHES — List all cached research (Issue #5: Dual Storage)
// ============================================================

async function handleResearches(_params: ContextParams): Promise<string> {
  sessionMemory.recordToolCall("kuma_context_researches", {});
  return await listResearchCache();
}

// ============================================================
// HEALTH — Project Health Dashboard
// ============================================================

async function handleHealth(_params: ContextParams): Promise<string> {
  sessionMemory.recordToolCall("kuma_context_health", {});
  try {
    const { computeSafetyScore, formatSafetyScore } = await import("../engine/safetyScore.js");
    const { saveHealthSnapshot } = await import("../engine/kumaDb.js");
    const score = await computeSafetyScore();
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

// ============================================================
// SYNC — Unified Batch API (Issue #12)
// Combines init + health + memory state in single roundtrip
// ============================================================

async function handleSync(params: ContextParams): Promise<string> {
  sessionMemory.setGoal(params.goal || "Sync session");
  sessionMemory.recordToolCall("kuma_context_sync", { goal: params.goal });

  const lines: string[] = [
    "🔄 **Kuma Sync — Unified State**",
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    "",
    `📁 Project: ${getProjectRoot().split("/").pop() || "unknown"}`,
    `🕐 Session: ${new Date().toISOString()}`,
    "",
  ];

  // 1. Session state
  const summary = sessionMemory.getSummary();
  lines.push("**Session State**");
  lines.push(`  🎯 Goal: ${(summary.currentGoal as string) || "not set"}`);
  lines.push(`  📝 Modified: ${(summary.modifiedFiles as Array<unknown>)?.length || 0} file(s)`);
  lines.push(`  🛠️ Tool calls: ${summary.toolCallCount}`);
  lines.push("");

  // 2. Health score (auto-computed inline)
  try {
    const { computeSafetyScore, formatSafetyScore } = await import("../engine/safetyScore.js");
    const { saveHealthSnapshot } = await import("../engine/kumaDb.js");
    const score = await computeSafetyScore(params.goal);
    const checksStr = JSON.stringify(score.checks);
    await saveHealthSnapshot(score.score, score.risk, checksStr, score.summary);
    lines.push("**Health Score**");
    lines.push(formatSafetyScore(score));
  } catch {
    lines.push("**Health Score**: ⚠️ Could not compute");
  }
  lines.push("");

  // 3. Graph stats
  try {
    const { getGraphStats } = await import("../engine/kumaGraph.js");
    lines.push("**Knowledge Graph**");
    lines.push(await getGraphStats());
  } catch {}
  lines.push("");

  // 4. Proactive memories
  try {
    const { getProactiveMemories } = await import("../engine/kumaMemory.js");
    const memories = getProactiveMemories();
    if (memories) {
      lines.push("**Relevant Memories**");
      lines.push(memories);
      lines.push("");
    }
  } catch {}

  lines.push("💡 Sync complete — all state captured in a single roundtrip.");

  return lines.join("\n");
}

// ============================================================
// VISUALIZE — Knowledge Graph Visualizer (Issue #16)
// ============================================================

async function handleVisualize(params: ContextParams): Promise<string> {
  const scope = params.scope;
  const { generateVisualizeReport } = await import("../engine/kumaVisualize.js");
  return await generateVisualizeReport({
    scope,
    type: "flowchart",
    maxNodes: 40,
  });
}

// ============================================================
// DIGEST — Ultra-Compact Context Digest (Issue #18)
// ============================================================

async function handleDigest(_params: ContextParams): Promise<string> {
  sessionMemory.recordToolCall("kuma_context_digest", {});
  try {
    const { generateContextDigest } = await import("../engine/contextDigest.js");
    return await generateContextDigest();
  } catch (err) {
    // Fallback to generateDigest from domainRules
    try {
      const { generateDigest } = await import("../engine/domainRules.js");
      return generateDigest();
    } catch {
      return `Error generating digest: ${err}`;
    }
  }
}

// ============================================================
// DRIFT — Code Drift Detection (Issue #20)
// ============================================================

async function handleDrift(_params: ContextParams): Promise<string> {
  sessionMemory.recordToolCall("kuma_context_drift", {});
  try {
    const { detectDrift, formatDriftReport, flagStaleRecords } = await import("../engine/kumaDriftDetector.js");
    await flagStaleRecords();
    const records = await detectDrift();
    return formatDriftReport(records);
  } catch (err) {
    return `Error detecting drift: ${err}`;
  }
}

// ============================================================
// PROGRESSIVE — Progressive Context Loading (Issue #25)
// ============================================================

async function handleProgressive(params: ContextParams): Promise<string> {
  sessionMemory.recordToolCall("kuma_context_progressive", { scope: params.scope, section: params.section });
  try {
    const { getProgressiveContext, loadSection } = await import("../engine/kumaProgressiveContext.js");

    // If section is specified, load only that section
    if (params.section) {
      const validSections = ["domain_rules", "architecture", "gotchas", "decisions", "graph", "changes", "health"];
      if (!validSections.includes(params.section)) {
        return `⚠️ Invalid section "${params.section}". Valid sections: ${validSections.join(", ")}`;
      }
      const content = await loadSection(params.section as any, params.scope);
      return [
        `🧩 **Progressive Context** — Section: ${params.section}`,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        "",
        content,
      ].join("\n");
    }

    // Full progressive: meta + relevant sections
    const result = await getProgressiveContext(params.scope);
    const lines: string[] = [
      "🧩 **Progressive Context**",
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      "",
      `📋 **Meta**: ${result.meta}`,
      `🔗 **Skill Boundary**: ${result.boundary.name} — ${result.boundary.description}`,
      "",
    ];

    for (const section of result.sections) {
      lines.push(section.content);
      lines.push("");
    }

    lines.push("💡 Use kuma_context({ action: 'progressive', section: 'gotchas', scope: 'auth' }) to load specific context on demand.");

    return lines.join("\n");
  } catch (err) {
    return `Error generating progressive context: ${err}`;
  }
}

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
