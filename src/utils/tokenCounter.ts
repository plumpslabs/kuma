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
 * Token budget tracker for the session
 */
export class TokenBudgetTracker {
  private totalTokensUsed = 0;
  private readonly maxTokens: number;
  private readonly warningThreshold: number; // 70%
  private readonly criticalThreshold: number; // 90%

  constructor(maxTokens = 128_000) {
    this.maxTokens = maxTokens;
    this.warningThreshold = maxTokens * 0.7;
    this.criticalThreshold = maxTokens * 0.9;
  }

  add(text: string): void {
    this.totalTokensUsed += estimateTokens(text);
  }

  get usage(): number {
    return this.totalTokensUsed;
  }

  get remaining(): number {
    return this.maxTokens - this.totalTokensUsed;
  }

  get percentage(): number {
    return (this.totalTokensUsed / this.maxTokens) * 100;
  }

  get status(): "ok" | "warning" | "critical" | "exhausted" {
    if (this.totalTokensUsed >= this.maxTokens) return "exhausted";
    if (this.totalTokensUsed >= this.criticalThreshold) return "critical";
    if (this.totalTokensUsed >= this.warningThreshold) return "warning";
    return "ok";
  }

  get summary(): string {
    const pct = this.percentage.toFixed(1);
    switch (this.status) {
      case "ok":
        return `📊 Token: ${pct}% used (${this.remaining.toLocaleString()} remaining)`;
      case "warning":
        return `⚠️ Token: ${pct}% used — approaching limit (${this.remaining.toLocaleString()} remaining)`;
      case "critical":
        return `🔴 Token: ${pct}% used — CRITICAL (${this.remaining.toLocaleString()} remaining)`;
      case "exhausted":
        return `🚫 Token budget EXHAUSTED. Consider pruning context.`;
    }
  }

  reset(): void {
    this.totalTokensUsed = 0;
  }
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
