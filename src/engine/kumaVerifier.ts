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
const DEFAULT_TIMEOUT_MS = 30_000;

export function getRunningVerificationPid(): number | null {
  return _currentProcess?.pid ?? null;
}

export function detectTestRunner(root = process.cwd()): { runner: string; baseCommand: string } {
  const pkgPath = path.join(root, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      if (pkg.scripts && pkg.scripts.test) {
        if (fs.existsSync(path.join(root, "pnpm-lock.yaml"))) return { runner: "pnpm", baseCommand: "pnpm test" };
        if (fs.existsSync(path.join(root, "yarn.lock"))) return { runner: "yarn", baseCommand: "yarn test" };
        return { runner: "npm", baseCommand: "npm test" };
      }
    } catch {}
  }
  if (fs.existsSync(path.join(root, "pytest.ini")) || fs.existsSync(path.join(root, "pyproject.toml"))) return { runner: "pytest", baseCommand: "pytest" };
  if (fs.existsSync(path.join(root, "Cargo.toml"))) return { runner: "cargo", baseCommand: "cargo test" };
  if (fs.existsSync(path.join(root, "go.mod"))) return { runner: "go", baseCommand: "go test ./..." };
  if (fs.existsSync(path.join(root, "Makefile"))) return { runner: "make", baseCommand: "make test" };
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
  return { runner: "unknown", baseCommand: "npm test || echo 'No test runner configured'" };
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
    const { runner, baseCommand } = detectTestRunner(root);

    let testFiles: string[] = [];
    const modified = sessionMemory.getModifiedFiles().map(f => f.filePath);

    if (options.scope) {
      const term = options.scope.toLowerCase();
      testFiles = modified.filter(f => f.toLowerCase().includes(term));
      if (testFiles.length === 0) {
        try {
          const { default: glob } = await import("fast-glob");
          testFiles = await glob([`**/*${term}*test*.*`, `**/*test*/*${term}*.*`], { cwd: root, ignore: ["node_modules/**", "dist/**"] });
        } catch {}
      }
    } else {
      testFiles = modified.filter(f => f.includes(".test.") || f.includes(".spec.") || f.includes("_test."));
    }

    let fullCommand = baseCommand;
    if (testFiles.length > 0 && runner === "npm") {
      fullCommand = `${baseCommand} -- ${testFiles.map(f => `"${f}"`).join(" ")}`;
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
        const passed = !error;
        const truncatedOutput = rawOutput.length > 2000 ? rawOutput.substring(rawOutput.length - 2000) : rawOutput;

        await saveVerification(scope, runner, fullCommand, passed, truncatedOutput, durationMs);

        // Release lock & state
        _localRunning = false;
        _currentProcess = null;
        releaseFileLock(root);
        clearInterval(heartbeatTimer);

        const statusSymbol = passed ? "✅" : "🔴";
        const lines = [
          `${statusSymbol} **Verification ${passed ? "PASSED" : "FAILED"}**`,
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
          "",
          `🛠️ **Runner**: \`${runner}\``,
          `💻 **Command**: \`${fullCommand}\``,
          `🎯 **Scope**: \`${scope}\`${testFiles.length > 0 ? ` (${testFiles.length} file(s) matched)` : ""}`,
          `⏱️ **Duration**: ${durationMs}ms`,
          "",
        ];

        if (!passed) {
          lines.push("⚠️ **Verification failed!** Please fix test failures before shipping.");
          if (error && (error as any).killed) {
            lines.push(`⏰ **Process was killed after ${timeoutMs}ms timeout**`);
          }
          lines.push("```text", rawOutput.substring(0, 1500), "```");
        } else {
          lines.push("🎉 All scoped tests passed!");
          if (rawOutput) lines.push("```text", rawOutput.substring(0, 800), "```");
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
