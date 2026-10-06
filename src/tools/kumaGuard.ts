import { sessionMemory } from "../engine/sessionMemory.js";
import { detectAllAntiPatterns, type GuardWarning } from "../guards/antiPatternDetector.js";
import { saveSnapshot, formatSnapshot } from "../engine/contextSnapshot.js";
import {
  getSessionStats,
  getGitDiffStat,
  getUncommittedFiles,
  hasVerificationEvidence,
  getUnresolvedCount,
  buildDriftMessages,
  getPrioritySuggestion,
  countEditCalls,
  isEditTool,
  isReadTool,
  isBashTool,
} from "../utils/kumaShared.js";

interface GuardParams {
  check?: "all" | "anti-pattern" | "loop" | "drift" | "context" | "architecture";
  goal?: string;
}

interface GuardReport {
  timestamp: string;
  onTrack: boolean;
  warnings: GuardWarning[];
  drifts: string[];
  /** Informational notes — never flip onTrack (issue #34). */
  info: string[];
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

  // 1b. Architecture boundary check
  if (check === "all" || check === "architecture") {
    try {
      const { checkArchitectureBoundaries } = await import("../guards/architectureGuard.js");
      const modifiedPaths = stats.modifiedFiles.map((f: any) => f.filePath);
      const violations = await checkArchitectureBoundaries(modifiedPaths.length > 0 ? modifiedPaths : undefined);
      for (const v of violations) {
        warnings.push({
          severity: v.severity,
          pattern: `arch-boundary:${v.rule}`,
          message: `Architecture violation in ${v.sourceFile}: ${v.targetImport}`,
          suggestion: v.suggestion,
        });
      }
    } catch {}
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
      suggestion: "Switch approach — try reading the file first with your native read/search tools",
    });
  }

  // 3. Drift detection (issue #34: committed branch state is NOT drift;
  // only uncommitted working-tree edits count, and in-session verification
  // includes test runs via the agent's own Bash, seen in the hook log)
  const drifts: string[] = [];
  const info: string[] = [];
  let verified = stats.hasRunTests;
  let uncommittedModifiedCount = stats.modifiedFiles.length;
  if (check === "all" || check === "drift") {
    const unresolvedCount = getUnresolvedCount(stats.failedFiles);
    const gitStat = getGitDiffStat();
    const editCalls = stats.toolCalls.filter((c: any) => isEditTool(c.toolName)).length;
    verified = stats.hasRunTests || hasVerificationEvidence(stats.toolCalls);
    const uncommitted = getUncommittedFiles();
    const modifiedPaths = stats.modifiedFiles.map((f: any) => String(f.filePath || f.path || ""));
    const uncommittedModified = modifiedPaths.filter((p) =>
      [...uncommitted].some((u) => u === p || u.endsWith(p) || p.endsWith(u)),
    );
    const committedOnly = modifiedPaths.length - uncommittedModified.length;
    uncommittedModifiedCount = uncommittedModified.length;

    drifts.push(...buildDriftMessages(
      uncommittedModified.length,
      verified,
      unresolvedCount,
      gitStat,
    ));
    if (committedOnly > 0 && uncommittedModified.length === 0) {
      info.push(`${committedOnly} file(s) differ from base branch but are committed — legitimate feature state, not drift (no action needed)`);
    }
    if (verified && uncommittedModified.length > 0) {
      info.push(`Verification already ran in-session (test/typecheck evidence found) — no re-run demanded`);
    }

    if (uncommittedModified.length > 0 && !verified) {
      warnings.push({
        severity: "medium",
        pattern: "no-test-after-edit",
        message: `${uncommittedModified.length} uncommitted file(s) modified without running tests`,
        suggestion: "Run the project's test/typecheck command to verify changes",
      });
    }

    // Issue #36: test-weakening diff → escalate (high, always actionable)
    try {
      const { detectTestWeakening } = await import("../utils/kumaShared.js");
      const weakened = detectTestWeakening(modifiedPaths);
      for (const w of weakened) {
        warnings.push({
          severity: "high",
          pattern: "test-weakening",
          message: `Test-weakening diff detected: ${w} — assertions removed without replacement`,
          suggestion: "Restore removed assertions or justify why the weakened test still guards the behavior",
        });
      }
    } catch {}
    // Issue #41: doc-drift sensor (info only — bounded batch scan, never flips onTrack)
    try {
      const { scanDocDrift, formatDocDrift } = await import("../engine/docDrift.js");
      const { checked, drifted, skipped } = scanDocDrift();
      if (drifted.length > 0) {
        info.push(formatDocDrift(checked, drifted.slice(0, 5), skipped));
      }
    } catch {}
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
    const readCalls = stats.toolCalls.filter((c: any) => isReadTool(c.toolName)).length;

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
      (c: any) => isBashTool(c.toolName) && JSON.stringify(c.params).includes("error")
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
        pattern: "explore-without-arch_flow",
        message: `${readCalls} file reads but 0 arch_flows recorded. Consider recording the flow with arch_flow.`,
        suggestion: "After tracing a flow, record it:\nkuma_memory({ action: 'arch_flow', content: 'domain: <Name> | hops: <file1> → <file2> → <file3>' })",
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
  // Issue #36: auto-downtier rules over the FP budget before reporting.
  try {
    const { recordGuardFlag, getDowntieredRules, demoteSeverity } = await import("../engine/guardLedger.js");
    for (const w of warnings) {
      try { await recordGuardFlag(w.pattern); } catch {}
    }
    const downtiered = await getDowntieredRules();
    if (downtiered.size > 0) {
      for (const w of warnings) {
        if (downtiered.has(w.pattern) && (w.severity === "high" || w.severity === "medium")) {
          w.severity = demoteSeverity(w.severity) as typeof w.severity;
          w.message = `🔻 [auto-downtiered: rule over FP budget] ${w.message}`;
        }
      }
    }
  } catch {}
  const hasWarnings = warnings.length > 0;
  const hasDrifts = drifts.length > 0;
  const onTrack = !hasWarnings && !hasDrifts;

  // Single source of truth for suggestions (see getPrioritySuggestion in kumaShared)
  const suggestion = getPrioritySuggestion(
    stats.goal,
    warnings,
    loop.isLooping,
    getUnresolvedCount(stats.failedFiles),
    uncommittedModifiedCount,
    verified,
    countEditCalls(stats.toolCalls),
  );

  const report: GuardReport = {
    timestamp: new Date().toISOString(),
    onTrack,
    warnings,
    drifts,
    info,
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
