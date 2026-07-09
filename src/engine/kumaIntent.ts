// ============================================================
// KUMA INTENT — Intent Graph (Phase 2.3)
// ============================================================
// Maps AI goals/intents to tool call paths.
// Clusters sessions by intent and learns which paths are effective.
//
// Key concepts:
//   - intent: a goal or task (e.g., "fix login bug", "add payment feature")
//   - path: sequence of tool calls to accomplish an intent
//   - confidence: how likely a path is to succeed for a given intent
// ============================================================

import { getDb, saveDb } from "./kumaDb.js";

interface IntentPattern {
  intent: string;
  path: string[];
  frequency: number;
  successRate: number;
  avgDurationMs: number;
  lastUsed: number;
}

/**
 * Extract key terms from an intent string for clustering.
 */
function extractIntentTerms(intent: string): string[] {
  return intent
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !["the", "and", "for", "are", "but", "not", "you", "all", "can", "had", "her", "was", "one", "our", "out", "has", "have", "been", "some", "them", "then", "their", "this", "that", "with", "from", "they", "will", "would", "could", "should", "about", "into", "over", "after", "also", "does", "each", "made", "just", "more", "most", "much", "must", "only", "other", "such", "than", "very", "when", "where", "which", "while", "your"].includes(w))
    .slice(0, 5);
}

/**
 * Register a session's intent and record its tool call path.
 * Called at the end of a session when the goal is known.
 */
export async function recordIntent(params: {
  intent: string;
  toolCalls: Array<{ toolName: string; success: boolean; durationMs: number; params: Record<string, unknown> }>;
  contextFiles: string[];
  success: boolean;
}): Promise<void> {
  try {
    const db = await getDb();
    const now = Math.floor(Date.now() / 1000);

    // 1. Create session record
    db.run(`
      INSERT INTO sessions (started_at, ended_at, goal, tool_calls, success)
      VALUES (?, ?, ?, ?, ?)
    `, [
      now - params.toolCalls.reduce((acc, tc) => acc + (tc.durationMs || 0), 0),
      now,
      params.intent.substring(0, 500),
      params.toolCalls.length,
      params.success ? 1 : 0,
    ]);

    const sessionId = (db.exec("SELECT last_insert_rowid()")[0]?.values[0][0] as number) || 0;

    // 2. Record each tool call
    const path: string[] = [];
    for (const tc of params.toolCalls) {
      path.push(tc.toolName);
      db.run(`
        INSERT INTO tool_calls (session_id, tool_name, params, success, duration_ms, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [
        sessionId,
        tc.toolName,
        JSON.stringify(tc.params),
        tc.success ? 1 : 0,
        tc.durationMs || 0,
        now,
      ]);
    }

    // 3. Create/update intent pattern in experiences + patterns
    const terms = extractIntentTerms(params.intent);
    if (terms.length > 0) {
      // Hash the first 2 terms as the "intent hash" for pattern matching
      const intentHash = terms.slice(0, 2).join("::").substring(0, 100);

      // Update patterns table for each adjacent tool call pair
      for (let i = 0; i < path.length - 1; i++) {
        const antecedent = path[i];
        const consequent = path[i + 1];

        db.run(`
          INSERT INTO experience_patterns (antecedent_tool, antecedent_hash, consequent_tool, confidence, count, avg_duration_ms, success_rate, last_seen_at)
          VALUES (?, ?, ?, 0.3, 1, 0, ?, ?)
          ON CONFLICT(antecedent_tool, antecedent_hash, consequent_tool) DO UPDATE SET
            count = count + 1,
            success_rate = (success_rate * (count - 1) + ?) / count,
            confidence = MIN(0.9, (count + 1.0) / (count + 5.0)),
            last_seen_at = strftime('%s','now')
        `, [
          antecedent, intentHash, consequent,
          params.success ? 1.0 : 0.0,
          params.success ? 1.0 : 0.0,
        ]);
      }

      // Also store as an "intent" node in the knowledge graph
      try {
        db.run(`
          INSERT OR REPLACE INTO nodes (id, type, name, metadata, updated_at)
          VALUES (?, 'variable', ?, ?, strftime('%s','now'))
        `, [
          `intent::${intentHash}`,
          `intent: ${terms.join(" ")}`,
          JSON.stringify({ fullIntent: params.intent, sessionCount: 1 }),
        ]);
      } catch {}
    }

    saveDb(db);
  } catch (err) {
    console.error(`[KumaIntent] Failed to record intent: ${err}`);
  }
}

/**
 * Get intent patterns from recent sessions — clusters by intent terms.
 */
export async function getIntentPatterns(limit: number = 10): Promise<IntentPattern[]> {
  try {
    const db = await getDb();
    const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 86400;

    // Get recent sessions with goals
    const stmt = db.prepare(`
      SELECT id, goal, tool_calls, started_at, 
        CASE WHEN failures = 0 THEN 1 ELSE 0 END as success
      FROM sessions
      WHERE goal IS NOT NULL AND goal != '' AND started_at > ?
      ORDER BY started_at DESC
      LIMIT ?
    `);
    stmt.bind([sevenDaysAgo, limit]);

    const sessions: Array<{
      id: number; goal: string; toolCalls: number; success: number; startedAt: number;
    }> = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      sessions.push({
        id: row.id as number,
        goal: row.goal as string,
        toolCalls: row.tool_calls as number,
        success: row.success as number,
        startedAt: row.started_at as number,
      });
    }
    stmt.free();

    if (sessions.length === 0) return [];

    // Build patterns by clustering similar intents
    const clusterMap = new Map<
      string,
      { paths: string[][]; successes: number[]; totalDuration: number; lastUsed: number }
    >();

    for (const session of sessions) {
      const terms = extractIntentTerms(session.goal);
      if (terms.length === 0) continue;

      const clusterKey = terms.slice(0, 2).join("::");

      // Get tool call path for this session
      const pathStmt = db.prepare(`
        SELECT tool_name FROM tool_calls
        WHERE session_id = ?
        ORDER BY id ASC
      `);
      pathStmt.bind([session.id]);
      const path: string[] = [];
      while (pathStmt.step()) {
        const row = pathStmt.getAsObject() as Record<string, unknown>;
        path.push(row.tool_name as string);
      }
      pathStmt.free();

      const existing = clusterMap.get(clusterKey) || {
        paths: [],
        successes: [],
        totalDuration: 0,
        lastUsed: 0,
      };
      existing.paths.push(path);
      existing.successes.push(session.success);
      existing.lastUsed = Math.max(existing.lastUsed, session.startedAt);
      clusterMap.set(clusterKey, existing);
    }

    // Format results
    const patterns: IntentPattern[] = [];
    for (const [intent, data] of clusterMap) {
      // Get the most common path
      const pathFreq = new Map<string, number>();
      for (const p of data.paths) {
        const key = p.join(" → ");
        pathFreq.set(key, (pathFreq.get(key) || 0) + 1);
      }
      const [topPath] = [...pathFreq.entries()].sort((a, b) => b[1] - a[1])[0] || [];
      const totalSuccesses = data.successes.filter(Boolean).length;
      const total = data.successes.length;

      patterns.push({
        intent,
        path: topPath ? topPath.split(" → ") : [],
        frequency: data.paths.length,
        successRate: total > 0 ? totalSuccesses / total : 0,
        avgDurationMs: data.paths.length > 0 ? Math.round(data.totalDuration / data.paths.length) : 0,
        lastUsed: data.lastUsed,
      });
    }

    // Sort by frequency desc
    patterns.sort((a, b) => b.frequency - a.frequency);
    return patterns;
  } catch (err) {
    console.error(`[KumaIntent] Failed to get intent patterns: ${err}`);
    return [];
  }
}

/**
 * Find similar intents and suggest reliable paths.
 */
export async function suggestIntentPath(intent: string): Promise<{
  similarIntents: Array<{ intent: string; similarity: number }>;
  suggestedPath: string[];
  confidence: number;
} | null> {
  try {
    const terms = extractIntentTerms(intent);
    if (terms.length === 0) return null;

    const patterns = await getIntentPatterns(20);

    // Find patterns matching our terms
    const matchingPatterns = patterns
      .map((p) => {
        const pTerms = p.intent.split("::");
        const matchCount = terms.filter((t) => pTerms.some((pt) => pt.includes(t) || t.includes(pt))).length;
        return { pattern: p, similarity: matchCount / Math.max(terms.length, pTerms.length) };
      })
      .filter((m) => m.similarity > 0.2)
      .sort((a, b) => b.similarity - a.similarity);

    if (matchingPatterns.length === 0) return null;

    const best = matchingPatterns[0];
    return {
      similarIntents: matchingPatterns.slice(0, 5).map((m) => ({
        intent: m.pattern.intent,
        similarity: Math.round(m.similarity * 100),
      })),
      suggestedPath: best.pattern.path,
      confidence: Math.round(best.pattern.successRate * best.similarity * 100),
    };
  } catch (err) {
    console.error(`[KumaIntent] Failed to suggest intent path: ${err}`);
    return null;
  }
}

/**
 * Format intent patterns as human-readable output.
 */
export function formatIntentPatterns(patterns: IntentPattern[]): string {
  if (patterns.length === 0) {
    return "🧠 **Intent Graph** — No intent patterns recorded yet.\n\nIntents are learned from session goals. As you work, Kuma will learn which tool paths work best for different tasks.";
  }

  const lines: string[] = [
    `🧠 **Intent Graph** — ${patterns.length} intent pattern(s)`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━`,
    "",
  ];

  for (const p of patterns) {
    const bar = "█".repeat(Math.round(p.successRate * 10)) + "░".repeat(Math.round((1 - p.successRate) * 10));
    const lastUsed = new Date(p.lastUsed * 1000).toISOString().split("T")[0];
    const pathStr = p.path.length > 0
      ? p.path.slice(0, 5).join(" → ") + (p.path.length > 5 ? ` (+${p.path.length - 5} more)` : "")
      : "(no path data)";

    lines.push(
      `**${p.intent}**`,
      `  📊 ${p.frequency}x | ${bar} ${(p.successRate * 100).toFixed(0)}% success | Last: ${lastUsed}`,
      `  🛤️ ${pathStr}`,
      "",
    );
  }

  lines.push(
    "💡 Use kuma_intent_query({ action: 'suggest', intent: 'your goal' }) to get path suggestions.",
    "💡 Intents are learned automatically from session goals.",
  );

  return lines.join("\n");
}

/**
 * Format a suggestion as human-readable output.
 */
export function formatIntentSuggestion(
  intent: string,
  suggestion: NonNullable<Awaited<ReturnType<typeof suggestIntentPath>>>
): string {
  const lines: string[] = [
    `🧠 **Intent Suggestion** — "${intent}"`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━`,
    "",
    `🎯 **Confidence:** ${suggestion.confidence}%`,
    "",
  ];

  if (suggestion.suggestedPath.length > 0) {
    lines.push("**Suggested Path:**");
    for (let i = 0; i < suggestion.suggestedPath.length; i++) {
      lines.push(`  ${i + 1}. ${suggestion.suggestedPath[i]}`);
    }
    lines.push("");
  }

  if (suggestion.similarIntents.length > 0) {
    lines.push("**Similar Intent Patterns:**");
    for (const si of suggestion.similarIntents) {
      lines.push(`  • ${si.intent} — ${si.similarity}% match`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
