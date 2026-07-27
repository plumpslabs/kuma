import { sessionMemory } from "../engine/sessionMemory.js";
import { saveResearchCache, getChanges, addTodo, listTodos, updateTodoStatus, addContextNote, listContextNotes, saveBenchmark, getBenchmarkDiff, recordDecisionLog, listDecisionLog, updateDecisionStatus } from "../engine/kumaDb.js";
import { autoHeal, detectStaleNodes, formatHealReport } from "../engine/kumaSelfHeal.js";
import { recordDecision, formatDecisionTemplate } from "../engine/kumaMemory.js";
import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "../utils/pathValidator.js";

type MemoryAction = "decision" | "research_save" | "session" | "heal" | "search" | "changes" | "todo" | "context" | "benchmark" | "decision_log" | "mine";

const MEMORY_ALIASES: Record<string, string> = {
  // Session synonyms
  "session": "session",
  "summary": "session",
  "status": "session",
  "get": "session",
  "read": "session",
  "fetch": "session",
  "current": "session",
  // Decision synonyms
  "decision": "decision",
  "adr": "decision",
  "record-decision": "decision",
  // Research save synonyms
  "research_save": "research_save",
  "save": "research_save",
  "store": "research_save",
  "write": "research_save",
  "persist": "research_save",
  "cache": "research_save",
  // Mine synonyms
  "mine": "mine",
  "mine-decisions": "mine",
  "git-mine": "mine",
  "dig": "mine",
  // Heal synonyms
  "heal": "heal",
  "repair": "heal",
  "fix-graph": "heal",
  "clean-graph": "heal",
  // Search synonyms
  "search": "search",
  "find": "search",
  "query": "search",
  "lookup": "search",
  // Todo synonyms
  "todo": "todo",
  "task": "todo",
  "todos": "todo",
  "tasks": "todo",
  // Context notes synonyms
  "context": "context",
  "notes": "context",
  "note": "context",
  "inject": "context",
  "context-note": "context",
  // Benchmark synonyms
  "benchmark": "benchmark",
  "perf": "benchmark",
  "metrics": "benchmark",
  "measure": "benchmark",
  // Decision log synonyms
  "decision_log": "decision_log",
  "decisions": "decision_log",
  "log": "decision_log",
  "decision-log": "decision_log",
  // Changes synonyms
  "changes": "changes",
  "change-log": "changes",
  "history": "changes",
};

interface MemoryParams {
  action?: MemoryAction;
  scope?: string;
  query?: string;
  content?: string;
  record?: string;
  confidence?: number;
  confirm?: boolean;

  decisionAction?: "template" | "suggest" | "record";
  title?: string;
  context?: string;
  rationale?: string;
  outcome?: string;
  healAction?: "check" | "heal";
  topic?: string;
  goal?: string;
  limit?: number;
  since?: number | string;
  target?: string;

  // Todo params
  description?: string;
  deps?: string;
  success_criteria?: string;
  status?: string;
  todoId?: number;

  // Context params
  source?: string;

  // Benchmark params
  label?: string;
  metrics?: string;
  labelB?: string;
}

export async function handleMemory(params: MemoryParams): Promise<string> {
  // Resolve action with default + aliases
  const rawAction = params.action || "session";
  const key = rawAction.toLowerCase().replace(/[\s_-]+/g, "-");
  const action = MEMORY_ALIASES[key] || rawAction;
  sessionMemory.recordToolCall("kuma_memory", { action: rawAction });

  switch (action) {
    case "decision": return handleDecision(params);
    case "mine": return handleMine(params);
    case "research_save": return handleResearchSave(params);
    case "session": return handleSession(params);
    case "heal": return handleHeal(params);
    case "search": return handleSearch(params);
    case "changes": return handleChanges(params);
    case "todo": return handleTodo(params);
    case "context": return handleContext(params);
    case "benchmark": return handleBenchmark(params);
    case "decision_log": return handleDecisionLog(params);
    default: return `Unknown action "${action}".`;
  }
}

// ============================================================
// DECISION — ADR-style recording (trigger-based)
// ============================================================

async function handleDecision(params: MemoryParams): Promise<string> {
  const subAction = params.decisionAction || "template";
  switch (subAction) {
    case "template": return formatDecisionTemplate();
    case "suggest": {
      const { shouldRecordDecision } = await import("../engine/kumaMemory.js");
      const check = shouldRecordDecision();
      return check.worth
        ? `💡 Decision suggested: "${check.title}"\nUse kuma_memory({ action: 'decision', title: '...', context: '...', rationale: '...', outcome: '...' }) to record.`
        : "✅ No decision needed at this time.";
    }
    case "record":
      if (!params.title || !params.rationale) return "⚠️ title and rationale are required.";
      return recordDecision({
        title: params.title,
        context: params.context || "",
        options: [],
        rationale: params.rationale,
        outcome: params.outcome || "implemented",
        timestamp: new Date().toISOString(),
      });
    default: return formatDecisionTemplate();
  }
}

// ============================================================
// RESEARCH_SAVE — Save research to cache + file
// ============================================================

async function handleResearchSave(params: MemoryParams): Promise<string> {
  const scope = params.scope || "project";
  const record = params.record || JSON.stringify({
    scope, confidence: params.confidence || 0.8, notes: params.content || "", validatedAt: new Date().toISOString(),
  });
  await saveResearchCache(scope, record, undefined, params.confidence);
  try {
    const researchDir = path.join(getProjectRoot(), ".kuma", "research");
    if (!fs.existsSync(researchDir)) fs.mkdirSync(researchDir, { recursive: true });
    fs.writeFileSync(path.join(researchDir, `${scope}.json`), JSON.stringify(JSON.parse(record), null, 2), "utf-8");
  } catch {}
  return `✅ Research "${scope}" saved.`;
}

// ============================================================
// SESSION — Session summary
// ============================================================

async function handleSession(params: MemoryParams): Promise<string> {
  const topic = params.topic as any;
  const summary = sessionMemory.getSummary(topic);
  if (topic) return typeof summary.content === "string" ? summary.content : JSON.stringify(summary, null, 2);

  const modifiedFiles = (summary.modifiedFiles as Array<{ filePath: string; status: string }>) || [];
  const failures = (summary.unresolvedFailures as Array<{ task: string; error: string }>) || [];
  const lines: string[] = [
    "📋 **Session Summary**\n━━━━━━━━━━━━━━━━━━━━━━━━━\n",
    `🎯 Goal: ${(summary.currentGoal as string) || "not set"}`,
    `🕐 Duration: ${summary.sessionDuration}`,
    `🛠️ Tool calls: ${summary.toolCallCount}\n`,
  ];
  if (modifiedFiles.length > 0) {
    lines.push(`**Modified Files** (${modifiedFiles.length}):`);
    for (const f of modifiedFiles.slice(0, 10)) {
      lines.push(`  ${f.status === "created" ? "✨" : f.status === "modified" ? "📝" : "❌"} ${f.filePath}`);
    }
    if (modifiedFiles.length > 10) lines.push(`  ... and ${modifiedFiles.length - 10} more`);
    lines.push("");
  }
  if (failures.length > 0) {
    lines.push(`**Unresolved Issues** (${failures.length}):`);
    for (const f of failures.slice(0, 5)) lines.push(`  ❌ ${f.task}: ${f.error.substring(0, 80)}`);
    lines.push("");
  }
  return lines.join("\n");
}

// ============================================================
// HEAL — Self-heal graph
// ============================================================

async function handleHeal(params: MemoryParams): Promise<string> {
  if (params.healAction === "check") {
    const stale = await detectStaleNodes();
    if (stale.length === 0) return "✅ No stale entries found.";
    return `🔍 ${stale.length} stale entr${stale.length > 1 ? "ies" : "y"} found. Use kuma_memory({ action: 'heal' }) to repair.`;
  }
  const result = await autoHeal();
  return formatHealReport(result);
}

// ============================================================
// SEARCH — Search memory + graph
// ============================================================

async function handleSearch(params: MemoryParams): Promise<string> {
  const query = params.query || params.scope;
  if (!query) return "⚠️ query or scope parameter required.";
  const limit = params.limit || 20;
  const memResults = sessionMemory.searchMemory(query, limit);
  const { searchGraph } = await import("../engine/kumaGraph.js");
  const graphResults = await searchGraph(query, Math.min(limit, 10));
  const lines: string[] = [`🔍 **Search Results** — "${query}"\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`];
  if (memResults.length > 0) {
    lines.push(`**Session Memory** (${memResults.length}):`);
    for (const r of memResults.slice(0, 5)) lines.push(`  • ${r.content.substring(0, 120)}`);
    lines.push("");
  }
  lines.push("**Knowledge Graph:**\n" + graphResults);
  return lines.join("\n");
}

// ============================================================
// CHANGES — Change log
// ============================================================

async function handleChanges(params: MemoryParams): Promise<string> {
  const sinceNum = typeof params.since === "number" ? params.since : typeof params.since === "string" ? parseInt(params.since, 10) || undefined : undefined;
  return await getChanges({ filePath: params.target, since: sinceNum });
}

// ============================================================
// TODO — Persistent Todo (Part 2 #6)
// ============================================================

async function handleTodo(params: MemoryParams): Promise<string> {
  // If todoId is provided, update status
  if (params.todoId && params.status) {
    return await updateTodoStatus(params.todoId, params.status);
  }
  // If title is provided, add new todo
  if (params.title) {
    return await addTodo({
      title: params.title,
      description: params.description,
      scope: params.scope,
      deps: params.deps,
      successCriteria: params.success_criteria,
    });
  }
  // Otherwise list todos
  return await listTodos(params.scope, params.status);
}

// ============================================================
// CONTEXT — Injected Context Notes (Part 3 #4)
// ============================================================

async function handleContext(params: MemoryParams): Promise<string> {
  // If content + source provided, add note
  if (params.content && params.source) {
    return await addContextNote({
      source: params.source,
      content: params.content,
      scope: params.scope,
      filePaths: params.target ? JSON.stringify([params.target]) : undefined,
    });
  }
  // Otherwise list notes
  return await listContextNotes(params.scope);
}

// ============================================================
// BENCHMARK — Before/After Benchmarking (Part 3 #6)
// ============================================================

async function handleBenchmark(params: MemoryParams): Promise<string> {
  if (params.label) {
    if (params.metrics) {
      try {
        const metrics = JSON.parse(params.metrics);
        return await saveBenchmark(params.label, metrics);
      } catch {
        return `⚠️ Invalid metrics JSON: "${params.metrics.substring(0, 100)}"`;
      }
    }
    return await getBenchmarkDiff(params.label, params.labelB);
  }
  return "⚠️ label required. Use: kuma_memory({ action: 'benchmark', label: 'phase-3', metrics: '{\"tsc_errors\": 245}' })";
}

// ============================================================
// DECISION_LOG — Living Document (Part 4 #8)
// ============================================================

async function handleDecisionLog(params: MemoryParams): Promise<string> {
  // If status + todoId/params.id provided, update status
  if (params.target && params.status) {
    const id = parseInt(params.target, 10);
    if (!isNaN(id)) return await updateDecisionStatus(id, params.status);
  }
  // If title provided, record new decision
  if (params.title && params.rationale) {
    return await recordDecisionLog({
      title: params.title,
      context: params.context,
      rationale: params.rationale,
      outcome: params.outcome,
      status: params.status,
    });
  }
  // Otherwise list decisions
  return await listDecisionLog(params.status);
}

// ============================================================
// MINE — Decision Mining from Git History & Comments (Proposal 2)
// ============================================================

async function handleMine(params: MemoryParams): Promise<string> {
  sessionMemory.recordToolCall("kuma_memory_mine", { scope: params.scope });
  const { mineHistoricalDecisions } = await import("../engine/kumaMiner.js");
  return await mineHistoricalDecisions({
    scope: params.scope,
    since: typeof params.since === "string" ? params.since : undefined,
    confirm: params.confirm,
    limit: params.limit,
  });
}

