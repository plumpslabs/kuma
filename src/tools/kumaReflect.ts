import {
  getSessionStats,
  getGitDiffStat,
  getUnresolvedDetails,
  checkLadderViolations,
  buildDriftMessages,
  getPrioritySuggestion,
} from "../utils/kumaShared.js";

interface ReflectParams {
  goal?: string;
}

export async function handleReflect(params: ReflectParams): Promise<string> {
  const stats = getSessionStats(params.goal);

  const unresolved = getUnresolvedDetails(stats.failedFiles);
  const gitStat = getGitDiffStat(5000);
  const ladderViolations = checkLadderViolations(stats.toolCalls, stats.modifiedFiles, stats.hasRunTests);
  const drifts = buildDriftMessages(
    stats.modifiedFiles.length,
    stats.hasRunTests,
    unresolved.length,
    gitStat,
    stats.loopMessage,
  );

  const onTrack = !stats.hasLoop && unresolved.length === 0 && (stats.modifiedFiles.length === 0 || stats.hasRunTests);

  const suggestion = getPrioritySuggestion(
    stats.goal,
    [],
    stats.hasLoop,
    unresolved.length,
    stats.modifiedFiles.length,
    stats.hasRunTests,
    stats.toolCalls.filter(
      (c: any) => c.toolName === "precise_diff_editor" || c.toolName === "batch_file_writer",
    ).length,
  );

  return JSON.stringify(
    {
      onTrack,
      ...(drifts.length > 0 ? { drift: drifts.join("; ") } : {}),
      ...(ladderViolations.length > 0 ? { ladderViolations } : {}),
      suggestion,
      stats: {
        goal: stats.goal,
        modifiedFiles: stats.modifiedFiles.length,
        toolCalls: stats.toolCallCount,
        unresolvedFailures: unresolved.length,
        hasLoop: stats.hasLoop,
        hasRunTests: stats.hasRunTests,
      },
    },
    null,
    2,
  );
}
