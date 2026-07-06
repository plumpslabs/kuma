import { sessionMemory } from "../engine/sessionMemory.js";
import { detectAllAntiPatterns, type GuardWarning } from "../guards/antiPatternDetector.js";
import { saveSnapshot, formatSnapshot } from "../engine/contextSnapshot.js";
import {
  getSessionStats,
  getGitDiffStat,
  getUnresolvedCount,
  buildDriftMessages,
} from "../utils/kumaShared.js";

interface GuardParams {
  check?: "all" | "anti-pattern" | "loop" | "drift" | "context";
  goal?: string;
}

interface GuardReport {
  timestamp: string;
  onTrack: boolean;
  warnings: GuardWarning[];
  drifts: string[];
  suggestion: string;
  stats: {
    goal: string;
    modifiedFiles: number;
    toolCalls: number;
    unresolvedFailures: number;
    hasLoop: boolean;
    hasRunTests: boolean;
  };
}

export async function handleKumaGuard(params: GuardParams): Promise<string> {
  const { check = "all", goal: inputGoal } = params;
  sessionMemory.recordToolCall("kuma_guard", { check, goal: inputGoal });

  const stats = getSessionStats(inputGoal);

  // 1. Anti-pattern detection
  const warnings: GuardWarning[] = [];
  if (check === "all" || check === "anti-pattern") {
    warnings.push(...detectAllAntiPatterns());
  }

  // 2. Loop detection
  const loop = check === "all" || check === "loop"
    ? sessionMemory.detectLoop()
    : { isLooping: false };

  if (loop.isLooping) {
    warnings.push({
      severity: "high",
      pattern: "tool-loop",
      message: (loop as any).message ?? "Detected potential tool call loop",
      suggestion: "Switch approach — try reading the file first with smart_file_picker",
    });
  }

  // 3. Drift detection
  const drifts: string[] = [];
  if (check === "all" || check === "drift") {
    const unresolvedCount = getUnresolvedCount(stats.failedFiles);
    const gitStat = getGitDiffStat();
    const editCalls = stats.toolCalls.filter(
      (c: any) => c.toolName === "precise_diff_editor" || c.toolName === "batch_file_writer",
    ).length;

    drifts.push(...buildDriftMessages(
      stats.modifiedFiles.length,
      stats.hasRunTests,
      unresolvedCount,
      gitStat,
    ));

    if (stats.modifiedFiles.length > 0 && !stats.hasRunTests) {
      warnings.push({
        severity: "medium",
        pattern: "no-test-after-edit",
        message: `${stats.modifiedFiles.length} file(s) modified without running tests`,
        suggestion: "Run execute_safe_test({ task: \"typecheck\" }) to verify changes",
      });
    }

    if (editCalls > 5) {
      warnings.push({
        severity: "low",
        pattern: "excessive-edits",
        message: `${editCalls} file operations in a row`,
        suggestion: "Consider if all edits are needed. Run tests before making more changes.",
      });
    }
  }

  // 4. Context snapshot
  if (check === "context") {
    const snapshot = saveSnapshot(stats.goal);
    if (!snapshot) {
      return "⚠️ Could not create context snapshot. The .kuma directory might not be accessible.";
    }
    return formatSnapshot(snapshot);
  }

  // 5. Build report
  const hasWarnings = warnings.length > 0;
  const hasDrifts = drifts.length > 0;
  const onTrack = !hasWarnings && !hasDrifts;

  // Build suggestion matching original kumaGuard priority order
  let suggestion: string;
  if (warnings.some((w) => w.severity === "high" && w.pattern === "script-patching")) {
    suggestion = "Remove patch scripts and use precise_diff_editor for all file modifications";
  } else if (warnings.some((w) => w.pattern === "tool-loop")) {
    suggestion = "Switch approach — current tool is not making progress";
  } else if (warnings.some((w) => w.pattern === "no-test-after-edit")) {
    suggestion = "Run tests to verify your changes before continuing";
  } else if (warnings.some((w) => w.pattern === "bash-grep")) {
    suggestion = "Use smart_grep for code search instead of bash grep";
  } else if (warnings.some((w) => w.pattern === "excessive-edits")) {
    suggestion = "Pause and review: are all these edits necessary?";
  } else if (!stats.goal) {
    suggestion = "No goal set — use goal parameter or setGoal to track intent";
  } else {
    suggestion = "On track — continue with current approach";
  }

  const report: GuardReport = {
    timestamp: new Date().toISOString(),
    onTrack,
    warnings,
    drifts,
    suggestion,
    stats: {
      goal: stats.goal,
      modifiedFiles: stats.modifiedFiles.length,
      toolCalls: stats.toolCallCount,
      unresolvedFailures: getUnresolvedCount(stats.failedFiles),
      hasLoop: loop.isLooping,
      hasRunTests: stats.hasRunTests,
    },
  };

  return JSON.stringify(report, null, 2);
}
