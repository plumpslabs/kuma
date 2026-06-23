import { sessionMemory } from "../engine/sessionMemory.js";
import { execSync } from "node:child_process";
import { getProjectRoot } from "../utils/pathValidator.js";

interface ReflectParams {
  goal?: string;
}

export async function handleReflect(params: ReflectParams): Promise<string> {
  const summary = sessionMemory.getSummary();
  const goal = params.goal || (summary.currentGoal as string) || "";

  const modifiedFiles = sessionMemory.getModifiedFiles();
  const toolCalls = sessionMemory.getToolCallHistory(50);
  const failedFiles = sessionMemory.getFailedFiles();
  const loop = sessionMemory.detectLoop();

  const unresolved: Array<{ task: string; error: string }> = [];
  for (const f of failedFiles) {
    for (const ff of f.failures) {
      if (!ff.resolved) {
        unresolved.push({ task: f.task, error: ff.error.substring(0, 200) });
      }
    }
  }

  const hasRunTests = toolCalls.some(
    (c) => c.toolName === "execute_safe_test"
  );

  let gitStat = "";
  try {
    const root = getProjectRoot();
    gitStat = execSync("git diff --stat", {
      cwd: root,
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
  } catch {}

  const drifts: string[] = [];
  if (modifiedFiles.length > 0 && !hasRunTests) {
    drifts.push(`${modifiedFiles.length} file(s) edited but no test run`);
  }
  if (loop.isLooping) {
    drifts.push(loop.message!);
  }
  if (unresolved.length > 0) {
    drifts.push(`${unresolved.length} unresolved failure(s)`);
  }
  if (gitStat) {
    drifts.push(`Git diff: ${gitStat}`);
  }

  const ladderViolations: string[] = [];
  const editCalls = toolCalls.filter(
    (c) =>
      c.toolName === "precise_diff_editor" ||
      c.toolName === "batch_file_writer"
  ).length;
  if (editCalls > 5) {
    ladderViolations.push(
      `${editCalls} file ops in a row — consider if all are needed`
    );
  }
  if (modifiedFiles.length > 5 && !hasRunTests) {
    ladderViolations.push(
      `${modifiedFiles.length} files modified without verification`
    );
  }

  const onTrack = !loop.isLooping && unresolved.length === 0 && (modifiedFiles.length === 0 || hasRunTests);

  let suggestion: string;
  if (!goal) {
    suggestion = "No goal set — use goal parameter or setGoal";
  } else if (loop.isLooping) {
    suggestion = "Switch approach — current tool is not making progress";
  } else if (unresolved.length > 0) {
    suggestion = "Fix unresolved failures before continuing";
  } else if (modifiedFiles.length > 0 && !hasRunTests) {
    suggestion = "Run tests to verify changes";
  } else if (modifiedFiles.length === 0 && !toolCalls.some(c => ["smart_file_picker", "smart_grep"].includes(c.toolName))) {
    suggestion = "Start by exploring what exists before writing code";
  } else if (editCalls > 10) {
    suggestion = "Consider if refactoring can be simplified — fewer files = fewer bugs";
  } else {
    suggestion = "On track";
  }

  return JSON.stringify(
    {
      onTrack,
      ...(drifts.length > 0 ? { drift: drifts.join("; ") } : {}),
      ...(ladderViolations.length > 0 ? { ladderViolations } : {}),
      suggestion,
      stats: {
        goal,
        modifiedFiles: modifiedFiles.length,
        toolCalls: toolCalls.length,
        unresolvedFailures: unresolved.length,
        hasLoop: loop.isLooping,
        hasRunTests,
      },
    },
    null,
    2
  );
}
