// ============================================================
// KUMA OUTPUT — Compact mode, adaptive compression, response budget, dedup
// ============================================================
// Central utility for ALL Kuma tool output formatting.
// Ensures token-efficient responses without changing tool logic.
// ============================================================

import crypto from "node:crypto";
import { estimateTokens } from "./tokenCounter.js";

// ============================================================
// DEDUP CACHE — Smart dedup: skip identical responses
// ============================================================

interface CacheEntry {
  output: string;
  timestamp: number;
}

const dedupCache = new Map<string, CacheEntry>();
const DEDUP_TTL_MS = 60_000; // 1 minute

/**
 * Get cached output if identical query was made recently.
 */
export function getCachedOutput(key: string): string | null {
  const entry = dedupCache.get(key);
  if (entry && Date.now() - entry.timestamp < DEDUP_TTL_MS) {
    return entry.output;
  }
  return null;
}

/**
 * Cache an output for dedup purposes.
 */
export function setCachedOutput(key: string, output: string): void {
  dedupCache.set(key, { output, timestamp: Date.now() });

  // Prune old entries if cache grows too large
  if (dedupCache.size > 50) {
    const now = Date.now();
    for (const [k, v] of dedupCache) {
      if (now - v.timestamp > DEDUP_TTL_MS) dedupCache.delete(k);
    }
  }
}

/**
 * Build a cache key from tool name + params for dedup.
 */
export function buildCacheKey(toolName: string, params: Record<string, unknown>): string {
  const stable: Record<string, unknown> = {};
  for (const key of Object.keys(params).sort()) {
    const val = params[key];
    if (typeof val === "string") stable[key] = val.trim().substring(0, 200);
    else if (typeof val === "number") stable[key] = val;
    else if (typeof val === "boolean") stable[key] = val;
    else if (Array.isArray(val)) stable[key] = val.length;
    else if (val === null || val === undefined) stable[key] = null;
    else stable[key] = JSON.stringify(val).substring(0, 200);
  }
  const str = JSON.stringify(stable);
  return toolName + ":" + crypto.createHash("md5").update(str).digest("hex").substring(0, 12);
}

// ============================================================
// FORMATTING STRIP — Compact mode
// ============================================================

/** Emoji and decorative chars commonly used in Kuma output */
const EMOJI_PATTERN = /[\u{1F000}-\u{1FFFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2300}-\u{23FF}]/gu;
const BOLD_PATTERN = /\*\*/g;
const DECORATIVE_LINE = /[━┉═]{5,}/g;
const MULTI_NEWLINE = /\n{3,}/g;

/**
 * Strip formatting for compact output mode.
 * Reduces token count by ~50-70% by removing decorative elements.
 */
export function stripFormatting(text: string): string {
  return text
    // Remove emojis
    .replace(EMOJI_PATTERN, "")
    // Remove bold markers
    .replace(BOLD_PATTERN, "")
    // Remove decorative lines
    .replace(DECORATIVE_LINE, "")
    // Collapse multiple newlines
    .replace(MULTI_NEWLINE, "\n\n")
    // Remove leading/trailing whitespace per line
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .trim();
}

// ============================================================
// ADAPTIVE COMPRESSION — Smart truncation based on output size
// ============================================================

/**
 * Apply adaptive compression based on output size.
 * - Small (< 50 lines): full output
 * - Medium (50-200 lines): compact + truncated
 * - Large (> 200 lines): summary + key items only
 */
export function adaptiveCompress(text: string, tokenBudget?: number): string {
  const lines = text.split("\n");
  const estimatedTokens = estimateTokens(text);

  // If no budget or under budget, return as-is
  if (!tokenBudget || estimatedTokens <= tokenBudget) return text;

  // Apply formatting strip first (reduces ~50%)
  const stripped = stripFormatting(text);
  const strippedTokens = estimateTokens(stripped);

  // If stripped version fits, use it
  if (strippedTokens <= tokenBudget) return stripped;

  // Still too large: truncate intelligently
  if (lines.length < 50) {
    // Small but dense: truncate by chars
    const maxChars = tokenBudget * 3;
    return stripped.slice(0, maxChars) + `\n\n[...truncated: ~${estimatedTokens}tokens > ${tokenBudget}tokens]`;
  }

  if (lines.length < 200) {
    // Medium: keep first 30 lines + last 10 lines
    const head = lines.slice(0, 30).join("\n");
    const tail = lines.slice(-10).join("\n");
    return `${stripFormatting(head)}\n\n[...${lines.length - 40} lines hidden - ${estimatedTokens}tokens > ${tokenBudget}tokens]\n\n${stripFormatting(tail)}`;
  }

  // Large: summary mode — keep only key lines (non-empty, non-decorative)
  const summaryLines = lines.filter((l) => {
    const t = l.trim();
    return t.length > 10 && !t.startsWith("  ") && !t.startsWith(".") && !/^[━┉═\s]+$/.test(t);
  });
  const compressed = stripFormatting(summaryLines.slice(0, 20).join("\n"));
  return `${compressed}\n\n[...${lines.length} lines compressed to ${summaryLines.length} key lines - ~${estimatedTokens}tokens > ${tokenBudget}tokens]`;
}

// ============================================================
// MASTER FORMAT — One function to rule them all
// ============================================================

export interface OutputOptions {
  compact?: boolean;
  responseBudget?: number;
  cacheKey?: string;
}

/**
 * Master function that applies all output optimizations:
 * 1. Dedup cache (skip if identical response was sent recently)
 * 2. Compact mode (strip emojis/formatting)
 * 3. Adaptive compression (auto-truncate based on size/budget)
 * 4. Cache the result for future dedup
 */
export function formatOutput(text: string, options: OutputOptions = {}): string {
  const { compact, responseBudget } = options;
  let result = text;

  // 1. Check dedup cache
  if (options.cacheKey) {
    const cached = getCachedOutput(options.cacheKey);
    if (cached !== null) {
      return cached;
    }
  }

  // 2. Compact mode: strip formatting
  if (compact) {
    result = stripFormatting(result);
  }

  // 3. Adaptive compression based on budget
  if (responseBudget && responseBudget > 0) {
    const tokens = estimateTokens(result);
    if (tokens > responseBudget) {
      result = adaptiveCompress(result, responseBudget);
    }
  }

  // 4. Cache for dedup
  if (options.cacheKey) {
    setCachedOutput(options.cacheKey, result);
  }

  return result;
}

/**
 * Estimate how many tokens a compact version would save.
 */
export function estimateTokenSavings(text: string): { original: number; compact: number; saved: number; percent: number } {
  const original = estimateTokens(text);
  const compact = estimateTokens(stripFormatting(text));
  return {
    original,
    compact,
    saved: original - compact,
    percent: original > 0 ? Math.round(((original - compact) / original) * 100) : 0,
  };
}
