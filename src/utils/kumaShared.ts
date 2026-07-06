import { sessionMemory } from "../engine/sessionMemory.js";
import { execSync } from "node:child_process";
import { getProjectRoot } from "./pathValidator.js";
import type { GuardWarning } from "../guards/antiPatternDetector.js";

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
    hasRunTests: toolCalls.some((c: any) => c.toolName === "execute_safe_test"),
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
  const editCalls = toolCalls.filter(
    (c: any) => c.toolName === "precise_diff_editor" || c.toolName === "batch_file_writer",
  ).length;
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
    return "Remove patch scripts and use precise_diff_editor for all file modifications";
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
    return "Use smart_grep for code search instead of bash grep";
  }
  if (warnings.some((w) => w.pattern === "excessive-edits") || editCalls > 10) {
    return "Consider if refactoring can be simplified — fewer files = fewer bugs";
  }
  if (!goal) {
    return "No goal set — use goal parameter or setGoal to track intent";
  }
  if (modifiedFiles === 0) {
    return "Start by exploring what exists before writing code";
  }
  return "On track — continue with current approach";
}

/** Count edit-type tool calls */
export function countEditCalls(toolCalls: Array<Record<string, unknown>>): number {
  return toolCalls.filter(
    (c: any) => c.toolName === "precise_diff_editor" || c.toolName === "batch_file_writer",
  ).length;
}
