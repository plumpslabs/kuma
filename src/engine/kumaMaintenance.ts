// ============================================================
// KUMA MAINTENANCE — F12 (Roadmap): automatic light cleanup
// ============================================================
// Runs silent, low-risk maintenance once per day inside kuma_context init:
//   - sync markdown gotchas → DB
//   - garbage collect orphan/stale data (dedup, vacuum)
// Zero user action; never runs twice in the same window.
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "../utils/pathValidator.js";

const GC_STATE_FILE = ".kuma/auto-gc.json";
const GC_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Runs auto-cleanup at most once per 24h. Returns a short status line
 * when it actually ran, or "" when it's still inside the window.
 */
export async function maybeRunAutoCleanup(): Promise<string> {
  try {
    const root = getProjectRoot();
    const stateFile = path.join(root, GC_STATE_FILE);
    const now = Date.now();

    let lastRun = 0;
    if (fs.existsSync(stateFile)) {
      try {
        lastRun = (JSON.parse(fs.readFileSync(stateFile, "utf-8")).lastRun as number) || 0;
      } catch {
        lastRun = 0;
      }
    }
    if (now - lastRun < GC_INTERVAL_MS) return "";

    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify({ lastRun: now }), "utf-8");

    // Sync markdown → DB, then GC orphan/stale data
    const { syncGotchasToDb } = await import("./kumaGotchas.js");
    await syncGotchasToDb();
    const { runGarbageCollection } = await import("./kumaDb.js");
    const gcResult = await runGarbageCollection();

    const summary = gcResult.replace(/\n/g, " ").substring(0, 80);
    return `🧹 ${summary}`;
  } catch {
    return "";
  }
}
