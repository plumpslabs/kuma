// ============================================================
// KUMA BLACKBOARD — Shared Blackboard Protocol (Issue #19)
// ============================================================
// Enables real-time state and memory synchronization across
// concurrent multi-agent swarms via an event-driven pub/sub bus.
//
// Sub-agents publish real-time findings (e.g. bug_discovered,
// route_requirement, schema_guard_added).
// Peer agents subscribe or auto-pull blackboard events.
// Thread-safe via SQLite.
// ============================================================

import { getDb, saveDb } from "./kumaDb.js";
import { sessionMemory } from "./sessionMemory.js";

export type BlackboardEventType =
  | "bug_discovered"
  | "route_requirement"
  | "schema_guard_added"
  | "decision_made"
  | "file_modified"
  | "test_failed"
  | "test_passed"
  | "research_complete"
  | "dependency_found"
  | "security_finding"
  | "custom";

export interface BlackboardEvent {
  id?: number;
  type: BlackboardEventType;
  source: string;       // e.g., "researcher-1", "code-writer", "tester"
  topic: string;        // e.g., "auth-middleware", "user-schema"
  payload: string;      // JSON string of event data
  severity?: "info" | "warning" | "critical";
  tags?: string;        // JSON array of tags
  created_at?: number;
}

const MAX_BLACKBOARD_EVENTS = 500;
const EVENT_TTL_HOURS = 24;

// ============================================================
// ENSURE TABLE
// ============================================================

async function ensureBlackboardTable(): Promise<void> {
  const db = await getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS blackboard_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      source TEXT NOT NULL,
      topic TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      severity TEXT NOT NULL DEFAULT 'info'
        CHECK(severity IN ('info','warning','critical')),
      tags TEXT DEFAULT '[]',
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_bb_type ON blackboard_events(type);
    CREATE INDEX IF NOT EXISTS idx_bb_topic ON blackboard_events(topic);
    CREATE INDEX IF NOT EXISTS idx_bb_severity ON blackboard_events(severity);
    CREATE INDEX IF NOT EXISTS idx_bb_created ON blackboard_events(created_at);
  `);
  saveDb();
}

// ============================================================
// PUBLISH
// ============================================================

/**
 * Publish an event to the blackboard.
 * All peer agents can then subscribe/query events.
 */
export async function publishEvent(event: BlackboardEvent): Promise<string> {
  try {
    await ensureBlackboardTable();
    const db = await getDb();

    db.run(
      `INSERT INTO blackboard_events (type, source, topic, payload, severity, tags)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        event.type,
        event.source || "kuma-agent",
        event.topic,
        event.payload,
        event.severity || "info",
        event.tags || "[]",
      ]
    );

    // Prune old events to stay within limit
    db.exec(`
      DELETE FROM blackboard_events
      WHERE id NOT IN (SELECT id FROM blackboard_events ORDER BY created_at DESC LIMIT ${MAX_BLACKBOARD_EVENTS})
    `);

    // Prune events older than TTL
    const cutoff = Math.floor(Date.now() / 1000) - EVENT_TTL_HOURS * 3600;
    db.exec(`DELETE FROM blackboard_events WHERE created_at < ${cutoff}`);

    saveDb();
    sessionMemory.recordToolCall("kuma_blackboard_publish", {
      type: event.type,
      topic: event.topic,
      source: event.source,
      severity: event.severity,
    });

    return `✅ Published: [${event.type}] ${event.topic} from "${event.source}"`;
  } catch (err) {
    return `❌ Failed to publish event: ${err}`;
  }
}

// ============================================================
// QUERY / SUBSCRIBE
// ============================================================

export interface BlackboardQuery {
  types?: BlackboardEventType[];
  topics?: string[];
  sources?: string[];
  severity?: "info" | "warning" | "critical";
  since?: number;           // Unix timestamp
  limit?: number;
}

/**
 * Query recent blackboard events with filters.
 * Agents use this to pull relevant state from peer agents.
 */
export async function queryEvents(query: BlackboardQuery = {}): Promise<string> {
  try {
    await ensureBlackboardTable();
    const db = await getDb();
    const limit = query.limit || 20;

    let sql = "SELECT * FROM blackboard_events WHERE 1=1";
    const bind: unknown[] = [];

    if (query.types && query.types.length > 0) {
      const placeholders = query.types.map(() => "?").join(",");
      sql += ` AND type IN (${placeholders})`;
      bind.push(...query.types);
    }
    if (query.topics && query.topics.length > 0) {
      const likeClauses = query.topics.map(() => "topic LIKE ?").join(" OR ");
      sql += ` AND (${likeClauses})`;
      bind.push(...query.topics.map(t => `%${t}%`));
    }
    if (query.sources && query.sources.length > 0) {
      const placeholders = query.sources.map(() => "?").join(",");
      sql += ` AND source IN (${placeholders})`;
      bind.push(...query.sources);
    }
    if (query.severity) {
      sql += " AND severity = ?";
      bind.push(query.severity);
    }
    if (query.since) {
      sql += " AND created_at >= ?";
      bind.push(query.since);
    }
    sql += " ORDER BY created_at DESC LIMIT ?";
    bind.push(limit);

    const stmt = db.prepare(sql);
    stmt.bind(bind);
    const results: Array<Record<string, unknown>> = [];
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();

    if (results.length === 0) {
      return "📋 **Blackboard** — No matching events found.";
    }

    const lines: string[] = [
      `📋 **Blackboard** — ${results.length} event(s)`,
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "",
    ];

    for (const r of results) {
      const severityIcon = r.severity === "critical" ? "🔴"
        : r.severity === "warning" ? "🟡" : "🟢";
      const time = new Date((r.created_at as number) * 1000).toLocaleTimeString();
      let payloadPreview = (r.payload as string) || "";
      try {
        const parsed = JSON.parse(payloadPreview);
        payloadPreview = JSON.stringify(parsed).substring(0, 80);
      } catch { payloadPreview = payloadPreview.substring(0, 80); }

      lines.push(
        `${severityIcon} [${r.type}] **${r.topic}** — by ${r.source} @ ${time}`,
        `   📝 ${payloadPreview}`,
        "",
      );
    }

    return lines.join("\n");
  } catch (err) {
    return `❌ Failed to query blackboard: ${err}`;
  }
}

// ============================================================
// SUBSCRIBE — Auto-pull events matching criteria
// ============================================================

/**
 * Subscribe to events matching given filters.
 * Returns a stream-like formatted output of matching events.
 */
export async function subscribeEvents(
  query: BlackboardQuery = {},
): Promise<string> {
  const result = await queryEvents({ ...query, limit: 50 });
  if (result.includes("No matching events")) {
    return "👂 **Subscribed** to blackboard — waiting for matching events. Re-query with kuma_blackboard({ action: 'query' }).";
  }
  return "👂 **Blackboard Subscription** — recent matching events:\n\n" + result;
}

// ============================================================
// STATS
// ============================================================

export async function blackboardStats(): Promise<string> {
  try {
    await ensureBlackboardTable();
    const db = await getDb();

    const total = ((db.exec("SELECT COUNT(*) as c FROM blackboard_events")[0]?.values[0]?.[0] as number) ?? 0);
    const byType = db.exec(`
      SELECT type, COUNT(*) as cnt FROM blackboard_events
      GROUP BY type ORDER BY cnt DESC LIMIT 10
    `);
    const topSources = db.exec(`
      SELECT source, COUNT(*) as cnt FROM blackboard_events
      GROUP BY source ORDER BY cnt DESC LIMIT 5
    `);

    const lines: string[] = [
      "📊 **Blackboard Stats**",
      "━━━━━━━━━━━━━━━━━━━━━━",
      "",
      `📝 Total events: ${total}`,
      "",
    ];

    if (byType[0]?.values) {
      lines.push("**By Type:**");
      for (const row of byType[0].values) {
        lines.push(`  • ${row[0]}: ${row[1]}`);
      }
      lines.push("");
    }

    if (topSources[0]?.values) {
      lines.push("**Top Sources:**");
      for (const row of topSources[0].values) {
        lines.push(`  • ${row[0]}: ${row[1]} events`);
      }
    }

    return lines.join("\n");
  } catch (err) {
    return `Error: ${err}`;
  }
}
