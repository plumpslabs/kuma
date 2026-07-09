// ============================================================
// KUMA ROUTER — Unified Tool Router (Phase ∞)
// ============================================================
// Consolidates 46 individual MCP tools into 10 grouped tools.
// Each group has an `action` enum; the dispatcher routes to
// the correct handler. AI scans 10 groups instead of 46 tools.
// ============================================================
//
// WORKFLOW TRIGGER NOTES (for AI agents):
// 
// 🔵 kuma_init  → Call once per session. Must be first.
// 🟢 kuma_core  → Use during active coding: grep, read, edit.
// 🟡 kuma_verify → After every edit: test, review, lint.
// 🔴 kuma_safety → Before risky ops: guard, score, check.
// 🟣 kuma_graph → For codebase understanding: navigate, diagram.
// 🧠 kuma_memory → To persist/retrieve context: write, search, memory.
// 📊 kuma_analytics → Session review: reflect, analytics, replay.
// ⏳ kuma_history → Git/time analysis: timeline, log, diff.
// 🔒 kuma_lock → Multi-agent coordination: acquire, release.
// ⚙️ kuma_advanced → Maintenance: failure, shadow, compress.

import { handleSmartGrep } from "../tools/smartGrep.js";
import { handleSmartFilePicker } from "../tools/smartFilePicker.js";
import { handlePreciseDiffEditor } from "../tools/preciseDiffEditor.js";
import { handleBatchFileWriter } from "../tools/batchFileWriter.js";
import { handleSafeTerminalExec } from "../tools/safeTerminalExec.js";
import { handleCodeReviewer } from "../agents/codeReviewer.js";
import { handleProjectConventions } from "../agents/projectConventions.js";
import { handleGitLog } from "../tools/gitLog.js";
import { handleGitDiff } from "../tools/gitDiff.js";
import { handleProjectStructure } from "../tools/projectStructure.js";
import { handleStaticAnalysis } from "../tools/staticAnalysis.js";
import { handleReflect } from "../tools/kumaReflect.js";
import { computeAnalytics, formatAnalytics } from "./kumaAnalytics.js";
import { computeHealthDashboard, formatHealthDashboard } from "./kumaHealthDashboard.js";
import { handleKumaGuard } from "../tools/kumaGuard.js";
import { handleKumaContext } from "../tools/kumaContext.js";
import { handleKumaInit } from "../tools/kumaInit.js";
import { handleKumaRisk } from "../tools/kumaRisk.js";
import { handleDependencyGuard } from "../tools/kumaDependencyGuard.js";
import { handlePolicyCheck } from "../tools/kumaPolicy.js";
import { computeSafetyScore, formatSafetyScore } from "./safetyScore.js";
import { queryGraph, searchGraph, getGraphStats } from "./kumaGraph.js";
import { getExperienceSuggestions, getErrorPatterns, formatExperienceReport, pruneExperiences } from "./kumaExperience.js";
import { getSessionMemory, handleWriteMemory, searchSessionMemory } from "./sessionMemory.js";
import { handleLspQuery } from "../tools/lspTools.js";
import { getSymbolTimeline, formatTimeline, getFileHistory, formatFileHistory, analyzeCommitMessages } from "./kumaTimeMachine.js";
import { getIntentPatterns, suggestIntentPath, formatIntentPatterns, formatIntentSuggestion } from "./kumaIntent.js";
import { detectArchitecture, getArchitectureProfile, scanFilesystemForViolations, scanGraphForViolations, formatViolations, formatArchitectureDetection, getArchitectureProfiles } from "./kumaArchGuard.js";
import { recordDecision, shouldRecordDecision, formatDecisionTemplate } from "./kumaMemory.js";
import { buildContextForGoal, formatContextItems } from "./kumaContextEngine.js";
import { detectStaleNodes, autoHeal, formatHealReport } from "./kumaSelfHeal.js";
import { navigate } from "./kumaNavigator.js";
import { generateDiagram } from "./kumaMermaid.js";
import { computeHeatMap, formatHeatMap, getSessionActivity } from "./kumaHeatMap.js";
import { investigate } from "./kumaInvestigator.js";
import { captureArchitecture, diffArchitecture, generateLiveArchitectureDiagram } from "./kumaLivingArch.js";
import { acquireLock, releaseLock, listLocks, cleanStaleLocks } from "./kumaLock.js";
import { replaySession } from "./kumaReplay.js";
import { predictNext } from "./kumaPredict.js";
import { learnPatterns } from "./kumaLearning.js";
import { computeConfidence } from "./kumaConfidence.js";
import { generateDNA } from "./kumaDNA.js";
import { recordFailure, queryFailures, failureStats } from "./kumaFailureKB.js";
import { compressGraph } from "./kumaSemantic.js";
import { simulateChange } from "./kumaShadow.js";
import { safetyCheck, safetyOverride } from "./kumaSafetyLayer.js";
import { handleSafetyCheck } from "../tools/kumaSafetyCheck.js";
import { discoverCollectivePatterns, exportAnonymizedPatterns, syncCollective } from "./kumaCollective.js";
import { listMarketplace, installTemplate } from "./kumaMarketplace.js";

// ============================================================
// kuma_init — Session initialization
// ============================================================
export async function handleInit(action: string, params: Record<string, unknown>): Promise<string> {
  switch (action) {
    case "init": return await handleKumaInit(params);
    case "conventions": return await handleProjectConventions(params);
    case "structure": return await handleProjectStructure(params);
    default: return `⚠️ Unknown action "${action}" for kuma_init. Use: init, conventions, structure`;
  }
}

// ============================================================
// kuma_core — Core editing tools
// ============================================================
export async function handleCore(action: string, params: Record<string, unknown>): Promise<string> {
  switch (action) {
    case "grep": return await handleSmartGrep(params as any);
    case "read": return await handleSmartFilePicker(params as any);
    case "edit": return await handlePreciseDiffEditor(params as any);
    case "batch": return await handleBatchFileWriter(params as any);
    case "lsp": return await handleLspQuery(({ ...params, action: params.lspAction }) as any);
    default: return `⚠️ Unknown action "${action}" for kuma_core. Use: grep, read, edit, batch, lsp`;
  }
}

// ============================================================
// kuma_verify — Testing, review, linting
// ============================================================
export async function handleVerify(action: string, params: Record<string, unknown>): Promise<string> {
  switch (action) {
    case "test": return await handleSafeTerminalExec(params as any);
    case "review": return await handleCodeReviewer(params as any);
    case "lint": return await handleStaticAnalysis(params as any);
    default: return `⚠️ Unknown action "${action}" for kuma_verify. Use: test, review, lint`;
  }
}

// ============================================================
// kuma_safety — Safety checks & risk prediction
// ============================================================
export async function handleSafety(action: string, params: Record<string, unknown>): Promise<string> {
  switch (action) {
    case "guard": return await handleKumaGuard(params);
    case "score": return formatSafetyScore(computeSafetyScore(params.goal as string | undefined));
    case "check": return await safetyCheck(params.actionCheck as string || "", params.filePath as string | undefined, params.command as string | undefined);
    case "policy": return await handlePolicyCheck(params as any);
    case "risk": return await handleKumaRisk(params as any);
    case "dependency": return await handleDependencyGuard(params as any);
    case "context": return await handleKumaContext({ ...params, action: params.contextAction as "save" | "list" });
    case "audit": return await handleSafetyCheck(params as any);
    case "stats": return await handleSafetyCheck(params as any);
    case "override": return safetyOverride(params.tool as string, params.reason as string);
    default: return `⚠️ Unknown action "${action}" for kuma_safety. Use: guard, score, check, policy, risk, dependency, context, audit, stats, override`;
  }
}

// ============================================================
// kuma_graph — Knowledge graph navigation & queries
// ============================================================
export async function handleGraph(action: string, params: Record<string, unknown>): Promise<string> {
  switch (action) {
    case "query": {
      const type = (params.type as string) || "nodes";
      const query = params.query as string | undefined;
      const limit = (params.limit as number) || 20;
      if (type === "stats") return await getGraphStats();
      if (type === "search" && query) return await searchGraph(query, limit);
      if (query) return await queryGraph({ type: type as any, query, limit });
      return "⚠️ query parameter required.";
    }
    case "navigate":
      if (typeof params.query === "string") return await navigate(params.query);
      return "⚠️ query param required for navigate.";
    case "diagram": return await generateDiagram(params as any);
    case "investigate":
      if (typeof params.problem === "string") return await investigate(params.problem);
      return "⚠️ problem param required for investigate.";
    case "arch":
      if (params.archAction === "capture") return await captureArchitecture();
      if (params.archAction === "diff") return await diffArchitecture();
      if (params.archAction === "diagram") return await generateLiveArchitectureDiagram();
      return await detectAndFormatArch(params);
    case "experience": {
      if (params.experienceAction === "prune") { await pruneExperiences((params.keepPerTool as number) || 50); return "✅ Pruned."; }
      if (params.experienceAction === "errors" && params.toolName) {
        const patterns = await getErrorPatterns(params.toolName as string, (params.limit as number) || 5);
        return patterns.length === 0 ? `✅ No error patterns for "${params.toolName}".` : `❌ Error patterns:\n${patterns.map(p => `  • ${p}`).join("\n")}`;
      }
      if (params.experienceAction === "suggest") {
        const { sessionMemory } = await import("./sessionMemory.js");
        const history = sessionMemory.getToolCallHistory(2);
        if (history.length === 0) return "⚠️ No tool calls yet.";
        const lastCall = history[history.length - 1];
        const suggestions = await getExperienceSuggestions({ lastToolName: lastCall.toolName, lastParams: lastCall.params, currentFile: (lastCall.params as any)?.filePath });
        if (suggestions.length === 0) return "⚠️ No learned patterns yet.";
        return suggestions.map(s => `→ ${s.consequentTool} (${(s.confidence * 100).toFixed(0)}%, ${s.count}x)`).join("\n");
      }
      return await formatExperienceReport(params.toolName as string | undefined);
    }
    case "intent": {
      const intent = params.intent as string | undefined;
      if (params.intentAction === "suggest" && intent) {
        const suggestion = await suggestIntentPath(intent);
        if (!suggestion) return `🧠 No intent patterns for "${intent}".`;
        return formatIntentSuggestion(intent, suggestion);
      }
      return formatIntentPatterns(await getIntentPatterns((params.limit as number) || 10));
    }
    default: return `⚠️ Unknown action "${action}" for kuma_graph. Use: query, navigate, diagram, investigate, arch, experience, intent`;
  }
}

async function detectAndFormatArch(params: Record<string, unknown>): Promise<string> {
  try {
    if (params.archAction === "profiles") {
      const profiles = getArchitectureProfiles();
      return `🏗️ Available Profiles:\n${profiles.map(p => `  • ${p.description}`).join("\n")}`;
    }
    const profile = params.profile ? getArchitectureProfile(params.profile as string) : detectArchitecture();
    if (params.archAction === "fs") return formatViolations(await scanFilesystemForViolations(profile), profile.name);
    if (params.archAction === "graph") return formatViolations(await scanGraphForViolations(profile), profile.name);
    return formatArchitectureDetection(detectArchitecture());
  } catch (err) {
    return `Error: ${err}`;
  }
}

// ============================================================
// kuma_memory — Session & persistent memory
// ============================================================
export async function handleMemory(action: string, params: Record<string, unknown>): Promise<string> {
  switch (action) {
    case "get": return JSON.stringify(getSessionMemory(params.topic as any), null, 2);
    case "search": return searchSessionMemory({ query: params.query as string, limit: params.limit as number | undefined });
    case "write": return handleWriteMemory(params as any);
    case "decision": {
      const a = params.decisionAction as string || params.action as string || "";
      if (a === "template") return formatDecisionTemplate();
      if (a === "suggest") {
        const check = shouldRecordDecision();
        return check.worth ? `💡 Decision suggested: ${check.title}` : "✅ No decision needed.";
      }
      if (a === "record" && params.title && params.context && params.rationale && params.outcome) {
        return recordDecision({ title: params.title as string, context: params.context as string, options: (params.options as string[]) || [], rationale: params.rationale as string, outcome: params.outcome as string, timestamp: new Date().toISOString() });
      }
      return "⚠️ action='record' needs: title, context, rationale, outcome";
    }
    case "context": {
      const goal = params.goal as string;
      if (!goal || goal.length < 3) return "⚠️ goal param (min 3 chars) required.";
      const { context, summary } = await buildContextForGoal(goal);
      if (context.length === 0) return `🔍 No context for "${goal}".`;
      return formatContextItems(context.slice(0, (params.limit as number) || 15), summary);
    }
    case "heal": {
      if (params.healAction === "check") {
        const stale = await detectStaleNodes();
        if (stale.length === 0) return "✅ No stale entries.";
        return `🔍 ${stale.length} stale entries found. Use heal to repair.`;
      }
      // Default or healAction=heal → auto-heal
      const result = await autoHeal();
      return formatHealReport(result);
    }
    default: return `⚠️ Unknown action "${action}" for kuma_memory. Use: get, search, write, decision, context, heal`;
  }
}

// ============================================================
// kuma_analytics — Session analytics & reflection
// ============================================================
export async function handleAnalytics(action: string, params: Record<string, unknown>): Promise<string> {
  switch (action) {
    case "reflect": return await handleReflect(params);
    case "analytics": return formatAnalytics(computeAnalytics());
    case "health": return formatHealthDashboard(computeHealthDashboard());
    case "replay": return replaySession();
    case "heatmap": {
      const report = await computeHeatMap();
      let text = formatHeatMap(report);
      if (params.sessionStats) {
        const stats = await getSessionActivity();
        text += `\n\n📈 ${stats.totalSessions} sessions | Avg ${stats.avgEditsPerSession} edits/session`;
      }
      return text;
    }
    case "learn": return await learnPatterns();
    case "predict": return await predictNext((params.context as string) || "");
    case "confidence": return await computeConfidence(params.target as string | undefined);
    case "dna": return await generateDNA();
    default: return `⚠️ Unknown action "${action}" for kuma_analytics. Use: reflect, analytics, health, replay, heatmap, learn, predict, confidence, dna`;
  }
}

// ============================================================
// kuma_history — Git & code history
// ============================================================
export async function handleHistory(action: string, params: Record<string, unknown>): Promise<string> {
  switch (action) {
    case "timeline": {
      const fp = params.filePath as string;
      if (!fp) return "⚠️ filePath required.";
      if (params.symbolAction === "file") return formatFileHistory(fp, getFileHistory(fp, (params.maxCount as number) || 20));
      if (!params.symbol) return "⚠️ symbol required for timeline.";
      const timeline = await getSymbolTimeline(params.symbol as string, fp, (params.symbolType as any) || "function");
      const history = getFileHistory(fp, (params.maxCount as number) || 20);
      const analysis = analyzeCommitMessages(history);
      return formatTimeline(params.symbol as string, fp, timeline, analysis.decisions);
    }
    case "log": return await handleGitLog(params);
    case "diff": return await handleGitDiff(params);
    default: return `⚠️ Unknown action "${action}" for kuma_history. Use: timeline, log, diff`;
  }
}

// ============================================================
// kuma_lock — Multi-agent file locking
// ============================================================
export async function handleLock(action: string, params: Record<string, unknown>): Promise<string> {
  const fp = params.filePath as string | undefined;
  const agentId = params.agentId as string | undefined;
  switch (action) {
    case "acquire": return fp ? acquireLock(fp, agentId) : "⚠️ filePath required.";
    case "release": return fp ? releaseLock(fp, agentId) : "⚠️ filePath required.";
    case "list": return listLocks();
    case "clean": return cleanStaleLocks();
    default: return `⚠️ Unknown action "${action}" for kuma_lock. Use: acquire, release, list, clean`;
  }
}

// ============================================================
// kuma_advanced — Maintenance & advanced tools
// ============================================================
export async function handleAdvanced(action: string, params: Record<string, unknown>): Promise<string> {
  switch (action) {
    case "failure": {
      const a = params.failureAction as string || params.action as string || "";
      if (a === "stats") return await failureStats();
      if (a === "query" && params.query) return await queryFailures(params.query as string);
      if (a === "record" && params.type && params.errorMessage) {
        return await recordFailure({ type: params.type as any, symbol: params.symbol as string | undefined, filePath: params.filePath as string | undefined, errorMessage: params.errorMessage as string, solution: params.solution as string | undefined });
      }
      return "⚠️ For record: type + errorMessage. For query: query param.";
    }
    case "compress": return await compressGraph();
    case "shadow": return await simulateChange(params.shadowType as any || "modify", params.target as string, params.newName as string | undefined);
    case "collective": {
      if (params.collectiveAction === "export") return exportAnonymizedPatterns();
      if (params.collectiveAction === "sync") return await syncCollective();
      return await discoverCollectivePatterns();
    }
    case "marketplace": {
      if (params.marketplaceAction === "install" && params.template) return await installTemplate(params.template as string);
      return await listMarketplace();
    }
    default: return `⚠️ Unknown action "${action}" for kuma_advanced. Use: failure, compress, shadow, collective, marketplace`;
  }
}
