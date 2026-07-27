// ============================================================
// KUMA MEMORY — Long-term Memory (3.1) + Decision Memory (3.2)
// ============================================================
// Manages persistent memories across sessions.
// Auto-tags errors to memory files, scores relevance,
// suggests decision recording, and injects proactive context.
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { sessionMemory } from "./sessionMemory.js";
import { getProjectRoot } from "../utils/pathValidator.js";

interface ScoredMemory {
  topic: string;
  content: string;
  score: number; // 0-100 relevance
  reason: string;
}

interface DecisionRecord {
  title: string;
  context: string;
  options: string[];
  rationale: string;
  outcome: string;
  timestamp: string;
}

const MEMORY_DIR = ".kuma/memories";

/**
 * Score memories for relevance to a given context.
 * Returns memories sorted by relevance score.
 */
export function scoreMemoryRelevance(
  context: string,
  limit: number = 5
): ScoredMemory[] {
  const results: ScoredMemory[] = [];
  const kumaDir = path.join(getProjectRoot(), MEMORY_DIR);

  if (!fs.existsSync(kumaDir)) return [];

  const terms = context.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  if (terms.length === 0) return [];

  try {
    const files = fs.readdirSync(kumaDir).filter(f => f.endsWith(".md"));
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(kumaDir, file), "utf-8");
        const lower = content.toLowerCase();
        let matchCount = 0;
        for (const term of terms) {
          if (lower.includes(term)) matchCount++;
        }
        const score = Math.round((matchCount / terms.length) * 100);
        if (score > 0) {
          const topic = file.replace(/\.md$/, "");
          const firstLine = content.split("\n").slice(0, 3).join(" ").substring(0, 150);
          results.push({
            topic,
            content: firstLine,
            score,
            reason: `${matchCount}/${terms.length} terms matched`,
          });
        }
      } catch {}
    }
  } catch {}

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Format scored memories as human-readable.
 */
function formatScoredMemories(memories: ScoredMemory[], context: string): string {
  if (memories.length === 0) return "";

  const lines: string[] = [
    `🧠 **Relevant Memories** (for "${context.substring(0, 40)}")`,
    "━━━━━━━━━━━━━━━━━━━━━━━━━",
  ];

  for (const m of memories) {
    const bar = "█".repeat(Math.round(m.score / 10)) + "░".repeat(Math.round(10 - m.score / 10));
    lines.push(`  **${m.topic}** — ${bar} ${m.score}%`);
    lines.push(`  ${m.content.substring(0, 100)}`);
    lines.push(`  💡 ${m.reason}`);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Record a decision with structured template.
 * Writes to BOTH markdown memory file AND knowledge graph for cross-referencing.
 */
export function recordDecision(decision: DecisionRecord): string {
  try {
    const entry = [
      "",
      `## ${decision.title}`,
      `- **Date:** ${decision.timestamp || new Date().toISOString()}`,
      `- **Context:** ${decision.context}`,
      `- **Options:** ${decision.options.join(", ")}`,
      `- **Rationale:** ${decision.rationale}`,
      `- **Outcome:** ${decision.outcome}`,
      "",
    ].join("\n");

    const existing = sessionMemory.getMemoryContent("decisions");
    sessionMemory.writeMemory("decisions", existing + entry);
    sessionMemory.recordToolCall("kuma_decision", { title: decision.title });

    // ADR TO GRAPH: Also record the decision as a node in the knowledge graph
    // and link it to any referenced files/context for cross-referencing
    recordDecisionToGraph(decision).catch(() => {});

    return `✅ Decision "${decision.title}" recorded.`;
  } catch (err) {
    return `Error recording decision: ${err}`;
  }
}

/**
 * Record a decision as a node + edges in the knowledge graph.
 * This enables decisions to be searchable via kuma_memory search and visible in impact analysis.
 */
async function recordDecisionToGraph(decision: DecisionRecord): Promise<void> {
  try {
    const { upsertNode, addEdge } = await import("./kumaGraph.js");

    const decisionId = `decision::${decision.title.replace(/[^a-zA-Z0-9_\-\s]/g, "").trim().replace(/\s+/g, "-")}`;

    // 1. Create the decision node
    await upsertNode({
      id: decisionId,
      type: "variable",
      name: `ADR: ${decision.title.substring(0, 80)}`,
      metadata: {
        type: "architectural-decision",
        context: decision.context.substring(0, 200),
        rationale: decision.rationale.substring(0, 200),
        outcome: decision.outcome,
        timestamp: decision.timestamp,
      },
    });

    // 2. Link decision to context files (extract file paths from context text)
    const filePathMatches = decision.context.matchAll(/["']?([\w./-]+\.\w+)["']?/g);
    for (const match of filePathMatches) {
      const possiblePath = match[1];
      if (possiblePath.includes("/") && (possiblePath.endsWith(".ts") || possiblePath.endsWith(".js") || possiblePath.endsWith(".json") || possiblePath.endsWith(".md"))) {
        try {
          const fileId = `file::${possiblePath}`;
          await upsertNode({ id: fileId, type: "file", name: possiblePath });
          await addEdge({ sourceId: decisionId, targetId: fileId, type: "depends_on", metadata: { reason: "adr-context" } });
        } catch {}
      }
    }

    // 3. Link decision to its outcome as a modifier
    if (decision.outcome && decision.outcome !== "implemented") {
      try {
        const outcomeId = `decision-outcome::${decision.outcome.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase()}`;
        await upsertNode({ id: outcomeId, type: "variable", name: `Outcome: ${decision.outcome.substring(0, 60)}` });
        await addEdge({ sourceId: decisionId, targetId: outcomeId, type: "depends_on" });
      } catch {}
    }
  } catch {
    // Non-critical — decision is already saved to markdown
  }
}

/**
 * Analyze session for decision-worthy moments.
 * Returns true if there are significant changes worth recording.
 */
let decisionCooldown = 0;

export function shouldRecordDecision(): { worth: boolean; title?: string } {
  // Cooldown: only suggest once per 10 edits
  const history = sessionMemory.getToolCallHistory(30);
  const edits = history.filter(c => c.toolName === "precise_diff_editor");

  if (edits.length > decisionCooldown + 10 && edits.length >= 10) {
    decisionCooldown = edits.length;
    return {
      worth: true,
      title: `Significant edits (${edits.length} changes)`,
    };
  }

  return { worth: false };
}

/**
 * Get proactive memory suggestions for current context.
 * Called by kuma_init to inject relevant memories.
 */
export function getProactiveMemories(): string {
  const summary = sessionMemory.getSummary();
  const goal = (summary.currentGoal as string) || "";
  const modifiedFiles = summary.modifiedFiles as Array<{ filePath: string }> || [];

  // Build context from goal + modified files
  const context = [goal, ...modifiedFiles.map((f: any) => f.filePath || "")].join(" ");
  if (!context.trim()) return "";

  const memories = scoreMemoryRelevance(context, 3);
  return formatScoredMemories(memories, goal || "current context");
}

/**
 * Format decision template for AI use.
 */
export function formatDecisionTemplate(): string {
  return [
    "📝 **Decision Recording Template**",
    "━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
    "Use kuma_decision({ action: 'record', ... }) to log important decisions:",
    "",
    "```",
    "kuma_decision({",
    "  action: 'record',",
    "  title: 'Why Redis instead of in-memory cache',",
    "  context: 'Need stateless auth for mobile clients',",
    "  options: ['Redis', 'In-memory', 'Database'],",
    "  rationale: 'Latency <10ms with persistence required',",
    "  outcome: 'Redis chosen'",
    "})",
    "```",
    "",
    "💡 Call kuma_decision({ action: 'suggest' }) to check if now is a good time to record.",
  ].join("\n");
}
