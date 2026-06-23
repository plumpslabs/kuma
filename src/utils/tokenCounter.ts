// ============================================================
// TOKEN COUNTER — Token usage estimation for tracking
// ============================================================

/**
 * Estimate token count from text.
 * Rule of thumb: ~4 chars per token for English,
 * ~2-3 chars per token for code.
 * We use a conservative approach: 3 chars per token.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

/**
 * Format text with token limit.
 * Useful for tool output that needs to be limited.
 */
export function truncateToTokenLimit(text: string, maxTokens: number): string {
  const estimatedTokens = estimateTokens(text);
  if (estimatedTokens <= maxTokens) return text;

  // Truncate to approximate token limit
  const maxChars = maxTokens * 3;
  const truncated = text.slice(0, maxChars);

  return truncated + `\n\n[...truncated: estimated ${estimatedTokens} tokens > limit of ${maxTokens} tokens]`;
}

/**
 * Batasi jumlah baris output
 */
export function limitLines(text: string, maxLines: number): string {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;

  const truncated = lines.slice(0, maxLines).join("\n");
  return truncated + `\n\n[...${lines.length - maxLines} more lines truncated]`;
}
