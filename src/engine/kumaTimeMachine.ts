// ============================================================
// KUMA TIME MACHINE — Code evolution tracking (Phase 2.4)
// ============================================================
// Tracks how code evolves over time using git blame + git log.
// Maps functions/symbols to commits and provides timeline views.
//
// Key concepts:
//   - symbol timeline: when was a function created/modified
//   - commit context: why was a change made (commit message analysis)
//   - file evolution: how a file changed across versions
// ============================================================

import { execSync } from "node:child_process";
import { getProjectRoot } from "../utils/pathValidator.js";

interface SymbolCommit {
  commitHash: string;
  author: string;
  date: string;
  message: string;
  linesAdded: number;
  linesDeleted: number;
}

interface TimelineEntry {
  commitHash: string;
  author: string;
  date: string;
  message: string;
  lines: number;
  type: "created" | "modified" | "deleted";
}

/**
 * Get the git blame for a file and extract symbol->commit mapping.
 * Returns a map of line ranges to commit hashes.
 */
export function getBlameForFile(filePath: string): Array<{
  line: number;
  commitHash: string;
  author: string;
  date: string;
  content: string;
}> {
  const root = getProjectRoot();
  try {
    const output = execSync(
      `git blame --line-porcelain -- "${filePath}"`,
      { cwd: root, encoding: "utf-8", maxBuffer: 2 * 1024 * 1024, timeout: 10000 }
    );

    const lines: Array<{
      line: number;
      commitHash: string;
      author: string;
      date: string;
      content: string;
    }> = [];

    const chunks = output.split("\n");
    let currentCommit = "";
    let currentAuthor = "";
    let currentDate = "";
    let sourceLine = 0;

    for (const chunk of chunks) {
      // Line format: <commit-hash> <source-line> <result-line>
      const lineMatch = chunk.match(/^([a-f0-9]{40})\s+(\d+)\s+(\d+)/);
      if (lineMatch) {
        currentCommit = lineMatch[1];
        sourceLine = parseInt(lineMatch[3], 10);
        continue;
      }

      // author <name>
      if (chunk.startsWith("author ")) {
        currentAuthor = chunk.substring(7);
        continue;
      }

      // author-time <unix-timestamp>
      if (chunk.startsWith("author-time ")) {
        const ts = parseInt(chunk.substring(12), 10);
        currentDate = new Date(ts * 1000).toISOString();
        continue;
      }

      // The actual line content (falls through all metadata lines)
      if (chunk.startsWith("\t") && currentCommit) {
        lines.push({
          line: sourceLine,
          commitHash: currentCommit,
          author: currentAuthor,
          date: currentDate,
          content: chunk.substring(1),
        });
        currentCommit = "";
      }
    }

    return lines;
  } catch (err) {
    console.error(`[KumaTimeMachine] Failed to blame file "${filePath}": ${err}`);
    return [];
  }
}

/**
 * Get the commit history for a specific file.
 */
export function getFileHistory(filePath: string, maxCount: number = 20): SymbolCommit[] {
  const root = getProjectRoot();
  try {
    const output = execSync(
      `git log --follow --format="%H||%an||%ai||%s" --shortstat -- "${filePath}"`,
      { cwd: root, encoding: "utf-8", maxBuffer: 2 * 1024 * 1024, timeout: 10000 }
    );

    const entries: SymbolCommit[] = [];
    const blocks = output.split("\n\n");

    for (const block of blocks) {
      const lines = block.trim().split("\n");
      if (lines.length < 2) continue;

      const headerMatch = lines[0].match(/^([a-f0-9]+)\|\|(.+?)\|\|(.+?)\|\|(.+)/);
      if (!headerMatch) continue;

      // Parse shortstat: " 1 file changed, 5 insertions(+), 2 deletions(-)"
      const statLine = lines[1] || "";
      const addMatch = statLine.match(/(\d+) insertion/);
      const delMatch = statLine.match(/(\d+) deletion/);

      entries.push({
        commitHash: headerMatch[1],
        author: headerMatch[2],
        date: headerMatch[3],
        message: headerMatch[4],
        linesAdded: addMatch ? parseInt(addMatch[1], 10) : 0,
        linesDeleted: delMatch ? parseInt(delMatch[1], 10) : 0,
      });

      if (entries.length >= maxCount) break;
    }

    return entries;
  } catch (err) {
    console.error(`[KumaTimeMachine] Failed to get file history for "${filePath}": ${err}`);
    return [];
  }
}

/**
 * Get the evolution timeline for a specific function/symbol.
 * Uses git blame to find which lines belong to the symbol, then traces their history.
 */
export async function getSymbolTimeline(
  symbolName: string,
  filePath: string,
  symbolType: "function" | "class" | "interface" | "type" | "variable" = "function"
): Promise<TimelineEntry[]> {
  try {
    const blame = getBlameForFile(filePath);
    const pattern = getSymbolPattern(symbolName, symbolType);

    // Find lines that match the symbol definition
    const root = getProjectRoot();
    const content = execSync(`git show HEAD:"${filePath}"`, {
      cwd: root, encoding: "utf-8", maxBuffer: 2 * 1024 * 1024, timeout: 5000
    });

    const fileLines = content.split("\n");
    const symbolLineNumbers: number[] = [];

    for (let i = 0; i < fileLines.length; i++) {
      if (pattern.test(fileLines[i])) {
        symbolLineNumbers.push(i + 1); // 1-indexed for git blame
      }
    }

    if (symbolLineNumbers.length === 0) {
      return [];
    }

    // Get unique commits from blame lines for this symbol
    const commitMap = new Map<string, { author: string; date: string; lines: number }>();
    for (const b of blame) {
      if (symbolLineNumbers.includes(b.line)) {
        const existing = commitMap.get(b.commitHash) || { author: b.author, date: b.date, lines: 0 };
        existing.lines++;
        commitMap.set(b.commitHash, existing);
      }
    }

    // Get commit messages
    const entries: TimelineEntry[] = [];
    for (const [hash, data] of commitMap) {
      try {
        const msg = execSync(
          `git log -1 --format="%s" ${hash}`,
          { cwd: root, encoding: "utf-8", maxBuffer: 1024 * 1024, timeout: 3000 }
        ).trim();

        entries.push({
          commitHash: hash.substring(0, 8),
          author: data.author,
          date: data.date,
          message: msg,
          lines: data.lines,
          type: "modified",
        });
      } catch {}
    }

    // Sort by date ascending and mark earliest as "created"
    entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    if (entries.length > 0) {
      entries[0].type = "created";
    }

    return entries;
  } catch (err) {
    console.error(`[KumaTimeMachine] Failed to get timeline for "${symbolName}": ${err}`);
    return [];
  }
}

/**
 * Analyze commit messages for design decisions and rationale.
 */
export function analyzeCommitMessages(commits: SymbolCommit[]): {
  patterns: string[];
  decisions: Array<{ commit: string; decision: string }>;
} {
  const decisionPatterns = [
    /(?:migrat|refactor|redesign|rewrite|restructur)/i,
    /(?:because|reason|rationale|motivat|justif)/i,
    /(?:fix(?:es|ed)?\s+#?\d+|close[ds]?\s+#?\d+|resolve[ds]?\s+#?\d+)/i,
    /(?:add|implement|introduc|support|enable)/i,
    /(?:deprecat|remov|drop|delete)/i,
    /(?:bump|upgrade|update|downgrade)/i,
  ];

  const decisions: Array<{ commit: string; decision: string }> = [];
  const patternCount = new Map<string, number>();

  for (const commit of commits) {
    for (const pattern of decisionPatterns) {
      const match = commit.message.match(pattern);
      if (match) {
        const category = match[0].toLowerCase();
        patternCount.set(category, (patternCount.get(category) || 0) + 1);

        if (pattern.toString().includes("because|reason|rationale")) {
          decisions.push({
            commit: commit.commitHash.substring(0, 8),
            decision: commit.message,
          });
        }
        break;
      }
    }
  }

  // Sort by frequency
  const sorted = [...patternCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([p, c]) => `${p} (${c}x)`);

  return { patterns: sorted, decisions };
}

/**
 * Get symbol definition pattern from name and type.
 */
function getSymbolPattern(name: string, type: string): RegExp {
  switch (type) {
    case "function":
      return new RegExp(`(export\\s+)?(async\\s+)?function\\s+${escapeRegex(name)}(\\s|\\(|<)`);
    case "class":
      return new RegExp(`(export\\s+)?(abstract\\s+)?class\\s+${escapeRegex(name)}(\\s|\\{|<|extends|implements)`);
    case "interface":
      return new RegExp(`(export\\s+)?interface\\s+${escapeRegex(name)}(\\s|\\{|<|extends)`);
    case "type":
      return new RegExp(`(export\\s+)?type\\s+${escapeRegex(name)}\\s*=`);
    case "variable":
      return new RegExp(`(export\\s+)?(const|let|var)\\s+${escapeRegex(name)}\\s*(=|:)`);
    default:
      return new RegExp(escapeRegex(name));
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Format a symbol timeline as a human-readable string.
 */
export function formatTimeline(
  symbolName: string,
  filePath: string,
  timeline: TimelineEntry[],
  decisions: Array<{ commit: string; decision: string }>
): string {
  if (timeline.length === 0) {
    return `⏳ **No timeline found** for "${symbolName}" in "${filePath}".\n\nThe symbol may not exist in git history or the file may not be tracked by git.`;
  }

  const lines: string[] = [
    `🕰️ **Code Timeline** — ${symbolName}`,
    `📄 ${filePath}`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━`,
    "",
  ];

  // Evolution timeline
  lines.push("**Evolution:**");
  for (const entry of timeline) {
    const icon = entry.type === "created" ? "✨" : "🔧";
    const date = new Date(entry.date).toISOString().split("T")[0];
    lines.push(`  ${icon} ${date} — ${entry.message.substring(0, 80)}`);
    lines.push(`     ${entry.commitHash} by ${entry.author} (${entry.lines} line${entry.lines > 1 ? "s" : ""})`);
  }
  lines.push("");

  // Design decisions
  if (decisions.length > 0) {
    lines.push("**Design Decisions:**");
    for (const d of decisions) {
      lines.push(`  📝 ${d.commit}: ${d.decision.substring(0, 120)}`);
    }
    lines.push("");
  }

  // Commit patterns
  const history = getFileHistory(filePath, 50);
  const analysis = analyzeCommitMessages(history);
  if (analysis.patterns.length > 0) {
    lines.push("**Commit Patterns:**");
    for (const p of analysis.patterns) {
      lines.push(`  • ${p}`);
    }
    lines.push("");
  }

  lines.push(
    "💡 Use kuma_code_time_machine({ filePath }) to see file-level history.",
    "💡 Use git_log({ filePath }) to see raw commit history.",
  );

  return lines.join("\n");
}

/**
 * Format file-level history.
 */
export function formatFileHistory(filePath: string, history: SymbolCommit[]): string {
  if (history.length === 0) {
    return `⏳ **No history found** for "${filePath}".`;
  }

  const lines: string[] = [
    `🕰️ **File History** — ${filePath}`,
    `📜 ${history.length} commits`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━`,
    "",
  ];

  for (const commit of history) {
    const date = new Date(commit.date).toISOString().split("T")[0];
    const addSign = commit.linesAdded > 0 ? `+${commit.linesAdded}` : "";
    const delSign = commit.linesDeleted > 0 ? `-${commit.linesDeleted}` : "";
    const stat = [addSign, delSign].filter(Boolean).join(" / ");
    lines.push(`  ${date} [${commit.commitHash.substring(0, 8)}] ${commit.message.substring(0, 70)}`);
    if (stat) lines.push(`         ${stat} lines`);
  }

  const analysis = analyzeCommitMessages(history);
  if (analysis.patterns.length > 0) {
    lines.push("", "**Commit Pattern Distribution:**");
    for (const p of analysis.patterns) {
      lines.push(`  • ${p}`);
    }
  }

  return lines.join("\n");
}


