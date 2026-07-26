import { sessionMemory } from "../engine/sessionMemory.js";
import { saveResearchCache, listResearchScopes } from "../engine/kumaDb.js";
import { autoHeal, detectStaleNodes, formatHealReport } from "../engine/kumaSelfHeal.js";
import { recordDecision, formatDecisionTemplate, getProactiveMemories } from "../engine/kumaMemory.js";
import { getChanges } from "../engine/kumaDb.js";
import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "../utils/pathValidator.js";

type MemoryAction = "decision" | "research_save" | "session" | "heal" | "search" | "changes";

interface MemoryParams {
  action: MemoryAction;
  scope?: string;
  query?: string;
  content?: string;
  record?: string;
  confidence?: number;

  decisionAction?: "template" | "suggest" | "record";
  title?: string;
  context?: string;
  rationale?: string;
  outcome?: string;
  healAction?: "check" | "heal";
  topic?: string;
  goal?: string;
  limit?: number;
  since?: number;
  target?: string;
}

export async function handleMemory(params: MemoryParams): Promise<string> {
  const { action } = params;
  sessionMemory.recordToolCall("kuma_memory", { action });

  switch (action) {
    case "decision": return handleDecision(params);
    case "research_save": return handleResearchSave(params);
    case "session": return handleSession(params);
    case "heal": return handleHeal(params);
    case "search": return handleSearch(params);
    case "changes": return handleChanges(params);
    default: return `Unknown action "${action}". Use: decision, research_save, session, heal, search, changes`;
  }
}

// ============================================================
// DECISION — ADR-style recording (trigger-based)
// ============================================================

async function handleDecision(params: MemoryParams): Promise<string> {
  const subAction = params.decisionAction || "template";

  switch (subAction) {
    case "template":
      return formatDecisionTemplate();

    case "suggest": {
      const { shouldRecordDecision } = await import("../engine/kumaMemory.js");
      const check = shouldRecordDecision();
      return check.worth
        ? `💡 Decision suggested: "${check.title}"\nUse kuma_memory({ action: 'decision', title: '...', context: '...', rationale: '...', outcome: '...' }) to record.`
        : "✅ No decision needed at this time.";
    }

    case "record":
      if (!params.title || !params.rationale) {
        return "⚠️ title and rationale are required. Optionally: context, outcome.";
      }
      return recordDecision({
        title: params.title,
        context: params.context || "",
        options: [],
        rationale: params.rationale,
        outcome: params.outcome || "implemented",
        timestamp: new Date().toISOString(),
      });

    default:
      return formatDecisionTemplate();
  }
}

// ============================================================
// RESEARCH_SAVE — Save research to cache + file
// ============================================================

async function handleResearchSave(params: MemoryParams): Promise<string> {
  const scope = params.scope || "project";
  const record = params.record || JSON.stringify({
    scope,
    confidence: params.confidence || 0.8,
    notes: params.content || "",
    validatedAt: new Date().toISOString(),
  });

  await saveResearchCache(scope, record, undefined, params.confidence);

  // Also save to .kuma/research/{scope}.json
  try {
    const researchDir = path.join(getProjectRoot(), ".kuma", "research");
    if (!fs.existsSync(researchDir)) {
      fs.mkdirSync(researchDir, { recursive: true });
    }
    fs.writeFileSync(
      path.join(researchDir, `${scope}.json`),
      JSON.stringify(JSON.parse(record), null, 2),
      "utf-8"
    );
  } catch {}

  return `✅ Research "${scope}" saved to cache and .kuma/research/${scope}.json`;
}

// ============================================================
// SESSION — Session summary
// ============================================================

async function handleSession(params: MemoryParams): Promise<string> {
  const topic = params.topic as any;
  const summary = sessionMemory.getSummary(topic);

  if (topic) {
    return typeof summary.content === "string" ? summary.content : JSON.stringify(summary, null, 2);
  }

  const modifiedFiles = (summary.modifiedFiles as Array<{ filePath: string; status: string }>) || [];
  const failures = (summary.unresolvedFailures as Array<{ task: string; error: string }>) || [];

  const lines: string[] = [
    "📋 **Session Summary**",
    `━━━━━━━━━━━━━━━━━━━━━━━━━`,
    "",
    `🎯 Goal: ${(summary.currentGoal as string) || "not set"}`,
    `🕐 Duration: ${summary.sessionDuration}`,
    `🛠️ Tool calls: ${summary.toolCallCount}`,
    "",
  ];

  if (modifiedFiles.length > 0) {
    lines.push(`**Modified Files** (${modifiedFiles.length}):`);
    for (const f of modifiedFiles.slice(0, 10)) {
      const icon = f.status === "created" ? "✨" : f.status === "modified" ? "📝" : "❌";
      lines.push(`  ${icon} ${f.filePath}`);
    }
    if (modifiedFiles.length > 10) {
      lines.push(`  ... and ${modifiedFiles.length - 10} more`);
    }
    lines.push("");
  }

  if (failures.length > 0) {
    lines.push(`**Unresolved Issues** (${failures.length}):`);
    for (const f of failures.slice(0, 5)) {
      lines.push(`  ❌ ${f.task}: ${f.error.substring(0, 80)}`);
    }
    lines.push("");
  }

  const completed = (summary.completedSteps as string[]) || [];
  if (completed.length > 0) {
    lines.push(`**Completed Steps**:`);
    for (const s of completed) {
      lines.push(`  ✅ ${s}`);
    }
    lines.push("");
  }

  lines.push("💡 Use kuma_memory({ action: 'decision', decisionAction: 'record', ... }) to document decisions.");

  return lines.join("\n");
}

// ============================================================
// HEAL — Self-heal graph
// ============================================================

async function handleHeal(params: MemoryParams): Promise<string> {
  if (params.healAction === "check") {
    const stale = await detectStaleNodes();
    if (stale.length === 0) return "✅ No stale entries found in knowledge graph.";
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

  // Search session memory
  const memResults = sessionMemory.searchMemory(query, limit);

  // Also search graph
  const { searchGraph } = await import("../engine/kumaGraph.js");
  const graphResults = await searchGraph(query, Math.min(limit, 10));

  const lines: string[] = [
    `🔍 **Search Results** — "${query}"`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    "",
  ];

  if (memResults.length > 0) {
    lines.push(`**Session Memory** (${memResults.length}):`);
    for (const r of memResults.slice(0, 5)) {
      lines.push(`  • ${r.content.substring(0, 120)}`);
    }
    lines.push("");
  }

  lines.push("**Knowledge Graph:**");
  lines.push(graphResults);

  if (memResults.length === 0 && graphResults.includes("No results")) {
    lines.push("", "💡 No results found. Try a different query or research the topic first.");
  }

  return lines.join("\n");
}

// ============================================================
// CHANGES — Change log (selective undo support)
// ============================================================

async function handleChanges(params: MemoryParams): Promise<string> {
  const filePath = params.target;
  const since = params.since;
  return await getChanges({ filePath, since });
}
