// ============================================================
// KUMA AUTO-INIT — Zero-Call Lazy Initialization (Pilar 1)
// ============================================================
// Auto-initializes Kuma on first tool call so agents never need
// to manually call init. Tracks state to avoid double-init.
// ============================================================

import { sessionMemory } from "./sessionMemory.js";

let _initialized = false;
let _initPromise: Promise<void> | null = null;

/**
 * Ensure Kuma is initialized. Called automatically before any tool handler.
 * If already initialized, returns immediately (no-op).
 * Uses promise deduplication to prevent concurrent init races.
 */
export async function ensureInitialized(): Promise<boolean> {
  if (_initialized) return false; // already done, no init needed

  if (_initPromise) {
    await _initPromise;
    return false; // someone else is handling it
  }

  _initPromise = doInit();
  await _initPromise;
  return true; // we performed init
}

async function doInit(): Promise<void> {
  try {
    // 1. Initialize session memory if not already
    sessionMemory.init({
      projectRoot: process.cwd(),
      startTime: Date.now(),
    });

    // 2. Restore previous session
    try {
      const sessionInfo = sessionMemory.loadSession();
      if (sessionInfo.hasPrevSession) {
        console.error(`[kuma:auto-init] ✅ Restored session (${sessionInfo.toolCallCount} previous tool calls)`);
      }
    } catch {}

    // 3. Populate knowledge graph from session memory
    try {
      const { buildFromSessionMemory } = await import("./kumaGraph.js");
      const edgeCount = await buildFromSessionMemory();
      if (edgeCount > 0) {
        console.error(`[kuma:auto-init] ✅ Graph auto-populated with ${edgeCount} entries`);
      }
    } catch {}

    // 4. Pre-warm search vectors
    try {
      const { buildSearchVectors } = await import("./kumaSearch.js");
      await buildSearchVectors();
    } catch {}

    // 5. Create session record in DB
    try {
      const { getDb, saveDb } = await import("./kumaDb.js");
      const db = await getDb();
      db.run(
        `INSERT INTO sessions (started_at, goal, tool_calls) VALUES (?, ?, ?)`,
        [Math.floor(Date.now() / 1000), "Auto-initialized", 0],
      );
      saveDb(db);
    } catch {}

    _initialized = true;
    console.error(`[kuma:auto-init] ✅ Zero-call auto-init complete`);
  } catch (err) {
    console.error(`[kuma:auto-init] ⚠️ Auto-init error: ${err}`);
    _initialized = true; // mark as done even on error to prevent infinite retries
  }
}

/**
 * Check if auto-init has been performed.
 */
export function isInitialized(): boolean {
  return _initialized;
}

/**
 * Reset init state (useful for testing).
 */
export function resetInitState(): void {
  _initialized = false;
  _initPromise = null;
}
