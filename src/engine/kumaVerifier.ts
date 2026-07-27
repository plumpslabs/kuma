// ============================================================
// KUMA VERIFIER — On-Demand Test Verifier (FIXED v2.3.4)
// ============================================================
// 🔴 CRITICAL: This module MUST ONLY be called via explicit MCP tool call
// (kuma_safety({ action: "verify" })). It must NEVER be auto-triggered
// from health checks, session init, graph population, or any other
// internal hook. Doing so creates a resource-exhaustion loop.
//
// Safety guards (implemented after bug #CRITICAL-001):
//   1. Concurrency lock — only 1 verification at a time per process
//   2. Rate limiting — minimum 60s between verifications
//   3. Staleness cache — returns cached result if < 300s old
//   4. Runaway detection — blocks if called > 3 times in 5 minutes
//   5. Hard timeout — process is killed after timeoutMs (default 30s)
//   6. Process tracking — child PIDs stored for kill-switch
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { exec, type ChildProcess } from "node:child_process";
import { saveVerification, getLatestVerifications } from "./kumaDb.js";
import { sessionMemory } from "./sessionMemory.js";

export interface VerificationOptions {
  scope?: string;
  force?: boolean;
  timeoutMs?: number;
  /** Internal — set to true to bypass rate limits (only from MCP handler) */
  _fromHandler?: boolean;
}

export interface VerificationResult {
  runner: string;
  command: string;
  scope: string;
  passed: boolean;
  output: string;
  durationMs: number;
}

// ============================================================
// SAFETY GUARDS — In-memory, per-process
// ============================================================

/** Concurrency lock: only 1 verification at a time */
let _isRunning = false;

/** Timestamp of the last completed verification */
let _lastCompletedAt = 0;

/** Circular buffer of recent call timestamps (for runaway detection) */
const _callHistory: number[] = [];
const RUNAWAY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const RUNAWAY_THRESHOLD = 3; // >3 calls in 5 min = runaway

/** Rate limit: minimum gap between verifications */
const MIN_INTERVAL_MS = 60_000; // 60 seconds

/** Staleness: return cached if verification < 5 min old */
const STALE_RESULT_MS = 300_000; // 5 minutes

/** Default timeout for test execution */
const DEFAULT_TIMEOUT_MS = 30_000; // 30 seconds

/** Reference to the currently running child process (for kill-switch) */
let _currentProcess: ChildProcess | null = null;

/**
 * Get the PID of the currently running verification process (if any).
 * Used by the kill-switch and doctor diagnostic.
 */
export function getRunningVerificationPid(): number | null {
  return _currentProcess?.pid ?? null;
}

/**
 * Check if verification is currently running.
 */
export function isVerificationRunning(): boolean {
  return _isRunning;
}

/**
 * Get the time since the last completed verification (ms).
 * Returns -1 if no verification has been completed yet.
 */
export function msSinceLastVerification(): number {
  if (_lastCompletedAt === 0) return -1;
  return Date.now() - _lastCompletedAt;
}

/**
 * Get recent call count for runaway detection.
 */
export function getRecentCallCount(): number {
  const cutoff = Date.now() - RUNAWAY_WINDOW_MS;
  return _callHistory.filter(t => t > cutoff).length;
}

/**
 * Detect project test runner from manifest files.
 */
export function detectTestRunner(root = process.cwd()): { runner: string; baseCommand: string } {
  const pkgPath = path.join(root, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      if (pkg.scripts && pkg.scripts.test) {
        if (fs.existsSync(path.join(root, "pnpm-lock.yaml"))) {
          return { runner: "pnpm", baseCommand: "pnpm test" };
        }
        if (fs.existsSync(path.join(root, "yarn.lock"))) {
          return { runner: "yarn", baseCommand: "yarn test" };
        }
        return { runner: "npm", baseCommand: "npm test" };
      }
    } catch {}
  }

  if (fs.existsSync(path.join(root, "pytest.ini")) || fs.existsSync(path.join(root, "pyproject.toml"))) {
    return { runner: "pytest", baseCommand: "pytest" };
  }
  if (fs.existsSync(path.join(root, "Cargo.toml"))) {
    return { runner: "cargo", baseCommand: "cargo test" };
  }
  if (fs.existsSync(path.join(root, "go.mod"))) {
    return { runner: "go", baseCommand: "go test ./..." };
  }
  if (fs.existsSync(path.join(root, "Makefile"))) {
    return { runner: "make", baseCommand: "make test" };
  }
  // Fallback: syntax check for Node.js/TS projects
  if (fs.existsSync(path.join(root, "package.json"))) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));
      if (pkg.dependencies || pkg.devDependencies) {
        if (fs.existsSync(path.join(root, "tsconfig.json"))) {
          return { runner: "tsc", baseCommand: "npx tsc --noEmit" };
        }
        const srcDir = path.join(root, "src");
        if (fs.existsSync(srcDir)) {
          return { runner: "node", baseCommand: `node -c \"${srcDir}/**/*.js\" 2>/dev/null || node --check $(find src -name '*.js' 2>/dev/null | head -5)` };
        }
      }
    } catch {}
  }
  return { runner: "unknown", baseCommand: "npm test || echo 'No test runner configured'" };
}

/**
 * 🚨 SAFETY GUARD: Check if verification is allowed to run.
 * Returns a denial message, or null if allowed.
 */
function checkRateLimit(): string | null {
  // 1. Concurrency check
  if (_isRunning) {
    return "⏳ Verification already in progress — only 1 verification at a time. Wait for it to complete, or try again later.";
  }

  // 2. Runaway detection (>3 calls in 5 minutes)
  const cutoff = Date.now() - RUNAWAY_WINDOW_MS;
  const recent = _callHistory.filter(t => t > cutoff);
  if (recent.length >= RUNAWAY_THRESHOLD) {
    return `🔴 **Runaway Detection Triggered**\n\n` +
      `Verification has been called ${recent.length} times in the last 5 minutes. ` +
      `This looks like an uncontrolled loop. ` +
      `Verification has been **blocked** to prevent resource exhaustion.\n\n` +
      `💡 If you need to verify, wait ${Math.ceil((RUNAWAY_WINDOW_MS - (Date.now() - recent[0])) / 60000)} minutes, ` +
      `or run \`kuma_safety({ action: "doctor" })\` to check system status.\n\n` +
      `🚨 If this is unexpected, run \`pkill -f "pnpm test"\` to kill orphaned processes.`;
  }

  // 3. Rate limiting (60s cooldown)
  if (_lastCompletedAt > 0) {
    const elapsed = Date.now() - _lastCompletedAt;
    if (elapsed < MIN_INTERVAL_MS) {
      const remaining = Math.ceil((MIN_INTERVAL_MS - elapsed) / 1000);
      return `⏳ Rate limit: verification was run ${Math.floor(elapsed / 1000)}s ago. ` +
        `Please wait ${remaining}s before running verification again. ` +
        `(Minimum interval: ${MIN_INTERVAL_MS / 1000}s)`;
    }
  }

  return null; // Allowed
}

/**
 * Check if a recent verification result can be returned from cache.
 */
async function checkStaleness(scope: string): Promise<string | null> {
  if (scope === "session-impact" || scope === undefined) {
    try {
      const recent = await getLatestVerifications(1);
      if (recent.length > 0) {
        const age = Date.now() - (recent[0].created_at * 1000);
        if (age < STALE_RESULT_MS) {
          const ageSeconds = Math.floor(age / 1000);
          return [
            `⏩ **Using cached verification** (${ageSeconds}s old, < 5 min threshold)`,
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
            "",
            `🛠️ Runner: \`${recent[0].runner}\``,
            `💻 Command: \`${recent[0].test_command}\``,
            `🎯 Scope: \`${recent[0].scope}\``,
            `⏱️ Original duration: ${recent[0].duration_ms}ms`,
            "",
            recent[0].passed ? "✅ **Result: PASSED** (served from cache)" : "🔴 **Result: FAILED** (served from cache)",
            "",
            "💡 Use `force: true` to bypass cache and run tests again.",
          ].join("\n");
        }
      }
    } catch {}
  }
  return null; // No cached result
}

/**
 * 🚀 Run verification — SAFETY-GUARDED.
 *
 * 🔴 MUST ONLY be called from kuma_safety({ action: "verify" }) handler.
 * NEVER hook this into health checks, init, graph population, or any
 * automatic/internal pipeline.
 */
export async function runAutoVerification(options: VerificationOptions = {}): Promise<string> {
  const startTime = Date.now();
  const root = process.cwd();
  const scope = options.scope || "session-impact";
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;

  // 🚨 SAFETY GUARD: Check rate limits & concurrency
  const denial = checkRateLimit();
  if (denial) {
    return denial;
  }

  // ⏩ STALENESS CHECK: Return cached if recent
  if (!options.force) {
    const cached = await checkStaleness(scope);
    if (cached) return cached;
  }

  // 🏁 Proceed with verification
  _isRunning = true;
  const { runner, baseCommand } = detectTestRunner(root);

  // Scoping test files based on scope or session modifications
  let testFiles: string[] = [];
  const modified = sessionMemory.getModifiedFiles().map(f => f.filePath);

  if (options.scope) {
    const term = options.scope.toLowerCase();
    testFiles = modified.filter(f => f.toLowerCase().includes(term));
    if (testFiles.length === 0) {
      try {
        const { default: glob } = await import("fast-glob");
        const found = await glob([`**/*${term}*test*.*`, `**/*test*/*${term}*.*`], { cwd: root, ignore: ["node_modules/**", "dist/**"] });
        testFiles = found;
      } catch {}
    }
  } else {
    testFiles = modified.filter(f => f.includes(".test.") || f.includes(".spec.") || f.includes("_test."));
  }

  let fullCommand = baseCommand;
  if (testFiles.length > 0 && runner === "npm") {
    fullCommand = `${baseCommand} -- ${testFiles.map(f => `"${f}"`).join(" ")}`;
  }

  return new Promise<string>((resolve) => {
    // 🔴 Execute with timeout, tracking child process for kill-switch
    const child = exec(fullCommand, { cwd: root, timeout: timeoutMs }, async (error, stdout, stderr) => {
      const durationMs = Date.now() - startTime;
      const rawOutput = (stdout + "\n" + stderr).trim();
      const passed = !error;

      // Truncate long output for memory persistence
      const truncatedOutput = rawOutput.length > 2000 ? rawOutput.substring(rawOutput.length - 2000) : rawOutput;

      await saveVerification(scope, runner, fullCommand, passed, truncatedOutput, durationMs);

      // Update safety guards
      _isRunning = false;
      _lastCompletedAt = Date.now();
      _callHistory.push(Date.now());
      // Trim call history to prevent memory leak
      while (_callHistory.length > 100) _callHistory.shift();
      _currentProcess = null;

      const statusSymbol = passed ? "✅" : "🔴";
      const summaryHeader = `${statusSymbol} **Verification ${passed ? "PASSED" : "FAILED"}**\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

      const details = [
        summaryHeader,
        `🛠️ **Runner**: \`${runner}\``,
        `💻 **Command**: \`${fullCommand}\``,
        `🎯 **Scope**: \`${scope}\`${testFiles.length > 0 ? ` (${testFiles.length} file(s) matched)` : ""}`,
        `⏱️ **Duration**: ${durationMs}ms`,
        "",
      ];

      if (!passed) {
        details.push("⚠️ **Verification failed!** Please fix test failures before shipping.");
        if (error && error.killed) {
          details.push(`⏰ **Process was killed after ${timeoutMs}ms timeout**`);
        }
        details.push("```text");
        details.push(rawOutput.substring(0, 1500));
        details.push("```");
      } else {
        details.push("🎉 All scoped tests passed!");
        if (rawOutput) {
          details.push("```text");
          details.push(rawOutput.substring(0, 800));
          details.push("```");
        }
      }

      resolve(details.join("\n"));
    });

    // Store reference for kill-switch
    _currentProcess = child;
    _isRunning = true;

    // ⏰ Hard timeout safety net (in case child process hangs)
    const killTimer = setTimeout(() => {
      if (_currentProcess && !_currentProcess.killed) {
        try {
          // Kill process group (negative PID kills all children)
          const childPid = _currentProcess.pid;
          if (childPid) {
            try { process.kill(-childPid, "SIGKILL"); } catch {}
            try { _currentProcess.kill("SIGKILL"); } catch {}
          }
        } catch {}
      }
    }, timeoutMs + 5000); // Kill 5s after timeout

    // Clean up the kill timer on completion
    child.on("close", () => {
      clearTimeout(killTimer);
    });
  });
}
