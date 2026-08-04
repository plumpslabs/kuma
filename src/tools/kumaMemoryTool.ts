import { sessionMemory } from "../engine/sessionMemory.js";
import { saveResearchCache, getChanges } from "../engine/kumaDb.js";
import { recordDecision } from "../engine/kumaMemory.js";
import { normalizeScope } from "../utils/pathValidator.js";
import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "../utils/pathValidator.js";

type MemoryAction = "decision" | "research_save" | "session" | "search" | "changes" | "mine" | "arch_flow" | "gotcha" | "delete_node" | "clear" | "goal_progress";

const MEMORY_ALIASES: Record<string, string> = {
  "session": "session", "summary": "session", "status": "session", "get": "session",
  "decision": "decision", "adr": "decision",
  "research_save": "research_save", "save": "research_save", "store": "research_save",
  "mine": "mine", "dig": "mine",
  "search": "search", "find": "search", "query": "search", "lookup": "search",
  "changes": "changes", "change-log": "changes", "history": "changes",
  "arch_flow": "arch_flow", "arch-flow": "arch_flow", "architecture": "arch_flow",
  "gotcha": "gotcha", "gotchas": "gotcha", "quirk": "gotcha",
  "delete_node": "delete_node", "delete-node": "delete_node", "remove-node": "delete_node",
  "clear": "clear", "clear-graph": "clear", "wipe": "clear", "reset": "clear",
  "goal_progress": "goal_progress", "progress": "goal_progress",
};

interface MemoryParams {
  action?: MemoryAction;
  scope?: string;
  query?: string;
  content?: string;
  record?: string;
  confidence?: number;
  confirm?: boolean;
  title?: string;
  context?: string;
  rationale?: string;
  outcome?: string;
  topic?: string;
  limit?: number;
  since?: number | string;
  target?: string;
  description?: string;
  status?: string;
  trigger_command?: string;
}

export async function handleMemory(params: MemoryParams): Promise<string> {
  const rawAction = params.action || "session";
  const key = rawAction.toLowerCase().replace(/[\s_-]+/g, "-");
  const action = MEMORY_ALIASES[key] || rawAction;
  sessionMemory.recordToolCall("kuma_memory", { action: rawAction });

  switch (action) {
    case "decision": return handleDecision(params);
    case "mine": return handleMine(params);
    case "research_save": return handleResearchSave(params);
    case "session": return handleSession(params);
    case "search": return handleSearch(params);
    case "changes": return handleChanges(params);
    case "arch_flow": return handleArchFlow(params);
    case "gotcha": return handleGotchaAction(params);
    case "goal_progress": return handleGoalProgress(params);
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
// DECISION — ADR-style recording
// ============================================================

async function handleDecision(params: MemoryParams): Promise<string> {
  if (!params.title) return "⚠️ `title` is required. Use: kuma_memory({ action: 'decision', title: '...', rationale: '...' })";
  if (!params.rationale) return "⚠️ `rationale` is required. Why did you choose this option?";
  const result = await recordDecision({
    title: params.title,
    context: params.context || "",
    options: [],
    rationale: params.rationale,
    outcome: params.outcome || "implemented",
    timestamp: new Date().toISOString(),
  });
  sessionMemory.recordMemoryAction("decision");
  return result;
}

// ============================================================
// RESEARCH_SAVE — Save research to cache + file
// ============================================================

async function handleResearchSave(params: MemoryParams): Promise<string> {
  const rawScope = params.scope || "project";
  const scope = normalizeScope(rawScope) || rawScope;
  const record = params.record || JSON.stringify({
    scope, confidence: params.confidence || 0.8, notes: params.content || "", validatedAt: new Date().toISOString(),
  });
  await saveResearchCache(scope, record, undefined, params.confidence);

  try {
    const { getDb, flushDb } = await import("../engine/kumaDb.js");
    const db = await getDb();
    const researchId = `research::${scope}`;
    const now = Math.floor(Date.now() / 1000);
    const looksLikeFile = scope.includes("/") || /\.[\w]{1,5}$/.test(scope);
    if (looksLikeFile) {
      const fileId = `file::${scope}`;
      db.run(`INSERT INTO nodes (id, type, name, file_path, metadata, updated_at) VALUES (?, 'file', ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET metadata = json_patch(COALESCE(nodes.metadata, '{}'), excluded.metadata), updated_at = excluded.updated_at`, [fileId, scope, scope, JSON.stringify({ findings: [params.content || ""], confidence: params.confidence || 0.8 }), now]);
      db.run(`INSERT OR IGNORE INTO edges (source_id, target_id, type, weight, metadata, created_at) VALUES (?, ?, 'contains', 1.0, '{}', ?)`, [fileId, researchId, now]);
    }
    db.run(`INSERT INTO nodes (id, type, name, file_path, metadata, updated_at) VALUES (?, 'research', ?, null, ?, ?) ON CONFLICT(id) DO UPDATE SET metadata = json_patch(COALESCE(nodes.metadata, '{}'), excluded.metadata), updated_at = excluded.updated_at`, [researchId, `research:${scope}`, JSON.stringify({ confidence: params.confidence || 0.8, last_findings: params.content || "" }), now]);
    flushDb(db);
    try { const { rebuildFtsIndex } = await import("../engine/kumaDb.js"); rebuildFtsIndex(); } catch {}
  } catch {}

  try {
    const researchDir = path.join(getProjectRoot(), ".kuma", "research");
    if (!fs.existsSync(researchDir)) fs.mkdirSync(researchDir, { recursive: true });
    fs.writeFileSync(path.join(researchDir, `${scope}.json`), JSON.stringify(JSON.parse(record), null, 2), "utf-8");
  } catch {}

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
      `${recordingSummary.archFlows} arch_flow, ${recordingSummary.gotchas} gotcha, ${recordingSummary.decisions} decision, ${recordingSummary.researchSaves} research_save`,
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
  }
  if (failures.length > 0) {
    lines.push(`**Unresolved Issues** (${failures.length}):`);
    for (const f of failures.slice(0, 5)) lines.push(`  ❌ ${f.task}: ${f.error.substring(0, 80)}`);
  }
  return lines.join("\n");
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

  let taskContext = "";
  try {
    const { retrieveForTask } = await import("../engine/kumaGraph.js");
    taskContext = await retrieveForTask(query, 10);
  } catch {}

  let impactAnalysis = "";
  try {
    const { propagateImpact, searchGraph: sg } = await import("../engine/kumaGraph.js");
    const searchRes = await sg(query, 1);
    const nodeIdMatch = searchRes.match(/\*\*([^*]+)\*\* \(([^)]+)\)/);
    if (nodeIdMatch) {
      const nodeType = nodeIdMatch[2];
      const nodeName = nodeIdMatch[1];
      const nid = `${nodeType}::${nodeName}`;
      const impacts = await propagateImpact(nid, 3, 0.2);
      if (impacts.length > 0) {
        const impactLines = impacts.slice(0, 5).map(i => `  • ${i.name} (${i.type}) — depth ${i.depth}, weight ${i.weight}`);
        impactAnalysis = `\n💥 **Impact Analysis** — ${impacts.length} node(s) affected by "${nodeName}":\n${impactLines.join("\n")}`;
      }
    }
  } catch {}

  let hybridResults = "";
  try {
    const { enhancedHybridSearch, formatHybridResults } = await import("../engine/kumaSearch.js");
    const semanticResults = await enhancedHybridSearch(query, 8);
    if (semanticResults.length > 0) hybridResults = "\n" + formatHybridResults(query, semanticResults);
  } catch {}

  const lines: string[] = [`🔍 **Search Results** — "${query}"\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`];
  if (memResults.length > 0) {
    lines.push(`**Session Memory** (${memResults.length}):`);
    for (const r of memResults.slice(0, 5)) lines.push(`  • ${r.content.substring(0, 120)}`);
    lines.push("");
  }
  if (taskContext) { lines.push(taskContext); lines.push(""); }
  lines.push("**Knowledge Graph:\n" + graphResults);
  if (impactAnalysis) lines.push(impactAnalysis);
  if (hybridResults) { lines.push(""); lines.push(hybridResults); }
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
// MINE — Decision Mining from Git History
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
// ARCH_FLOW — 3-Layer Memory Engine (Issue #17)
// ============================================================

async function handleArchFlow(params: MemoryParams): Promise<string> {
  const { readLayer, writeLayer } = await import("../engine/domainRules.js");

  if (params.content) {
    const content = params.content;
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

      if (hopsStr && !content.includes("→")) {
        return "❌ **arch_flow format error:** hops must use → separator.\n\n✅ Correct: domain: <name> | hops: file1.js → file2.js → file3.js";
      }

      const rawHops = hopsStr ? hopsStr.split("→").map(h => h.trim()).filter(Boolean) : [];
      const coreHops = rawHops.filter(file => {
        if (file.endsWith(".tsx") || file.endsWith(".jsx")) return false;
        if (file.includes("Controller")) return false;
        if (file.includes("Schema")) return false;
        return true;
      }).slice(0, 5);

      const hops = coreHops.map((h, i, arr) => ({
        from: i === 0 ? domain : arr[i - 1],
        to: h, relation: "flows", description: h,
      }));

      if (hops.length === 0) {
        return "❌ **arch_flow format error:** no hops found after → separator.\n\n✅ Correct: domain: <name> | hops: file1.js → file2.js";
      }

      const gotchas = gotchasStr ? gotchasStr.split(",").map(g => g.trim()).filter(Boolean) : [];
      const decisions = decisionsStr ? decisionsStr.split(",").map(d => d.trim()).filter(Boolean) : [];
      const filePaths = filesMatch ? filesMatch[1].trim().split(",").map(f => f.trim()).filter(Boolean) : [];

      try {
        const { recordDomainFlow } = await import("../engine/kumaGraph.js");
        const flow = await recordDomainFlow({ domain, hops, gotchas, decisions, filePaths });
        await writeLayer("arch_flow", content);
        sessionMemory.recordMemoryAction("arch_flow");
        return `✅ Domain flow "${domain}" recorded — ${flow.nodeCount} nodes, ${flow.edgeCount} edges created.\n🏛️ **Domain Anchor:** ${domain}\n🔄 **Hops:** ${hops.length}\n⚠️ **Gotchas:** ${gotchas.length}`;
      } catch (err) {
        await writeLayer("arch_flow", content);
        return `✅ Architecture flow saved (text only). Graph recording failed: ${err}`;
      }
    }
    return "❌ **arch_flow format not recognized.** Use format:\n\ndomain: <DomainName> | hops: <file1.ts> → <file2.js> → <file3.ts>";
  }
  return readLayer("arch_flow");
}

// ============================================================
// GOTCHA ACTION — Anti-Regression Shield (Issue #21)
// ============================================================

async function handleGotchaAction(params: MemoryParams): Promise<string> {
  if (params.content && params.scope) {
    if (!params.scope.trim()) return "❌ **gotcha format error:** scope (file path) is required.";
    if (!params.content.trim()) return "❌ **gotcha format error:** content (description) is required.";
    const normalizedScope = normalizeScope(params.scope) || params.scope;
    const { addGotcha } = await import("../engine/kumaGotchas.js");
    const result = await addGotcha({
      filePath: normalizedScope,
      description: params.content,
      severity: (params.status as "low" | "medium" | "high" | "critical") || "medium",
      workaround: params.description,
      triggerCommand: params.trigger_command,
    });
    sessionMemory.recordMemoryAction("gotcha");
    return result;
  }
  const { listGotchas, syncGotchasToDb } = await import("../engine/kumaGotchas.js");
  await syncGotchasToDb();
  return await listGotchas({ filePath: params.scope, severity: params.status });
}

// ============================================================
// DELETE NODE — Remove specific nodes/gotchas/decisions
// ============================================================

async function handleDeleteNode(params: MemoryParams): Promise<string> {
  sessionMemory.recordToolCall("kuma_memory_delete", { scope: params.scope, target: params.target });
  const { getDb, saveDb } = await import("../engine/kumaDb.js");
  const db = await getDb();

  if (params.scope && params.target) {
    const id = parseInt(params.target, 10);
    if (isNaN(id)) return `⚠️ target "${params.target}" is not a valid numeric ID.`;
    switch (params.scope) {
      case "gotcha":
      case "gotchas": {
        const gotchaRow = db.prepare("SELECT file_path, description FROM known_gotchas WHERE id = ?");
        gotchaRow.bind([id]);
        let gotchaFilePath = "", gotchaDesc = "";
        if (gotchaRow.step()) {
          const row = gotchaRow.getAsObject() as { file_path: string; description: string };
          gotchaFilePath = row.file_path; gotchaDesc = row.description;
        }
        gotchaRow.free();
        db.run("DELETE FROM known_gotchas WHERE id = ?", [id]);
        if (gotchaFilePath && gotchaDesc) {
          const gotchaNodeId = `gotcha::${gotchaFilePath}::${gotchaDesc.substring(0, 30)}`;
          db.run("DELETE FROM edges WHERE source_id = ? OR target_id = ?", [gotchaNodeId, gotchaNodeId]);
          db.run("DELETE FROM nodes WHERE id = ?", [gotchaNodeId]);
        }
        saveDb(db);
        return `🗑️ **Gotcha #${id} deleted** (table + graph).`;
      }
      default:
        return `⚠️ Unknown scope "${params.scope}". Supported: gotcha`;
    }
  }

  if (params.target || params.scope) {
    const { flushDb } = await import("../engine/kumaDb.js");
    const targetStr = params.target || "";
    const targetId = params.scope && !targetStr.includes("::") ? `${targetStr}::${params.scope}` : targetStr;
    if (targetId && (targetId.includes("::") || targetId.includes(":") || targetId.includes("-") || isNaN(parseInt(targetId, 10)))) {
      try {
        if (targetId.startsWith("feature_domain::")) {
          const domainName = targetId.replace("feature_domain::", "");
          db.run("DELETE FROM nodes WHERE id LIKE ? OR id LIKE ? OR id LIKE ?", [`feature_domain::${domainName}`, `cross_service_link::${domainName}::%`, `gotcha::${domainName}::%`]);
          db.run("DELETE FROM edges WHERE source_id LIKE ? OR target_id LIKE ?", [`%${domainName}%`, `%${domainName}%`]);
        } else if (targetId.startsWith("gotcha::")) {
          db.run("DELETE FROM edges WHERE source_id = ? OR target_id = ?", [targetId, targetId]);
          db.run("DELETE FROM nodes WHERE id = ?", [targetId]);
          const parts = targetId.split("::");
          if (parts.length >= 3) {
            db.run("DELETE FROM known_gotchas WHERE file_path = ? AND description LIKE ?", [parts[1], `${parts.slice(2).join("::")}%`]);
          }
        } else {
          db.run("DELETE FROM edges WHERE source_id = ? OR target_id = ?", [targetId, targetId]);
          db.run("DELETE FROM nodes WHERE id = ?", [targetId]);
        }
        flushDb(db);
        return `🗑️ **Node & relations deleted:** ${targetId}`;
      } catch (err) { return `❌ Failed to delete node: ${err}`; }
    }
    const id = parseInt(targetId, 10);
    if (!isNaN(id)) { db.run("DELETE FROM nodes WHERE rowid = ?", [id]); flushDb(db); return `🗑️ **Node #${id} deleted.**`; }
  }
  return "⚠️ Provide `target` (node ID) to delete.\n\nExamples:\n- `delete_node`, target: 'function::sendMessage'\n- `delete_node`, scope: 'gotcha', target: '42'";
}

// ============================================================
// GOAL PROGRESS — Track goal completion
// ============================================================

async function handleGoalProgress(params: MemoryParams): Promise<string> {
  const pct = params.confidence ?? 0;
  const ms = params.content || params.title;
  sessionMemory.setGoalProgress(pct, ms);
  const p = sessionMemory.getGoalProgress();
  if (!p) return "Error";
  const bar = "█".repeat(Math.floor(p.percentage / 10)) + "░".repeat(10 - Math.floor(p.percentage / 10));
  return `📊 ${bar} ${p.percentage}%${p.milestone ? " — " + p.milestone : ""}`;
}