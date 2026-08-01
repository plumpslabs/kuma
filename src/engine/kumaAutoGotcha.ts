// ============================================================
// KUMA AUTO-GOTCHA — Self-Learning Loop (P1)
// ============================================================
// Closes the self-learning loop: when a scope FAILS verification
// `THRESHOLD` consecutive times, Kuma automatically records a
// gotcha so future sessions never rediscover the failure.
// A passing verification resets the counter.
//
// State is persisted to `.kuma/auto-gotcha.json` (per-project).
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "../utils/pathValidator.js";

const STATE_FILE = ".kuma/auto-gotcha.json";
export const AUTO_GOTCHA_THRESHOLD = 2;
export const AUTO_GOTCHA_ESCALATE_AT = 4; // beyond this → high severity

interface AutoGotchaState {
  failures: Record<string, number>;      // scope -> consecutive failure count
  lastRecorded: Record<string, number>;  // scope -> failureCount at last gotcha record
}

function statePath(): string {
  return path.join(getProjectRoot(), STATE_FILE);
}

/** Load the persisted failure counter (safe on missing/corrupt file). */
export function loadAutoGotchaState(): AutoGotchaState {
  try {
    const fp = statePath();
    if (fs.existsSync(fp)) {
      const parsed = JSON.parse(fs.readFileSync(fp, "utf-8"));
      return {
        failures: parsed?.failures ?? {},
        lastRecorded: parsed?.lastRecorded ?? {},
      };
    }
  } catch { /* corrupt → reset */ }
  return { failures: {}, lastRecorded: {} };
}

/** Persist the failure counter. */
export function saveAutoGotchaState(state: AutoGotchaState): void {
  try {
    const fp = statePath();
    const dir = path.dirname(fp);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(state, null, 2), "utf-8");
  } catch { /* non-critical */ }
}

/** Reset the failure counter for a scope (e.g. after a successful verify). */
export function resetScopeFailures(scope: string): void {
  const state = loadAutoGotchaState();
  if (state.failures[scope] !== undefined || state.lastRecorded?.[scope] !== undefined) {
    delete state.failures[scope];
    if (state.lastRecorded) delete state.lastRecorded[scope];
    saveAutoGotchaState(state);
  }
}

export interface AutoGotchaResult {
  recorded: boolean;
  failureCount: number;
  message?: string;
}

/**
 * Track a verification outcome for a scope.
 *
 * - `passed: true`  → resets the counter.
 * - `passed: false` → increments; when threshold crossed, auto-records a
 *   gotcha via kumaGotchas.addGotcha and resets the counter (so each
 *   crossing records exactly one gotcha, not a flood).
 */
export async function trackVerificationResult(
  scope: string,
  passed: boolean,
): Promise<AutoGotchaResult> {
  if (!scope || scope === "session-impact") return { recorded: false, failureCount: 0 };

  const state = loadAutoGotchaState();
  const prev = state.failures[scope] ?? 0;
  state.lastRecorded = state.lastRecorded || {};

  if (passed) {
    if (prev > 0 || state.lastRecorded[scope] !== undefined) {
      delete state.failures[scope];
      delete state.lastRecorded[scope];
      saveAutoGotchaState(state);
    }
    return { recorded: false, failureCount: 0 };
  }

  const failureCount = prev + 1;
  state.failures[scope] = failureCount;
  saveAutoGotchaState(state);

  // Record only at exact thresholds (THRESHOLD then ESCALATE_AT), so a
  // run of failures produces escalating gotchas — but no flood.
  const lastRecordedAt = state.lastRecorded[scope] ?? 0;
  const shouldRecord =
    failureCount === AUTO_GOTCHA_THRESHOLD || failureCount === AUTO_GOTCHA_ESCALATE_AT;
  if (!shouldRecord || failureCount <= lastRecordedAt) {
    return { recorded: false, failureCount };
  }    // ── Threshold crossed → auto-record gotcha ──
    try {
      const { addGotcha } = await import("./kumaGotchas.js");
      const severity =
        failureCount >= AUTO_GOTCHA_ESCALATE_AT ? "high" : "medium";
      // NOTE: description must be count-independent so addGotcha's LIKE-dedup
      // matches the existing row and the escalation UPDATES severity (high)
      // instead of inserting a duplicate gotcha.
      const result = await addGotcha({
        filePath: scope,
        description: `Verification keeps failing for scope "${scope}"`,
        severity,
        workaround:
          `Run tests locally before touching this area. ` +
          `Failing scope: "${scope}" — ${failureCount} consecutive failures. ` +
          `Verify with kuma_safety({ action: "verify", scope: "${scope}" }) after fixes.`,
      });

    // Track where we last recorded — next record happens at the next threshold
    state.lastRecorded[scope] = failureCount;
    saveAutoGotchaState(state);

    return {
      recorded: true,
      failureCount,
      message: [
        `🧠 **Auto-Gotcha recorded** (self-learning loop)`,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        ``,
        `⚠️ Scope \`${scope}\` failed verification ${failureCount} consecutive times.`,
        `A gotcha has been recorded automatically so future sessions avoid re-discovering this.`,
        ``,
        result,
      ].join("\n"),
    };
  } catch (err) {
    // Recording failed — keep counter so the next failure can retry
    return {
      recorded: false,
      failureCount,
      message: `⚠️ Auto-gotcha recording failed: ${err}`,
    };
  }
}
