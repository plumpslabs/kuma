// ============================================================
// KUMA VERIFIER — On-Demand Test Verifier (v2.3.5)
// ============================================================
// 🔴 CRITICAL: This module MUST ONLY be called via explicit MCP tool call.
// NEVER auto-triggered from health checks, init, or any internal hook.
//
// CROSS-PROCESS SAFETY (v2.3.5):
//   PRIMARY:   File-based lock using atomic fs.mkdirSync() — works across
//              all processes sharing the same filesystem (even different
//              Kuma instances in the same project).
//   SECONDARY: In-memory guard for fast intra-process check.
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { exec, type ChildProcess } from "node:child_process";
import { saveVerification, getLatestVerifications } from "./kumaDb.js";
import { sessionMemory } from "./sessionMemory.js";

export interface VerificationOptions {
  scope?: string;
  target?: string;
  command?: string;
  force?: boolean;
  timeoutMs?: number;
}

// ============================================================
// FILE-BASED LOCK — Atomic mkdir for cross-process coordination
// ============================================================

const LOCK_DIR_NAME = ".kuma/verifier.lock";

function getLockDir(root = process.cwd()): string {
  return path.resolve(root, LOCK_DIR_NAME);
}

function getPidFile(root = process.cwd()): string {
  return path.join(getLockDir(root), "pid");
}

/**
 * Try to acquire a cross-process file lock using atomic mkdir.
 * Returns true if lock acquired, false if another instance holds it.
 */
function acquireFileLock(root: string): boolean {
  const lockDir = getLockDir(root);
  try {
    fs.mkdirSync(lockDir, { recursive: false }); // atomic: fails if exists
    fs.writeFileSync(getPidFile(root), String(process.pid), "utf-8");
    return true;
  } catch {
    try {
      if (fs.existsSync(getPidFile(root))) {
        const pid = parseInt(fs.readFileSync(getPidFile(root), "utf-8"), 10);
        try {
          process.kill(pid, 0); // signal 0 = check existence
          return false; // Lock valid — process alive
        } catch {
          // Process dead — stale lock, force acquire
          fs.rmSync(lockDir, { recursive: true, force: true });
          return acquireFileLock(root);
        }
      }
    } catch {}
    try {
      fs.rmSync(lockDir, { recursive: true, force: true });
      return acquireFileLock(root);
    } catch {
      return false;
    }
  }
}

function releaseFileLock(root: string): void {
  try { fs.rmSync(getLockDir(root), { recursive: true, force: true }); } catch {}
}

// ============================================================
// IN-MEMORY GUARDS (per-process, fast path)
// ============================================================

let _localRunning = false;
let _currentProcess: ChildProcess | null = null;

const STALE_RESULT_MS = 300_000;
const DEFAULT_TIMEOUT_MS = 60_000;

// 🔴 RUNAWAY DETECTION: Sliding window — max 3 calls per 5 minutes
const RUNAWAY_WINDOW_MS = 300_000;  // 5 minutes
const RUNAWAY_MAX_CALLS = 3;
const _verifyCallTimestamps: number[] = [];

function checkRunaway(): string | null {
  const now = Date.now();
  // Prune timestamps outside window
  while (_verifyCallTimestamps.length > 0 && _verifyCallTimestamps[0] < now - RUNAWAY_WINDOW_MS) {
    _verifyCallTimestamps.shift();
  }
  // Check if runaway threshold exceeded
  if (_verifyCallTimestamps.length >= RUNAWAY_MAX_CALLS) {
    const oldestInWindow = _verifyCallTimestamps[0];
    const waitMs = RUNAWAY_WINDOW_MS - (now - oldestInWindow);
    const waitSec = Math.ceil(waitMs / 1000);
    return `⛔ **Runaway protection active** — ${RUNAWAY_MAX_CALLS}+ verify calls in the last 5 minutes. Please wait ${waitSec}s before trying again.\n💡 This prevents resource exhaustion (CPU/RAM) from uncontrolled test spawning.`;
  }
  _verifyCallTimestamps.push(now);
  return null;
}

export function getRunningVerificationPid(): number | null {
  return _currentProcess?.pid ?? null;
}

export function detectTestRunner(root = process.cwd()): { runner: string; baseCommand: string; isJest?: boolean; isVitest?: boolean } {
  const pkgPath = path.join(root, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      const isJest = Boolean(
        pkg.devDependencies?.jest ||
        pkg.dependencies?.jest ||
        (pkg.scripts?.test && pkg.scripts.test.includes("jest")) ||
        fs.existsSync(path.join(root, "jest.config.js")) ||
        fs.existsSync(path.join(root, "jest.config.ts")) ||
        fs.existsSync(path.join(root, "jest.config.mjs")) ||
        fs.existsSync(path.join(root, "jest.config.json"))
      );
      const isVitest = Boolean(
        pkg.devDependencies?.vitest ||
        pkg.dependencies?.vitest ||
        (pkg.scripts?.test && pkg.scripts.test.includes("vitest")) ||
        fs.existsSync(path.join(root, "vitest.config.ts")) ||
        fs.existsSync(path.join(root, "vitest.config.js")) ||
        fs.existsSync(path.join(root, "vitest.config.mjs"))
      );

      if (pkg.scripts && pkg.scripts.test) {
        if (fs.existsSync(path.join(root, "pnpm-lock.yaml"))) return { runner: "pnpm", baseCommand: "pnpm test", isJest, isVitest };
        if (fs.existsSync(path.join(root, "yarn.lock"))) return { runner: "yarn", baseCommand: "yarn test", isJest, isVitest };
        return { runner: "npm", baseCommand: "npm test", isJest, isVitest };
      }
    } catch {}
  }
  if (fs.existsSync(path.join(root, "pytest.ini")) || fs.existsSync(path.join(root, "pyproject.toml"))) return { runner: "pytest", baseCommand: "pytest" };
  if (fs.existsSync(path.join(root, "Cargo.toml"))) return { runner: "cargo", baseCommand: "cargo test" };
  if (fs.existsSync(path.join(root, "go.mod"))) return { runner: "go", baseCommand: "go test ./..." };
  if (fs.existsSync(path.join(root, "Makefile"))) {
    try {
      const makefileContent = fs.readFileSync(path.join(root, "Makefile"), "utf-8");
      // Check if Makefile has a 'test' target (line starting with 'test:')
      const hasTestTarget = /^test:/m.test(makefileContent) || /^\s+test:/.test(makefileContent);
      if (hasTestTarget) return { runner: "make", baseCommand: "make test" };
    } catch {}
    // Makefile exists but no test target — don't use make
  }
  if (fs.existsSync(path.join(root, "package.json"))) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));
      if (pkg.dependencies || pkg.devDependencies) {
        if (fs.existsSync(path.join(root, "tsconfig.json"))) return { runner: "tsc", baseCommand: "npx tsc --noEmit" };
        const srcDir = path.join(root, "src");
        if (fs.existsSync(srcDir)) return { runner: "node", baseCommand: `node -c "${srcDir}/**/*.js" 2>/dev/null || node --check $(find src -name '*.js' 2>/dev/null | head -5)` };
      }
    } catch {}
  }
  return { runner: "unknown", baseCommand: "" };
}

function checkAllowed(root: string): string | null {
  if (_localRunning) return "⏳ Verification already in progress (this instance).";
  if (!acquireFileLock(root)) return "⏳ Another Kuma instance is running verification.";
  return null;
}

async function checkStaleness(scope: string): Promise<string | null> {
  if (scope !== "session-impact" && scope !== undefined) return null;
  try {
    const recent = await getLatestVerifications(1);
    if (recent.length === 0) return null;
    const age = Date.now() - (recent[0].created_at * 1000);
    if (age >= STALE_RESULT_MS) return null;
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
  } catch { return null; }
}

/**
 * 🚀 Run verification — CROSS-PROCESS SAFETY GUARDED.
 * 🔴 MUST ONLY be called from kuma_safety({ action: "verify" }) handler.
 */
export async function runAutoVerification(options: VerificationOptions = {}): Promise<string> {
  const startTime = Date.now();
  const root = process.cwd();
  const scope = options.scope || "session-impact";
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;

  // 🚨 SAFETY GUARD: Cross-process file lock
  const denial = checkAllowed(root);
  if (denial) return denial;

  // 🚨 SAFETY GUARD: Runaway detection (sliding window >3 calls/5min)
  const runawayBlock = checkRunaway();
  if (runawayBlock) {
    releaseFileLock(root);
    return runawayBlock;
  }

  try {
    // ⏩ STALENESS CHECK (release lock if cache hit)
    if (!options.force) {
      const cached = await checkStaleness(scope);
      if (cached) {
        releaseFileLock(root);
        return cached;
      }
    }

    // 🏁 Proceed
    _localRunning = true;
    const { runner, baseCommand, isJest, isVitest } = detectTestRunner(root);

    // 📭 NO TESTS — Honest reporting instead of fake pass
    if (runner === "unknown" || !baseCommand) {
      _localRunning = false;
      releaseFileLock(root);
      const durationMs = Date.now() - startTime;
      const output = "ℹ️ No test framework detected. Install Jest, Vitest, pytest, or similar to enable verification.";
      await saveVerification(scope, "none", "none", true, output, durationMs);
      return [
        `⚪ **Verification: NO TESTS**`,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        "",
        `🛠️ **Runner**: \`none\` (no test framework detected)`,
        `🎯 **Scope**: \`${scope}\``,
        `⏱️ **Duration**: ${durationMs}ms`,
        "",
        "ℹ️ No test framework detected. Install Jest, Vitest, pytest, or similar to enable verification.",
        "",
        "💡 **Tip:** This is NOT a pass — it means nothing was verified. Run your tests manually or install a test framework.",
      ].join("\n");
    }

    let fullCommand = baseCommand;
    let testFiles: string[] = [];
    let modified = sessionMemory.getModifiedFiles().map(f => f.filePath);

    // If sessionMemory has no modified files recorded, check git status/diff
    if (modified.length === 0) {
      try {
        const { execSync } = await import("node:child_process");
        const gitDiff = execSync("git diff --name-only HEAD", { encoding: "utf-8", timeout: 3000, cwd: root }).trim();
        if (gitDiff) {
          modified = gitDiff.split("\n").map(f => f.trim()).filter(Boolean);
        }
      } catch {}
    }

    // 1. Custom command override if specified
    const targetScope = (options.scope || options.target || "").trim();
    if (options.command) {
      const cmd = options.command.trim();
      const isTestCmd = /^(npm|pnpm|yarn|bun|npx|pytest|cargo|go|make|jest|vitest)\s+/i.test(cmd);
      if (isTestCmd) {
        fullCommand = cmd;
      }
    } else {
      // 2. Workspace-aware test scoping: run tests for affected packages in monorepo
      let workspaceScoped = false;
      try {
        const { getWorkspaceInfo, getAffectedPackages } = await import("./workspaceIntelligence.js");
        const wsInfo = await getWorkspaceInfo(root);
        if (wsInfo.isWorkspace && modified.length > 0 && !targetScope) {
          const affected = getAffectedPackages(modified, wsInfo);
          if (affected.affectedTestCommands.length > 0) {
            fullCommand = affected.affectedTestCommands[0];
            workspaceScoped = true;
          }
        }
      } catch {}

      // 3. Targeted test files scoping (if workspace filter not applied)
      if (!workspaceScoped) {
        if (targetScope && targetScope !== "session-impact") {
          const resolved = path.resolve(root, targetScope);
          // Case A: targetScope is directly a test file that exists on disk
          if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
            testFiles = [path.relative(root, resolved)];
          } else {
            // Case B: Filter in session/git modified files
            const term = targetScope.toLowerCase();
            testFiles = modified.filter(f => f.toLowerCase().includes(term));
            // Case C: Search via fast-glob
            if (testFiles.length === 0) {
              try {
                const { default: glob } = await import("fast-glob");
                const baseName = path.basename(targetScope, path.extname(targetScope));
                testFiles = await glob([
                  `**/*${baseName}*.test.*`,
                  `**/*${baseName}*.spec.*`,
                  `**/*${term}*test*.*`,
                  `**/*test*/*${term}*.*`,
                  `**/${targetScope}`,
                ], { cwd: root, ignore: ["node_modules/**", "dist/**", ".git/**"] });
              } catch {}
            }
          }
        } else {
          const directTests = modified.filter(f => f.includes(".test.") || f.includes(".spec.") || f.includes("_test."));
          if (directTests.length > 0) {
            testFiles = directTests;
          } else if (modified.length > 0) {
            // Attempt to locate counterpart tests for modified source files
            try {
              const { default: glob } = await import("fast-glob");
              for (const f of modified.slice(0, 5)) {
                const base = path.basename(f, path.extname(f));
                const matches = await glob([`**/*${base}*.test.*`, `**/*${base}*.spec.*`], { cwd: root, ignore: ["node_modules/**", "dist/**"] });
                testFiles.push(...matches);
              }
            } catch {}
          }
        }

        if (testFiles.length > 0 && (runner === "npm" || runner === "pnpm" || runner === "yarn" || runner === "bun")) {
          fullCommand = `${baseCommand} -- ${Array.from(new Set(testFiles)).map(f => `"${f}"`).join(" ")}`;
        } else if (testFiles.length === 0 && modified.length > 0 && isJest && (runner === "npm" || runner === "pnpm" || runner === "yarn" || runner === "bun")) {
          // Smart Scoping: Jest supports --findRelatedTests to execute only tests covering modified files
          const relFiles = Array.from(new Set(modified.slice(0, 15))).map(f => `"${f}"`).join(" ");
          fullCommand = `${baseCommand} -- --findRelatedTests ${relFiles}`;
        } else if (testFiles.length === 0 && modified.length > 0 && isVitest && (runner === "npm" || runner === "pnpm" || runner === "yarn" || runner === "bun")) {
          // Smart Scoping: Vitest supports related filter
          const relFiles = Array.from(new Set(modified.slice(0, 15))).map(f => `"${f}"`).join(" ");
          fullCommand = `${baseCommand} -- related ${relFiles} --run`;
        } else if (testFiles.length > 0 && runner === "pytest") {
          fullCommand = `pytest ${Array.from(new Set(testFiles)).map(f => `"${f}"`).join(" ")}`;
        }
      }
    }

    return await new Promise<string>((resolve) => {
      // ⏰ Hard timeout — kill child if it hangs
      const killTimer = setTimeout(() => {
        if (_currentProcess && !_currentProcess.killed) {
          try {
            const childPid = _currentProcess.pid;
            if (childPid) {
              try { process.kill(-childPid, "SIGKILL"); } catch {}
              try { _currentProcess.kill("SIGKILL"); } catch {}
            }
          } catch {}
        }
      }, timeoutMs + 5000);

      // 💓 Heartbeat: update PID file periodically
      const heartbeatTimer = setInterval(() => {
        if (getLockDir(root)) {
          try { fs.writeFileSync(getPidFile(root), String(process.pid), "utf-8"); } catch {}
        }
      }, 15_000);

      const child = exec(fullCommand, { cwd: root, timeout: timeoutMs }, async (error, stdout, stderr) => {
        const durationMs = Date.now() - startTime;
        const rawOutput = (stdout + "\n" + stderr).trim();
        let passed = !error;

        // 🚨 Detect fake passes — commands that succeed but didn't actually run tests
        const fakePassPatterns = [
          /Missing script.*test/i,
          /No test runner configured/i,
          /No tests found/i,
          /Cannot find.*test/i,
          /0 passing/i,
          /no test specified/i,
        ];
        if (passed && fakePassPatterns.some(p => p.test(rawOutput))) {
          passed = false; // Treat as NO_TESTS, not PASSED
        }
        const isNoTests = fakePassPatterns.some(p => p.test(rawOutput));
        const truncatedOutput = rawOutput.length > 2000 ? rawOutput.substring(rawOutput.length - 2000) : rawOutput;

        await saveVerification(scope, runner, fullCommand, passed, truncatedOutput, durationMs);

        // 🧠 AUTO-GOTCHA (P1): self-learning loop — repeated failures → gotcha.
        // Only real failures count; "no tests" and cached results do not.
        let autoGotchaMessage: string | null = null;
        if (scope !== "session-impact" && !isNoTests) {
          try {
            const { trackVerificationResult } = await import("./kumaAutoGotcha.js");
            const autoResult = await trackVerificationResult(scope, passed);
            if (autoResult.message) autoGotchaMessage = autoResult.message;
          } catch { /* non-critical */ }
        } else if (passed) {
          try {
            const { resetScopeFailures } = await import("./kumaAutoGotcha.js");
            resetScopeFailures(scope);
          } catch { /* non-critical */ }
        }

        // I1 (Roadmap): verification passed → close the loop on gotchas whose
        // file changed since recording (fix likely landed → mark resolved).
        if (passed && !isNoTests && scope !== "session-impact") {
          try {
            const { resolveGotchasForScope } = await import("./kumaGotchas.js");
            const { resolved } = await resolveGotchasForScope(scope);
            if (resolved > 0) autoGotchaMessage = `✅ ${resolved} gotcha(s) resolved automatically (verification passed after file changes).`;
          } catch { /* non-critical */ }
        }

        // Release lock & state
        _localRunning = false;
        _currentProcess = null;
        releaseFileLock(root);
        clearInterval(heartbeatTimer);

        const isTimedOut = Boolean(error && (error as any).killed);
        const statusSymbol = passed ? "✅" : (isTimedOut ? "⏱️" : "🔴");
        const statusTitle = passed ? "PASSED" : (isTimedOut ? "TIMED_OUT" : "FAILED");
        const lines = [
          `${statusSymbol} **Verification ${statusTitle}**`,
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
          "",
          `🛠️ **Runner**: \`${runner}\``,
          `💻 **Command**: \`${fullCommand}\``,
          `🎯 **Scope**: \`${scope}\`${testFiles.length > 0 ? ` (${testFiles.length} file(s) matched)` : ""}`,
          `⏱️ **Duration**: ${durationMs}ms`,
          "",
        ];

        if (!passed) {
          if (isNoTests) {
            lines[0] = `⚪ **Verification: NO TESTS**`;
            lines.push("ℹ️ No tests ran. Install Jest, Vitest, pytest, or similar to enable verification.");
          } else if (isTimedOut) {
            lines.push(`⏰ **Process was killed after ${timeoutMs}ms timeout (TIMED_OUT)**`);
            lines.push("ℹ️ Tests did not fail; the test execution exceeded the allotted timeout threshold.");
            lines.push(`💡 *Tip*: Run a specific test file via \`scope: 'tests/my-test.test.ts'\`, specify a custom command via \`command: '...' \`, or increase timeout via \`timeoutMs: ${Math.max(timeoutMs * 2, 120000)}\`.`);
            if (rawOutput) lines.push("```text", rawOutput.substring(0, 1500), "```");
          } else {
            lines.push("⚠️ **Verification failed!** Please fix test failures before shipping.");
            if (rawOutput) lines.push("```text", rawOutput.substring(0, 1500), "```");
          }
        } else {
          lines.push("🎉 All scoped tests passed!");
          if (rawOutput) lines.push("```text", rawOutput.substring(0, 800), "```");
        }

        if (autoGotchaMessage) {
          lines.push("", autoGotchaMessage);
        }

        resolve(lines.join("\n"));
      });

      _currentProcess = child;
      _localRunning = true;

      child.on("close", () => { clearTimeout(killTimer); });
    });
  } catch (err) {
    releaseFileLock(root);
    _localRunning = false;
    _currentProcess = null;
    return `❌ Verification failed with error: ${err}`;
  }
}
