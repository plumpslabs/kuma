import { sessionMemory } from "./sessionMemory.js";

// ============================================================
// CONTEXT PRUNER — Auto-summarization & token management
// ============================================================

const TOKEN_LIMIT = 128_000;
const WARNING_THRESHOLD = 0.7; // 70%
const CRITICAL_THRESHOLD = 0.9; // 90%

/**
 * Digunakan oleh AI untuk memutuskan apakah perlu pruning.
 * Memberikan saran berdasarkan session state.
 */
export function getPrunerAdvice(): string {
  const memory = sessionMemory.getSummary();
  const toolCallCount = (memory.toolCallCount as number) ?? 0;
  const modifiedFiles = memory.modifiedFiles as Array<Record<string, unknown>> ?? [];
  const failedFiles = memory.unresolvedFailures as Array<Record<string, unknown>> ?? [];

  // Token estimation based on activity
  const estimatedTokens = estimateTokenUsage(toolCallCount, modifiedFiles.length);
  const percentage = (estimatedTokens / TOKEN_LIMIT) * 100;

  const lines: string[] = [
    "🧹 **Context Pruner Advice**",
    "",
    `📊 **Token Usage:** ~${estimatedTokens.toLocaleString()} / ${TOKEN_LIMIT.toLocaleString()} (${percentage.toFixed(1)}%)`,
    "",
  ];

  if (percentage > CRITICAL_THRESHOLD * 100) {
    lines.push("🟥 **CRITICAL: Context almost full!**");
    lines.push("Suggestions:");
    lines.push("1. Summarize completed work and remove old details");
    lines.push("2. Focus only on current goal and unresolved issues");
    lines.push("3. Consider finishing current task and starting fresh session");
    lines.push("");
  } else if (percentage > WARNING_THRESHOLD * 100) {
    lines.push("🟨 **WARNING: Context approaching limit**");
    lines.push("Suggestions:");
    lines.push("1. Keep responses concise");
    lines.push("2. Reference session memory instead of repeating details");
    lines.push("3. Prioritize unresolved failures over completed work");
    lines.push("");
  } else {
    lines.push("🟢 **Context is healthy.**");
    lines.push("");
  }

  // Session summary
  lines.push("**📋 Current Session Summary:**");
  lines.push(`- Tool calls: ${toolCallCount}`);
  lines.push(`- Modified/created files: ${modifiedFiles.length}`);
  lines.push(`- Unresolved failures: ${failedFiles.length}`);
  lines.push(`- Goal: ${(memory.currentGoal as string) || "Not set"}`);
  lines.push("");

  if (failedFiles.length > 0) {
    lines.push("**⚠️ Unresolved Issues:**");
    for (const f of failedFiles) {
      lines.push(`- ${f.task}: ${(f.error as string).substring(0, 100)}`);
    }
    lines.push("");
  }

  if (modifiedFiles.length > 0) {
    lines.push("**📝 Files Modified:**");
    for (const f of modifiedFiles) {
      lines.push(`- [${f.status}] ${f.filePath}`);
    }
  }

  return lines.join("\n");
}

function estimateTokenUsage(toolCalls: number, filesModified: number): number {
  // Perkiraan kasar token usage
  const baseTokens = 2000; // system prompt
  const perToolCall = 500; // rata-rata output tool
  const perFileModified = 1000; // rata-rata konten file
  const overhead = 3000; // conversation overhead

  return baseTokens + (toolCalls * perToolCall) + (filesModified * perFileModified) + overhead;
}

/**
 * Generate a compressed summary for injection into context
 */
export function generateContextSummary(): string {
  const memory = sessionMemory.getSummary();

  const modifiedFiles = (memory.modifiedFiles as Array<Record<string, unknown>> ?? [])
    .map((f) => `[${f.status}] ${f.filePath}`)
    .join("\n  ");

  const failedFiles = (memory.unresolvedFailures as Array<Record<string, unknown>> ?? [])
    .map((f) => `- ${f.task}: ${(f.error as string).substring(0, 150)}`)
    .join("\n  ");

  return [
    "=== CONTEXT SUMMARY ===",
    `Goal: ${memory.currentGoal || "Not set"}`,
    `Completed steps: ${(memory.completedSteps as string[] ?? []).join(", ") || "None"}`,
    "",
    `Modified files:`,
    `  ${modifiedFiles || "None"}`,
    "",
    `Unresolved issues:`,
    `  ${failedFiles || "None"}`,
    "",
    `Tool calls: ${memory.toolCallCount}`,
    "======================",
  ].join("\n");
}
