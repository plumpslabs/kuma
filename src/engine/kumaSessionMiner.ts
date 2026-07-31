// ============================================================
// SESSION MINER — Auto-extract insights from tool call transcript
// ============================================================
// Analyzes tool calls at end of session to suggest gotchas,
// decisions, and arch_flows the agent should have recorded.
// Agent/user approves or skips — zero writing effort.
// ============================================================

import { sessionMemory } from "./sessionMemory.js";

export interface MinedInsight {
  type: "gotcha" | "decision" | "arch_flow";
  scope: string;
  content: string;
  confidence: number;
  source: string; // what tool call pattern triggered this
}

/**
 * Mine the session transcript for insights that should have been recorded.
 * Returns suggestions for agent/user to approve or skip.
 */
export function mineSessionInsights(): MinedInsight[] {
  const insights: MinedInsight[] = [];
  const toolCalls = sessionMemory.getToolCallHistory(50);

  if (toolCalls.length < 3) return insights;

  // Pattern 1: Multiple edits to same file = potential gotcha (why so many fixes?)
  const editCounts = new Map<string, number>();
  for (const call of toolCalls) {
    if (call.toolName === "browser_edit" || call.toolName === "write" || call.toolName === "edit") {
      const file = (call.params.filePath as string) || (call.params.path as string) || "";
      if (file) editCounts.set(file, (editCounts.get(file) || 0) + 1);
    }
  }
  for (const [file, count] of editCounts) {
    if (count >= 3) {
      insights.push({
        type: "gotcha",
        scope: file,
        content: `File required ${count} edits in one session — may indicate underlying complexity or recurring issue`,
        confidence: 0.6,
        source: `edit_count:${count}:${file}`,
      });
    }
  }

  // Pattern 2: Error-then-fix sequence = bug found
  for (let i = 0; i < toolCalls.length - 1; i++) {
    const curr = toolCalls[i];
    const next = toolCalls[i + 1];
    if (curr.toolName === "bash" && next.toolName === "edit") {
      const cmd = (curr.params.command as string) || "";
      const file = (next.params.filePath as string) || "";
      if ((cmd.includes("test") || cmd.includes("lint") || cmd.includes("typecheck")) && file) {
        insights.push({
          type: "gotcha",
          scope: file,
          content: `Test/lint failed then file was edited — likely a bug fix`,
          confidence: 0.7,
          source: `error_fix_sequence`,
        });
      }
    }
  }

  // Pattern 3: Multiple file reads before edit = research flow
  let pendingReads: string[] = [];
  for (const call of toolCalls) {
    if (call.toolName === "read" || call.toolName === "browser_read") {
      const file = (call.params.filePath as string) || "";
      if (file) pendingReads.push(file);
    } else if (call.toolName === "edit" && pendingReads.length >= 2) {
      const file = (call.params.filePath as string) || "";
      if (file) {
        insights.push({
          type: "arch_flow",
          scope: file,
          content: `domain: ${file.split("/").pop()?.replace(/\.\w+$/, "") || "Unknown"} | hops: ${pendingReads.slice(0, 5).map(f => f.split("/").pop() || f).join(" → ")}`,
          confidence: 0.5,
          source: `research_flow:${pendingReads.length}_reads`,
        });
      }
      pendingReads = [];
    } else {
      pendingReads = [];
    }
  }

  // Pattern 4: Decision-like sequences (compare then choose)
  for (let i = 0; i < toolCalls.length - 2; i++) {
    const a = toolCalls[i];
    const b = toolCalls[i + 1];
    const c = toolCalls[i + 2];
    if (
      (a.toolName === "read" || a.toolName === "browser_read") &&
      (b.toolName === "read" || b.toolName === "browser_read") &&
      (c.toolName === "edit")
    ) {
      const fileA = (a.params.filePath as string) || "";
      const fileB = (b.params.filePath as string) || "";
      const fileC = (c.params.filePath as string) || "";
      if (fileA !== fileB && fileC) {
        insights.push({
          type: "decision",
          scope: fileC,
          content: `Read ${fileA.split("/").pop()} and ${fileB.split("/").pop()} before editing ${fileC.split("/").pop()} — compared options`,
          confidence: 0.5,
          source: `compare_then_choose`,
        });
      }
    }
  }

  return insights;
}

/**
 * Format mined insights for display to user/agent.
 */
export function formatMinedInsights(insights: MinedInsight[]): string {
  if (insights.length === 0) {
    return "🔍 **Session Mining** — No patterns detected. Session was clean.";
  }

  const lines: string[] = [
    `🔍 **Session Mining** — ${insights.length} insight${insights.length > 1 ? "s" : ""} found`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    "",
    "Review and approve/skip each suggestion:",
    "",
  ];

  for (let i = 0; i < insights.length; i++) {
    const ins = insights[i];
    const icon = ins.type === "gotcha" ? "⚠️" : ins.type === "decision" ? "📌" : "🔀";
    const conf = Math.round(ins.confidence * 100);
    lines.push(`${i + 1}. ${icon} **${ins.type}** (${conf}% confidence)`);
    lines.push(`   Scope: ${ins.scope}`);
    lines.push(`   ${ins.content}`);
    lines.push(`   → \`kuma_memory({ action: "${ins.type}", ${ins.type === "arch_flow" ? "content" : "scope: \\\"${ins.scope}\\\", content"}: "${ins.content.substring(0, 60)}..." })\``);
    lines.push("");
  }

  lines.push("💡 Approve by recording the ones you agree with. Skip the rest.");
  return lines.join("\n");
}
