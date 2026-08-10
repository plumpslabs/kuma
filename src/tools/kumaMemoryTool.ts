import { sessionMemory } from "../engine/sessionMemory.js";
import { saveResearchCache } from "../engine/kumaDb.js";
import { recordDecision } from "../engine/kumaMemory.js";
import { normalizeScope } from "../utils/pathValidator.js";
import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "../utils/pathValidator.js";

type MemoryAction = "decision" | "research_save" | "arch_flow" | "gotcha" | "search";

const MEMORY_ALIASES: Record<string, string> = {
  "decision": "decision", "adr": "decision",
  "research_save": "research_save", "save": "research_save", "store": "research_save",
  "search": "search", "find": "search", "query": "search", "lookup": "search",
  "arch_flow": "arch_flow", "arch-flow": "arch_flow", "architecture": "arch_flow",
  "gotcha": "gotcha", "gotchas": "gotcha", "quirk": "gotcha",
};

interface MemoryParams {
  action?: MemoryAction;
  scope?: string;
  query?: string;
  content?: string;
  record?: string;
  confidence?: number;
  title?: string;
  context?: string;
  rationale?: string;
  outcome?: string;
  limit?: number;
  description?: string;
  status?: string;
  trigger_command?: string;
}

export async function handleMemory(params: MemoryParams): Promise<string> {
  const rawAction = params.action || "search";
  const key = rawAction.toLowerCase().replace(/[\s_-]+/g, "-");
  const action = MEMORY_ALIASES[key] || rawAction;
  sessionMemory.recordToolCall("kuma_memory", { action: rawAction });

  switch (action) {
    case "decision": return handleDecision(params);
    case "research_save": return handleResearchSave(params);
    case "search": return handleSearch(params);
    case "arch_flow": return handleArchFlow(params);
    case "gotcha": return handleGotchaAction(params);
    default: return `Unknown action "${action}". Use: gotcha, decision, arch_flow, research_save, search`;
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
// ARCH_FLOW — Domain Flow Recording
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
  // Back-compat: V2-era calls used `description` (or a `title`) for the bug text
  // while V3 writes use `content`. Accept either so a correct write never
  // silently falls through to a read-only listing (the gotcha would be lost).
  const content = (params.content ?? params.description ?? "").trim();
  const scope = (params.scope ?? "").trim();

  if (content && scope) {
    const normalizedScope = normalizeScope(scope) || scope;
    const { addGotcha } = await import("../engine/kumaGotchas.js");
    const result = await addGotcha({
      filePath: normalizedScope,
      description: content,
      severity: (params.status as "low" | "medium" | "high" | "critical") || "medium",
      // `description` doubles as workaround only when the canonical `content` field was used.
      workaround: params.content ? params.description : undefined,
      triggerCommand: params.trigger_command,
    });
    sessionMemory.recordMemoryAction("gotcha");
    return result;
  }

  // Write-intent detected but incomplete -> fail loud with the exact format,
  // instead of silently returning a misleading "no gotchas recorded" listing.
  if (scope || params.title || params.status || params.trigger_command || params.description) {
    return (
      "❌ **Gotcha NOT saved** — missing `content` (bug description).\n" +
      "✅ Use: kuma_memory({ action: \"gotcha\", scope: \"<file_path>\", content: \"<what went wrong>\", status: \"high\" })\n" +
      "- `scope` — file path where the bug was found\n" +
      "- `content` — bug description (required to save)\n" +
      "- `status` — low | medium | high | critical"
    );
  }

  // No write intent at all -> read-only listing.
  const { listGotchas, syncGotchasToDb } = await import("../engine/kumaGotchas.js");
  await syncGotchasToDb();
  return await listGotchas({ filePath: params.scope, severity: params.status });
}
