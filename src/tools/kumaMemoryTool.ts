import { sessionMemory } from "../engine/sessionMemory.js";
import { saveResearchCache, getChanges, addTodo, listTodos, updateTodoStatus, addContextNote, listContextNotes, saveBenchmark, getBenchmarkDiff, recordDecisionLog, listDecisionLog, updateDecisionStatus } from "../engine/kumaDb.js";
import { autoHeal, detectStaleNodes, formatHealReport } from "../engine/kumaSelfHeal.js";
import { recordDecision, formatDecisionTemplate } from "../engine/kumaMemory.js";
import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "../utils/pathValidator.js";

type MemoryAction = "decision" | "research_save" | "session" | "heal" | "search" | "changes" | "todo" | "context" | "benchmark" | "decision_log" | "mine" | "domain_rules" | "arch_flow" | "gotcha" | "layers" | "add_node" | "delete_node" | "clear" | "feature";

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
  // Layer 1: Domain Rules (Issue #17)
  "domain_rules": "domain_rules",
  "domain-rules": "domain_rules",
  "domain": "domain_rules",
  "business-rules": "domain_rules",
  // Layer 2: Architecture Flow (Issue #17)
  "arch_flow": "arch_flow",
  "arch-flow": "arch_flow",
  "architecture": "arch_flow",
  "flow-map": "arch_flow",
  // Layer 3: Gotchas (Issue #17 / #21)
  "gotcha": "gotcha",
  "gotchas": "gotcha",
  "known-gotchas": "gotcha",
  "legacy": "gotcha",
  "quirk": "gotcha",
  // Layers summary
  "layers": "layers",
  "3-layer": "layers",
  "memory-layers": "layers",
  // Add node synonyms
  "add-node": "add_node",
  "create-node": "add_node",
  // Feature synonyms
  "feature": "feature",
  "features": "feature",
  "record-feature": "feature",
  "define-feature": "feature",
  "record-node": "add_node",
  // Delete node synonyms
  "delete_node": "delete_node",
  "delete-node": "delete_node",
  "remove-node": "delete_node",
  "delete": "delete_node",
  "remove": "delete_node",
  "destroy": "delete_node",
  // Clear synonyms
  "clear": "clear",
  "clear-graph": "clear",
  "wipe": "clear",
  "reset": "clear",
  "purge-all": "clear",
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

  // Feature params
  tags?: string;

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
    case "domain_rules": return handleLayerAction("domain_rules", params);
    case "arch_flow": return handleLayerAction("arch_flow", params);
    case "gotcha": return handleGotchaAction(params);
    case "layers": return handleLayersSummary(params);
    case "add_node": return handleAddNode(params);
    case "feature": return handleFeature(params);
    case "delete_node": return handleDeleteNode(params);
    case "clear": {
      const { clearGraph } = await import("../engine/kumaGraph.js");
      await clearGraph();
      return "🗑️ **Knowledge Graph Cleared** — All nodes, edges, and gotchas have been wiped from disk and memory.";
    }
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
      if (!params.title) return `❌ **decision format error:** title is required.\n\n✅ Correct: kuma_memory({ action: "decision", decisionAction: "record", title: "Use bcrypt vs argon2", rationale: "bcrypt is battle-tested, argon2 is newer but less adoption", context: "Login system security", outcome: "Chose bcrypt" })`;
      if (!params.rationale) return `❌ **decision format error:** rationale is required.\n\n✅ Correct: kuma_memory({ action: "decision", decisionAction: "record", title: "${params.title}", rationale: "WHY you chose this option", context: "optional context", outcome: "optional outcome" })`;
      const decisionResult = await recordDecision({
        title: params.title,
        context: params.context || "",
        options: [],
        rationale: params.rationale,
        outcome: params.outcome || "implemented",
        timestamp: new Date().toISOString(),
      });
      // Track in session memory
      sessionMemory.recordMemoryAction("decision");
      return decisionResult;
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

  // 🔧 Also create a file + research node so search can find it
  // research_save populates both search cache AND knowledge graph nodes.
  // Agent calls `search` to retrieve — not `visualize`.
  try {
    const { upsertNode, nodeId } = await import("../engine/kumaGraph.js");
    await upsertNode({ id: nodeId("file", scope), type: "file", name: scope });
    // Also record a research node for the research scope so it shows in search
    await upsertNode({
      id: `research::${scope}`,
      type: "research",
      name: `research:${scope}`,
      metadata: { confidence: params.confidence || 0.8 },
    });
  } catch {}

  try {
    const researchDir = path.join(getProjectRoot(), ".kuma", "research");
    if (!fs.existsSync(researchDir)) fs.mkdirSync(researchDir, { recursive: true });
    fs.writeFileSync(path.join(researchDir, `${scope}.json`), JSON.stringify(JSON.parse(record), null, 2), "utf-8");
  } catch {}

  // Track in session memory
  sessionMemory.recordMemoryAction("research_save");

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
  const recordingSummary = sessionMemory.getRecordingSummary();
  const metricsSummary = sessionMemory.getMetricsSummary();
  const lines: string[] = [
    "📋 **Session Summary**\n━━━━━━━━━━━━━━━━━━━━━━━━━\n",
    `🎯 Goal: ${(summary.currentGoal as string) || "not set"}`,
    `🕐 Duration: ${summary.sessionDuration}`,
    `🛠️ Tool calls: ${summary.toolCallCount}\n`,
    `🧠 **Recordings:** ${recordingSummary.total} total — ` +
      `${recordingSummary.archFlows} arch_flow, ` +
      `${recordingSummary.gotchas} gotcha, ` +
      `${recordingSummary.decisions} decision, ` +
      `${recordingSummary.researchSaves} research_save`,
    `📊 **Metrics:** ${metricsSummary.filesRead} files read, ${metricsSummary.filesEdited} files edited`,
    `⏱️ **Time saved:** ~${metricsSummary.researchTimeSavedFormatted} (from research cache)`,
  ];
  if (recordingSummary.missingRecordings.length > 0 && recordingSummary.total === 0) {
    lines.push(`\n⚠️ **No recordings yet!** Missing: ${recordingSummary.missingRecordings.join(", ")}`);
    lines.push(`💡 Tip: Record findings after reading files. arch_flow + gotcha are exponential value.`);
  }
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
  // ISSUE #13: Hybrid search — combines keyword + vector similarity
  const memResults = sessionMemory.searchMemory(query, limit);
  const { searchGraph } = await import("../engine/kumaGraph.js");
  const graphResults = await searchGraph(query, Math.min(limit, 10));

  // Graph-as-retrieval: focused context for task
  let taskContext = "";
  try {
    const { retrieveForTask } = await import("../engine/kumaGraph.js");
    taskContext = await retrieveForTask(query, 10);
  } catch {}

  // Impact analysis: if query matches a node, show what it affects
  let impactAnalysis = "";
  try {
    const { propagateImpact, searchGraph: sg } = await import("../engine/kumaGraph.js");
    const searchRes = await sg(query, 1);
    // Extract node ID from search results if available
    const nodeIdMatch = searchRes.match(/\*\*([^*]+)\*\* \(([^)]+)\)/);
    if (nodeIdMatch) {
      const nodeType = nodeIdMatch[2];
      const nodeName = nodeIdMatch[1];
      const nid = `${nodeType}::${nodeName}`;
      const impacts = await propagateImpact(nid, 3, 0.2);
      if (impacts.length > 0) {
        const impactLines = impacts.slice(0, 5).map(i =>
          `  • ${i.name} (${i.type}) — depth ${i.depth}, weight ${i.weight}`
        );
        impactAnalysis = `\n💥 **Impact Analysis** — ${impacts.length} node(s) affected by "${nodeName}":\n${impactLines.join("\n")}`;
      }
    }
  } catch {}

  // Hybrid semantic search
  let hybridResults = "";
  try {
    const { hybridSearch, formatHybridResults } = await import("../engine/kumaSearch.js");
    const semanticResults = await hybridSearch(query, 8);
    if (semanticResults.length > 0) {
      hybridResults = "\n" + formatHybridResults(query, semanticResults);
    }
  } catch {}

  const lines: string[] = [`🔍 **Search Results** — "${query}"\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`];
  if (memResults.length > 0) {
    lines.push(`**Session Memory** (${memResults.length}):`);
    for (const r of memResults.slice(0, 5)) lines.push(`  • ${r.content.substring(0, 120)}`);
    lines.push("");
  }
  if (taskContext) {
    lines.push(taskContext);
    lines.push("");
  }
  lines.push("**Knowledge Graph:\n" + graphResults);
  if (impactAnalysis) {
    lines.push(impactAnalysis);
  }
  if (hybridResults) {
    lines.push("");
    lines.push(hybridResults);
  }
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

// ============================================================
// LAYER ACTIONS — 3-Layer Memory Engine (Issue #17)
// ============================================================

async function handleLayerAction(layer: "domain_rules" | "arch_flow", params: MemoryParams): Promise<string> {
  const { readLayer, writeLayer } = await import("../engine/domainRules.js");

  if (layer === "arch_flow" && params.content) {
    // ENHANCED: recordDomainFlow - creates interconnected Domain-level graph nodes
    // Format: "domain: <name> | hops: <hop1> → <hop2> → <hop3> | gotchas: <g1>, <g2>"
    // Or plain text: just save to text-based layer (backward compat)
    const content = params.content;

    // Try to detect structured format
    const domainMatch = content.match(/domain\s*[:]\s*([^|\n]+)/i);
    const hopsMatch = content.match(/hops\s*[:]\s*([^|\n]+)/i);
    const gotchasMatch = content.match(/gotchas?\s*[:]\s*([^|\n]+)/i);
    const decisionsMatch = content.match(/decisions?\s*[:]\s*([^|\n]+)/i);
    const filesMatch = content.match(/files?\s*[:]\s*([^|\n]+)/i);

    if (domainMatch) {
      const domain = domainMatch[1].trim();
      const hopsStr = hopsMatch ? hopsMatch[1].trim() : "";
      const gotchasStr = gotchasMatch ? gotchasMatch[1].trim() : "";
      const decisionsStr = decisionsMatch ? decisionsMatch[1].trim() : "";
      const filesStr = filesMatch ? filesMatch[1].trim() : "";

      // VALIDATE: hops must use → separator, not newlines or commas
      if (hopsStr && !content.includes("→")) {
        return `❌ **arch_flow format error:** hops must use → separator.\n\n❌ Wrong: hops: file1.js, file2.js\n❌ Wrong: hops: file1.js\\nfile2.js\n✅ Correct: domain: <name> | hops: file1.js → file2.js → file3.js`;
      }

      const hops = hopsStr ? hopsStr.split("→").map(h => h.trim()).filter(Boolean).map((h, i, arr) => ({
        from: i === 0 ? domain : arr[i - 1],
        to: h,
        relation: "flows",
        description: h,
      })) : [];

      if (hops.length === 0) {
        return `❌ **arch_flow format error:** no hops found after → separator.\n\n✅ Correct: domain: <name> | hops: file1.js → file2.js`;
      }

      const gotchas = gotchasStr ? gotchasStr.split(",").map(g => g.trim()).filter(Boolean) : [];
      const decisions = decisionsStr ? decisionsStr.split(",").map(d => d.trim()).filter(Boolean) : [];
      const filePaths = filesStr ? filesStr.split(",").map(f => f.trim()).filter(Boolean) : [];

      try {
        const { recordDomainFlow } = await import("../engine/kumaGraph.js");
        const flow = await recordDomainFlow({ domain, hops, gotchas, decisions, filePaths });

        // Also save to text-based layer for backward compat
        await writeLayer("arch_flow", content);

        // Track in session memory
        sessionMemory.recordMemoryAction("arch_flow");

        return `✅ Domain flow "${domain}" recorded — ${flow.nodeCount} nodes, ${flow.edgeCount} edges created.\n🏛️ **Domain Anchor:** ${domain}\n🔄 **Hops:** ${hops.length}\n⚠️ **Gotchas:** ${gotchas.length}\n📁 **Files:** ${filePaths.length}`;
      } catch (err) {
        // Fallback to text-only if graph recording fails
        await writeLayer("arch_flow", content);
        return `✅ Architecture flow saved (text only). Graph recording failed: ${err}`;
      }
    }

    // No structured format detected — return error with format guide
    return `❌ **arch_flow format not recognized.** Use this format:\n\ndomain: <DomainName> | hops: <file1.tsx> → <file2.js> → <file3.ts>\n\nFields:\n- domain: short name (e.g. InviteUserFlow)\n- hops: file names separated by → (NOT commas, NOT newlines)\n- gotchas: optional, comma-separated\n- decisions: optional, comma-separated`;
  }

  // domain_rules or reading arch_flow
  if (params.content) {
    return writeLayer(layer, params.content);
  }
  return readLayer(layer);
}

// ============================================================
// GOTCHA ACTION — Anti-Regression Shield (Issue #21)
// ============================================================

async function handleGotchaAction(params: MemoryParams): Promise<string> {
  // If adding a new gotcha
  if (params.content && params.scope) {
    // VALIDATE: scope must be a file path, content must be non-empty
    if (!params.scope.trim()) {
      return `❌ **gotcha format error:** scope (file path) is required.\n\n✅ Correct: kuma_memory({ action: "gotcha", scope: "path/to/file.ts", content: "bug description", status: "high" })`;
    }
    if (!params.content.trim()) {
      return `❌ **gotcha format error:** content (description) is required.\n\n✅ Correct: kuma_memory({ action: "gotcha", scope: "path/to/file.ts", content: "bug description", status: "high" })`;
    }

    const { addGotcha } = await import("../engine/kumaGotchas.js");
    const result = await addGotcha({
      filePath: params.scope,
      description: params.content,
      severity: (params.status as "low" | "medium" | "high" | "critical") || "medium",
      workaround: params.description,
    });

    // Track in session memory
    sessionMemory.recordMemoryAction("gotcha");

    return result;
  }

  // If listing gotchas (optionally filtered by filePath)
  const { listGotchas, syncGotchasToDb } = await import("../engine/kumaGotchas.js");
  await syncGotchasToDb();
  return await listGotchas({
    filePath: params.scope,
    severity: params.status,
  });
}

// ============================================================
// DELETE NODE — Remove specific nodes/gotchas/todos/decisions
// ============================================================

async function handleDeleteNode(params: MemoryParams): Promise<string> {
  sessionMemory.recordToolCall("kuma_memory_delete", { scope: params.scope, target: params.target });

  const { getDb, saveDb } = await import("../engine/kumaDb.js");
  const db = await getDb();

  // Pattern 1: scope + target (delete a specific record by scope + ID)
  if (params.scope && params.target) {
    const id = parseInt(params.target, 10);
    if (isNaN(id)) return `⚠️ target "${params.target}" is not a valid numeric ID.`;

    switch (params.scope) {
      case "gotcha":
      case "gotchas": {
        db.run("DELETE FROM known_gotchas WHERE id = ?", [id]);
        saveDb(db);
        return `🗑️ **Gotcha #${id} deleted.**`;
      }
      case "todo":
      case "todos": {
        db.run("DELETE FROM todos WHERE id = ?", [id]);
        saveDb(db);
        return `🗑️ **Todo #${id} deleted.**`;
      }
      case "decision":
      case "decision_log":
      case "decisions": {
        db.run("DELETE FROM decision_log WHERE id = ?", [id]);
        saveDb(db);
        return `🗑️ **Decision #${id} deleted.**`;
      }
      case "checkpoint": {
        db.run("DELETE FROM health_snapshots WHERE id = ?", [id]);
        saveDb(db);
        return `🗑️ **Checkpoint #${id} deleted.**`;
      }
      default:
        return `⚠️ Unknown scope "${params.scope}". Supported: gotcha, todo, decision, checkpoint`;
    }
  }

  // Pattern 2: target is a graph node ID (e.g. "function::sendMessage" or "feature_domain::omnichannel-conversation-flow")
  if (params.target) {
    const { flushDb } = await import("../engine/kumaDb.js");

    if (params.target.includes("::") || params.target.includes(":") || params.target.includes("-")) {
      try {
        const targetId = params.target;
        const domainName = targetId.startsWith("feature_domain::") ? targetId.replace("feature_domain::", "") : targetId;

        // Cascade delete if deleting a feature_domain
        if (targetId.startsWith("feature_domain::")) {
          db.run("DELETE FROM nodes WHERE id LIKE ? OR id LIKE ? OR id LIKE ?", [
            `feature_domain::${domainName}`,
            `cross_service_link::${domainName}::%`,
            `gotcha::${domainName}::%`,
          ]);
          db.run("DELETE FROM edges WHERE source_id LIKE ? OR target_id LIKE ?", [`%${domainName}%`, `%${domainName}%`]);
        } else {
          db.run("DELETE FROM edges WHERE source_id = ? OR target_id = ?", [targetId, targetId]);
          db.run("DELETE FROM nodes WHERE id = ?", [targetId]);
        }

        flushDb(db);
        return `🗑️ **Node & relations deleted instantly from RAM and Disk:** ${params.target}`;
      } catch (err) {
        return `❌ Failed to delete node: ${err}`;
      }
    }

    // Try as numeric ID
    const id = parseInt(params.target, 10);
    if (!isNaN(id)) {
      db.run("DELETE FROM nodes WHERE rowid = ?", [id]);
      flushDb(db);
      return `🗑️ **Node #${id} deleted.**`;
    }
  }

  return "⚠️ Provide `target` (node ID) to delete, or `scope` + `target` (numeric ID) for gotcha/todo/decision/checkpoint.\n\nExamples:\n- `delete_node`, target: 'function::sendMessage'\n- `delete_node`, scope: 'gotcha', target: '42'\n- `delete_node`, scope: 'todo', target: '7'\n- `delete_node`, scope: 'decision', target: '3'\n- `delete_node`, scope: 'checkpoint', target: '1'";
}

// ============================================================
// ADD NODE — Manual Structural Node Creation
// ============================================================

async function handleAddNode(params: MemoryParams): Promise<string> {
  const type = params.title as "function" | "class" | "component" | "file" | "api_route" | "test";
  const name = params.content;
  const filePath = params.scope;

  if (!type || !name) {
    return "⚠️ `title` (node type: function/class/component/file/api_route/test) and `content` (node name) required.\nExample: kuma_memory({ action: 'add_node', title: 'function', content: 'sendMessage', scope: 'ChatService.ts' })";
  }

  const validTypes = ["function", "class", "component", "file", "api_route", "test"];
  if (!validTypes.includes(type)) {
    return `⚠️ Invalid type "${type}". Valid types: ${validTypes.join(", ")}`;
  }

  try {
    const { upsertNode, nodeId, addEdge } = await import("../engine/kumaGraph.js");
    const nodeIdStr = filePath ? `${type}::${filePath}::${name}` : nodeId(type, name);
    
    await upsertNode({
      id: nodeIdStr,
      type: type as any,
      name,
      filePath,
    });

    // If filePath provided, also create contains edge
    if (filePath) {
      const fileNodeId = nodeId("file", filePath);
      await upsertNode({ id: fileNodeId, type: "file", name: filePath });
      try { await addEdge({ sourceId: fileNodeId, targetId: nodeIdStr, type: "contains" }); } catch {}
    }

    return `✅ Node created: **${name}** (${type})${filePath ? ` — ${filePath}` : ""}`;
  } catch (err) {
    return `❌ Failed to create node: ${err}`;
  }
}

// ============================================================
// FEATURE — Record high-level feature with owns edges
// ============================================================

async function handleFeature(params: MemoryParams): Promise<string> {
  sessionMemory.recordToolCall("kuma_memory_feature", { title: params.title, scope: params.scope });

  if (!params.title) {
    return "⚠️ `title` (feature name) required.\n\n✅ Correct: kuma_memory({ action: 'feature', title: 'Authentication', content: 'description', scope: 'src/auth/login.ts,src/auth/session.ts' })\n\n• title = feature name (e.g. 'Authentication', 'Billing')\n• content = description (optional)\n• scope = comma-separated file paths (optional)\n• tags = comma-separated tags (optional)\n• status = risk level: low/medium/high/critical (optional)";
  }

  const { recordFeature } = await import("../engine/kumaGraph.js");
  const files = params.scope ? params.scope.split(",").map(f => f.trim()).filter(Boolean) : [];
  const tags = params.tags ? params.tags.split(",").map((t: string) => t.trim()).filter(Boolean) : [];
  const risk = (params.status as "low" | "medium" | "high" | "critical") || "medium";

  const result = await recordFeature({
    name: params.title,
    description: params.content,
    files,
    tags,
    risk,
  });

  sessionMemory.recordMemoryAction("research_save");

  return `✅ **Feature "${params.title}" recorded** — ${result.nodeCount} node(s), ${result.edgeCount} edge(s)\n⭐ Level: feature\n📁 Files: ${files.length}\n🏷️ Tags: ${tags.length}\n⚠️ Risk: ${risk}`;
}

// ============================================================
// LAYERS SUMMARY — Show all 3 layers status
// ============================================================

async function handleLayersSummary(_params: MemoryParams): Promise<string> {
  const { getLayersSummary } = await import("../engine/domainRules.js");
  return getLayersSummary();
}
