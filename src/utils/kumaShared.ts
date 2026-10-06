import { sessionMemory } from "../engine/sessionMemory.js";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "./pathValidator.js";
import type { GuardWarning } from "../guards/antiPatternDetector.js";

// ============================================================
// NATIVE TOOL DETECTION — the agent uses its own native tools
// (edit/write/read/grep/bash/test). These helpers keep guard and
// anti-pattern logic provider-agnostic.
// ============================================================

export function isEditTool(toolName: string): boolean {
  const n = (toolName || "").toLowerCase();
  return n.includes("edit") || n.includes("write") || n.includes("patch") || n.includes("apply") || n.includes("replace");
}

export function isTestTool(toolName: string): boolean {
  const n = (toolName || "").toLowerCase();
  return n.includes("test") || n.includes("typecheck");
}

export function isReadTool(toolName: string): boolean {
  const n = (toolName || "").toLowerCase();
  return n.includes("read") || n.includes("grep") || n.includes("glob") || n.includes("search") || n.includes("list");
}

export function isBashTool(toolName: string): boolean {
  const n = (toolName || "").toLowerCase();
  return n === "bash" || n.startsWith("bash") || n.includes("command") || n.includes("shell") || n.includes("terminal");
}

// ============================================================
// KUMA SHARED — Extracted common logic from kumaGuard & kumaReflect
// ============================================================

export interface SessionStats {
  goal: string;
  modifiedFiles: Array<Record<string, unknown>>;
  toolCalls: Array<Record<string, unknown>>;
  toolCallCount: number;
  failedFiles: Array<{ task: string; failures: Array<{ resolved: boolean; error: string }> }>;
  hasLoop: boolean;
  loopMessage?: string;
  hasRunTests: boolean;
}

export interface UnresolvedDetail {
  task: string;
  error: string;
}

/** Collect all session data in one call */
export function getSessionStats(inputGoal?: string): SessionStats {
  const summary = sessionMemory.getSummary();
  const goal = inputGoal || (summary.currentGoal as string) || "";
  const modifiedFiles = sessionMemory.getModifiedFiles() as unknown as Array<Record<string, unknown>>;
  const toolCalls = sessionMemory.getToolCallHistory(50) as unknown as Array<Record<string, unknown>>;
  const failedFiles = sessionMemory.getFailedFiles() as Array<{ task: string; failures: Array<{ resolved: boolean; error: string }> }>;
  const loop = sessionMemory.detectLoop();

  return {
    goal,
    modifiedFiles,
    toolCalls,
    toolCallCount: toolCalls.length,
    failedFiles,
    hasLoop: loop.isLooping,
    loopMessage: (loop as any).message,
    hasRunTests: toolCalls.some((c: any) => isTestTool(c.toolName)),
  };
}

/** Run git diff --stat, return empty string on error */
export function getGitDiffStat(timeout = 3000): string {
  try {
    const root = getProjectRoot();
    return execSync("git diff --stat", {
      cwd: root,
      encoding: "utf-8",
      timeout,
    }).trim();
  } catch {
    return "";
  }
}

/**
 * Issue #34 — uncommitted working-tree files only (drift-relevant).
 * Committed-on-branch diffs are legitimate feature state, NOT drift.
 */
export function getUncommittedFiles(timeout = 3000): Set<string> {
  const files = new Set<string>();
  try {
    const root = getProjectRoot();
    const porcelain = execSync("git status --porcelain", {
      cwd: root, encoding: "utf-8", timeout, stdio: ["pipe", "pipe", "pipe"],
    });
    if (!porcelain.trim()) return files;
    // XY codes are positional — never trim whole lines (see mapBackbone gotcha).
    for (const rawLine of porcelain.split("\n")) {
      const line = rawLine.replace(/\s+$/, "");
      if (!line) continue;
      const m = line.match(/^.{3}(.+?)(?:\s+->\s+.+)?$/);
      if (m && m[1]) files.add(m[1].trim().replace(/^"|"$/g, ""));
    }
  } catch { /* not a git repo → empty = nothing to exempt */ }
  return files;
}

/**
 * Issue #34 — committed-on-branch files (informational only, never drift).
 * Compares current branch tip against merge-base with default branch.
 */
export function getBranchCommittedFiles(timeout = 5000): { base: string; files: Set<string> } {
  const files = new Set<string>();
  let base = "";
  try {
    const root = getProjectRoot();
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: root, encoding: "utf-8", timeout, stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    const baseRef = execSync(
      `git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null || echo origin/${branch === "main" || branch === "master" ? "HEAD" : "main"}`,
      { cwd: root, encoding: "utf-8", timeout, stdio: ["pipe", "pipe", "pipe"] },
    ).trim().replace("refs/remotes/", "");
    const mergeBase = execSync(`git merge-base HEAD ${baseRef} 2>/dev/null || git rev-list --max-parents=0 HEAD`, {
      cwd: root, encoding: "utf-8", timeout, stdio: ["pipe", "pipe", "pipe"],
    }).trim().split("\n")[0];
    base = baseRef;
    if (mergeBase) {
      const out = execSync(`git diff --name-only ${mergeBase} HEAD`, {
        cwd: root, encoding: "utf-8", timeout, stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      for (const f of out.split("\n")) if (f.trim()) files.add(f.trim());
    }
  } catch { /* best-effort */ }
  return { base, files };
}

const TEST_COMMAND_PATTERN = /(npm|pnpm|yarn|bun)\s+(test|run\s+(test|typecheck|check|lint))|pytest|go\s+test|cargo\s+test|jest|vitest|typecheck|tsc\s+--noEmit/i;

/**
 * Issue #34 — did verification already happen in-session?
 * Agents run tests via their OWN native Bash (invisible to kuma toolCalls),
 * but `kuma hook pre-bash` logs every command to .kuma/injections.jsonl —
 * so scan it for test/typecheck invocations (last 24h) as evidence.
 */
export function hasVerificationEvidence(toolCalls: Array<Record<string, unknown>>): boolean {
  if (toolCalls.some((c: any) => isTestTool(c.toolName as string))) return true;
  return hasVerificationInHookLog();
}

function hasVerificationInHookLog(hours = 24): boolean {
  try {
    const fp = path.join(getProjectRoot(), ".kuma", "injections.jsonl");
    if (!fs.existsSync(fp)) return false;
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    const lines = fs.readFileSync(fp, "utf-8").split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if ((entry.at || 0) < cutoff) continue;
        const cmd = String(entry.command || "");
        if (cmd && TEST_COMMAND_PATTERN.test(cmd)) return true;
      } catch { /* skip corrupt line */ }
    }
  } catch { /* non-critical */ }
  return false;
}

/** Count unresolved failures */
export function getUnresolvedCount(failedFiles: Array<{ failures: Array<{ resolved: boolean }> }>): number {
  let count = 0;
  for (const f of failedFiles) {
    for (const ff of f.failures) {
      if (!ff.resolved) count++;
    }
  }
  return count;
}

/** Get detailed unresolved failures (for reflect) */
export function getUnresolvedDetails(
  failedFiles: Array<{ task: string; failures: Array<{ resolved: boolean; error: string }> }>,
): UnresolvedDetail[] {
  const result: UnresolvedDetail[] = [];
  for (const f of failedFiles) {
    for (const ff of f.failures) {
      if (!ff.resolved) {
        result.push({ task: f.task, error: ff.error.substring(0, 200) });
      }
    }
  }
  return result;
}

/** Check ladder (excessive edits) violations */
export function checkLadderViolations(
  toolCalls: Array<Record<string, unknown>>,
  modifiedFiles: Array<Record<string, unknown>>,
  hasRunTests: boolean,
): string[] {
  const violations: string[] = [];
  const editCalls = toolCalls.filter((c: any) => isEditTool(c.toolName)).length;
  if (editCalls > 5) {
    violations.push(`${editCalls} file ops in a row — consider if all are needed`);
  }
  if (modifiedFiles.length > 5 && !hasRunTests) {
    violations.push(`${modifiedFiles.length} files modified without verification`);
  }
  return violations;
}

/** Build drift messages array */
export function buildDriftMessages(
  modifiedFiles: number,
  hasRunTests: boolean,
  unresolvedCount: number,
  gitStat: string,
  loopMessage?: string,
): string[] {
  const drifts: string[] = [];
  if (modifiedFiles > 0 && !hasRunTests) {
    drifts.push(`${modifiedFiles} file(s) edited but no test run`);
  }
  if (loopMessage) {
    drifts.push(loopMessage);
  }
  if (unresolvedCount > 0) {
    drifts.push(`${unresolvedCount} unresolved failure(s)`);
  }
  if (gitStat) {
    drifts.push(`Git diff: ${gitStat}`);
  }
  return drifts;
}

/** Priority-based suggestion selection */
export function getPrioritySuggestion(
  goal: string,
  warnings: GuardWarning[],
  hasLoop: boolean,
  unresolvedCount: number,
  modifiedFiles: number,
  hasRunTests: boolean,
  editCalls: number,
): string {
  if (warnings.some((w) => w.severity === "high" && w.pattern === "script-patching")) {
    return "Remove patch scripts and use your native edit tools for all file modifications";
  }
  if (hasLoop) {
    return "Switch approach — current tool is not making progress";
  }
  if (warnings.some((w) => w.pattern === "no-test-after-edit") || (modifiedFiles > 0 && !hasRunTests)) {
    return "Run tests to verify your changes before continuing";
  }
  if (unresolvedCount > 0) {
    return "Fix unresolved failures before continuing";
  }
  if (warnings.some((w) => w.pattern === "bash-grep")) {
    return "Use your native grep tool for code search instead of bash grep";
  }
  if (warnings.some((w) => w.pattern === "excessive-edits") || editCalls > 10) {
    return "Consider if refactoring can be simplified — fewer files = fewer bugs";
  }
  if (!goal) {
    return "No goal set — use goal parameter or setGoal to track intent";
  }
  // Issue #34: verified work (or committed-only branch state) is not
  // "nothing happened" — don't tell an agent with green checks to explore.
  if (modifiedFiles === 0 && !hasRunTests) {
    return "Start by exploring what exists before writing code";
  }
  return "On track — continue with current approach";
}

/** Count edit-type tool calls */
export function countEditCalls(toolCalls: Array<Record<string, unknown>>): number {
  return toolCalls.filter((c: any) => isEditTool(c.toolName)).length;
}

const TEST_FILE_PATTERN = /(\.test\.|\.spec\.|_test\.|__tests__|\/tests?\/)/i;
const ASSERTION_PATTERN = /\b(expect|assert|toBe|toEqual|toContain|toMatch|ok\(|equal\(|deepEqual\()\b/;

/**
 * Issue #36 behavioral eval: "test-weakening diff → escalate".
 * If a test file's working-tree diff REMOVES assertion lines, the change
 * weakens the safety net itself → needs escalation, not silence.
 */
export function detectTestWeakening(files: string[], root?: string): string[] {
  const weakened: string[] = [];
  let cwd = "";
  try {
    cwd = root || getProjectRoot();
  } catch { return []; }
  for (const f of files) {
    if (!TEST_FILE_PATTERN.test(f)) continue;
    try {
      const diff = execSync(`git diff --unified=0 -- "${f}"`, {
        cwd, encoding: "utf-8", timeout: 4000, stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      if (!diff) continue;
      const removed = diff.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---"));
      const removedAssertions = removed.filter((l) => ASSERTION_PATTERN.test(l)).length;
      if (removedAssertions > 0 && removed.length > 0 && removedAssertions / removed.length >= 0.5) {
        weakened.push(`${f} (−${removedAssertions} assertion(s))`);
      }
    } catch { /* not a git repo or file untracked → skip */ }
  }
  return weakened;
}
