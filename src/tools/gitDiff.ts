import child_process from "node:child_process";
import { getProjectRoot } from "../utils/pathValidator.js";
import { sessionMemory } from "../engine/sessionMemory.js";

// ============================================================
// GIT DIFF — Structured diff output
// ============================================================

interface GitDiffParams {
  filePath?: string;
  staged?: boolean;
  contextLines?: number;
  baseRef?: string;
  targetRef?: string;
}

export async function handleGitDiff(params: GitDiffParams): Promise<string> {
  const { filePath, staged = false, contextLines = 3, baseRef, targetRef } = params;
  const root = getProjectRoot();

  try {
    // Build git diff command
    let command = "git diff";

    // Staged vs unstaged
    if (staged) {
      command += " --cached";
    }

    // Context lines
    command += " -U" + Math.max(1, Math.min(contextLines, 20));

    // Ref range
    if (baseRef) {
      command += " " + baseRef;
      if (targetRef) {
        command += ".." + targetRef;
      }
    }

    // File filter
    if (filePath) {
      command += ' -- "' + filePath + '"';
    }

    const stdout = child_process.execSync(command, {
      cwd: root,
      encoding: "utf-8",
      maxBuffer: 2 * 1024 * 1024,
    });

    sessionMemory.recordToolCall("git_diff", { filePath, staged, baseRef, targetRef });

    if (!stdout.trim()) {
      if (staged) {
        return 'No staged changes found' + (filePath ? ' for "' + filePath + '".' : ".");
      }
      return 'No uncommitted changes found' + (filePath ? ' for "' + filePath + '".' : ".");
    }

    // Parse diff into structured output
    const lines = stdout.split("\n");
    const result: string[] = [];
    let currentFile = "";
    let fileChanges = 0;
    let totalAdditions = 0;
    let totalDeletions = 0;

    result.push("**Git Diff**");
    if (staged) result.push("Staged changes");
    if (baseRef) result.push(baseRef + (targetRef ? ".." + targetRef : ""));
    if (filePath) result.push("File: " + filePath);
    result.push("");

    for (const line of lines) {
      // New file in diff
      const fileMatch = line.match(/^diff --git a\/(.+) b\/(.+)$/);
      if (fileMatch) {
        if (currentFile && fileChanges > 0) {
          result.push("  " + fileChanges + " chunk(s) modified");
          result.push("");
        }
        currentFile = fileMatch[1];
        fileChanges = 0;
        result.push("--- " + currentFile + " ---");
        continue;
      }

      // File mode changes
      if (line.startsWith("new file mode")) {
        result.push("  [New file]");
        continue;
      }
      if (line.startsWith("deleted file mode")) {
        result.push("  [Deleted file]");
        continue;
      }
      if (line.startsWith("rename from") || line.startsWith("rename to")) {
        continue;
      }
      if (line.startsWith("index ")) {
        continue;
      }
      if (line.startsWith("--- ") || line.startsWith("+++ ")) {
        continue;
      }

      // Chunk header
      const chunkMatch = line.match(/^@@ -(\d+),?\d* \+(\d+),?\d* @@(.*)$/);
      if (chunkMatch) {
        fileChanges++;
        const desc = chunkMatch[3] ? " -- " + chunkMatch[3].trim() : "";
        result.push("  Chunk " + fileChanges + ": L" + chunkMatch[1] + " -> L" + chunkMatch[2] + desc);
        continue;
      }

      // Diff content
      if (line.startsWith("+") && !line.startsWith("+++")) {
        totalAdditions++;
        result.push("  + " + line.substring(1).substring(0, 150));
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        totalDeletions++;
        result.push("  - " + line.substring(1).substring(0, 150));
      }
      // Context lines skipped for brevity
    }

    // Last file summary
    if (currentFile && fileChanges > 0) {
      result.push("  " + fileChanges + " chunk(s) modified");
    }

    // Overall summary
    result.push("");
    result.push("-----------------------------");
    result.push("Summary: +" + totalAdditions + " / -" + totalDeletions + " lines across " + result.filter(l => l.startsWith("--- ")).length + " file(s)");
    result.push("");
    result.push("Use precise_diff_editor to revert specific changes if needed.");

    return result.join("\n");

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not a git repository")) {
      return "Not a git repository. Git diff requires an initialized git repo.\nRun `git init` to get started.";
    }
    return "Error: Failed to get git diff: " + msg;
  }
}
