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

  // 4. Recording enforcement — detect if agent hasn't recorded anything
  const recordingSummary = sessionMemory.getRecordingSummary();
  if (check === "all" || check === "drift") {
    const readCalls = stats.toolCalls.filter(
      (c: any) => c.toolName === "read" || c.toolName === "grep" || c.toolName === "glob" || c.toolName === "smart_file_picker"
    ).length;

    // CRITICAL: 10+ tool calls with 0 recordings = blocking warning
    if (stats.toolCallCount >= 10 && !recordingSummary.hasAnyRecordings) {
      warnings.push({
        severity: "high",
        pattern: "no-recordings-critical",
        message: `🚫 BLOCKING: ${stats.toolCallCount} tool calls with 0 knowledge recordings. You are wasting future sessions by not recording.`,
        suggestion: "STOP. Record now:\n- kuma_memory({ action: 'research_save', scope: '<file>' }) after reading files\n- kuma_memory({ action: 'gotcha', scope: '<file>', content: '<bug>' }) when finding bugs\n- kuma_memory({ action: 'arch_flow', content: 'domain: <X> | hops: <file1> → <file2>' }) when tracing flows",
      });
    }
    // WARNING: 5+ tool calls with 0 recordings = medium warning
    else if (stats.toolCallCount >= 5 && !recordingSummary.hasAnyRecordings) {
      warnings.push({
        severity: "medium",
        pattern: "no-recordings",
        message: `${stats.toolCallCount} tool calls made but 0 knowledge recordings. Agent is not building persistent knowledge.`,
        suggestion: "Record findings after reading files. arch_flow + gotcha are exponential value.",
      });
    }
    // HINT: Agent read files but didn't record
    else if (readCalls >= 3 && recordingSummary.researchSaves === 0) {
      warnings.push({
        severity: "low",
        pattern: "read-without-record",
        message: `${readCalls} file reads but 0 research_save calls. Reading without recording = wasted context.`,
        suggestion: "After reading unfamiliar files: kuma_memory({ action: 'research_save', scope: '<file>' })",
      });
    }
    // GOOD: Agent is recording
    if (recordingSummary.total > 0) {
      // Positive reinforcement
    }

    // Auto-gotcha reminder — detect error patterns
    const errorCalls = stats.toolCalls.filter(
      (c: any) => c.toolName === "execute_safe_command" && JSON.stringify(c.params).includes("error")
    ).length;
    if (errorCalls >= 2 && recordingSummary.gotchas === 0) {
      warnings.push({
        severity: "medium",
        pattern: "error-without-gotcha",
        message: `${errorCalls} error encounters but 0 gotchas recorded. Errors = future gotchas.`,
        suggestion: "Record gotchas for bugs you encounter:\nkuma_memory({ action: 'gotcha', scope: '<file>', content: '<what went wrong>', status: 'high' })",
      });
    }

    // Auto-arch_flow reminder — detect flow tracing (multiple file reads in sequence)
    if (readCalls >= 4 && recordingSummary.archFlows === 0) {
      warnings.push({
        severity: "low",
        pattern: "trace-without-arch-flow",
        message: `${readCalls} file reads (possible flow tracing) but 0 arch_flows recorded. Flow knowledge dissipates fast.`,
        suggestion: "After tracing a flow, record it:\nkuma_memory({ action: 'arch_flow', content: 'domain: <Name> | hops: <file1> → <file2> → <file3>' })",
      });
    }

    // Auto-feature reminder — detect when agent explores multiple related files (possible feature discovery)
    if (readCalls >= 5 && recordingSummary.features === 0) {
      warnings.push({
        severity: "low",
        pattern: "explore-without-feature",
        message: `${readCalls} file reads but 0 features recorded. High-level module understanding helps future sessions.`,
        suggestion: "After exploring a module/feature, record it:\nkuma_memory({ action: 'feature', title: '<FeatureName>', content: 'description', scope: 'file1.ts,file2.ts' })",
      });
    }
  }

  // 5. Context snapshot
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

  // Add recording summary to output
  const metricsSummary = sessionMemory.getMetricsSummary();
  const reportWithRecordings = {
    ...report,
    recordings: {
      archFlows: recordingSummary.archFlows,
      gotchas: recordingSummary.gotchas,
      decisions: recordingSummary.decisions,
      researchSaves: recordingSummary.researchSaves,
      total: recordingSummary.total,
    },
    metrics: {
      filesRead: metricsSummary.filesRead,
      filesEdited: metricsSummary.filesEdited,
      researchTimeSaved: metricsSummary.researchTimeSavedFormatted,
      sessionDuration: metricsSummary.sessionDuration,
    },
  };

  return JSON.stringify(reportWithRecordings, null, 2);
}
