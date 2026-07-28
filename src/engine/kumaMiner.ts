import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import fastGlob from "fast-glob";
import { recordDecisionLog } from "./kumaDb.js";
import { recordDecision } from "./kumaMemory.js";

export interface MineOptions {
  scope?: string;
  since?: string;
  confirm?: boolean;
  limit?: number;
}

export interface MinedCandidate {
  id: string;
  type: "git_commit" | "inline_comment";
  title: string;
  context: string;
  rationale: string;
  filePath?: string;
  lineNumber?: number;
  commitHash?: string;
  pattern: string;
}

/**
 * Mine historical decision signals from git log and inline comments.
 */
export async function mineHistoricalDecisions(options: MineOptions = {}): Promise<string> {
  const root = process.cwd();
  const limit = options.limit || 15;
  const candidates: MinedCandidate[] = [];

  // 1. Scan Git Log
  try {
    const sinceFlag = options.since ? `--since="${options.since}"` : `--since="1 year"`;
    // 🔴 SAFETY: 15s timeout to prevent hanging on large repos
    const gitCmd = `git log ${sinceFlag} -n 100 --pretty=format:"%h|%an|%ad|%s" --date=short`;
    const gitOutput = execSync(gitCmd, { cwd: root, encoding: "utf-8", timeout: 15000 });

    const keywords = ["fix", "revert", "hack", "workaround", "urgent", "hotfix", "don't touch", "temporary", "deprecated", "workaround"];
    const lines = gitOutput.split("\n").filter(Boolean);

    // 🔴 OPTIMIZATION: Batch all matching commit hashes first, then run single git diff
    const matchingHashes: Array<{ hash: string; author: string; date: string; subject: string; keyword: string }> = [];
    for (const line of lines) {
      const parts = line.split("|");
      if (parts.length < 4) continue;
      const [hash, author, date, subject] = parts;
      const lowerSubj = subject.toLowerCase();
      const matchedKeyword = keywords.find((kw) => lowerSubj.includes(kw));
      if (matchedKeyword) {
        matchingHashes.push({ hash, author, date, subject, keyword: matchedKeyword });
        if (matchingHashes.length >= limit) break;
      }
    }

    // 🔴 OPTIMIZATION: Single git command for all matching commits instead of N+1
    let changedFilesMap = new Map<string, string>();
    if (matchingHashes.length > 0) {
      try {
        const hashesStr = matchingHashes.map(h => h.hash).join(" ");
        const batchOutput = execSync(
          `git show --name-only --oneline ${hashesStr} 2>/dev/null | head -200`,
          { cwd: root, encoding: "utf-8", timeout: 10000, maxBuffer: 256 * 1024 }
        );
        let currentHash = "";
        const files: string[] = [];
        for (const line of batchOutput.split("\n")) {
          if (matchingHashes.find(h => line.startsWith(h.hash))) {
            if (currentHash && files.length > 0) {
              changedFilesMap.set(currentHash, files.slice(0, 3).join(", "));
            }
            currentHash = line.split(" ")[0];
            files.length = 0;
          } else if (line.trim() && !line.startsWith("diff")) {
            files.push(line.trim());
          }
        }
        if (currentHash && files.length > 0) {
          changedFilesMap.set(currentHash, files.slice(0, 3).join(", "));
        }
      } catch { /* batch failed — fallback to per-commit (rare) */ }
    }

    for (const { hash, author, date, subject, keyword: matchedKeyword } of matchingHashes) {
      let changedFiles = changedFilesMap.get(hash) || "";
      // Fallback: single execSync if batch failed
      if (!changedFiles) {
        try {
          changedFiles = execSync(`git show --name-only --oneline ${hash}`, { cwd: root, encoding: "utf-8", timeout: 5000 })
            .split("\n")
            .slice(1)
            .filter(Boolean)
            .slice(0, 3)
            .join(", ");
        } catch {}

        candidates.push({
          id: `git-${hash}`,
          type: "git_commit",
          title: `[Git Commit] ${subject}`,
          context: `Commit ${hash} by ${author} on ${date}.${changedFiles ? ` Files touched: ${changedFiles}` : ""}`,
          rationale: `Historical signal pattern "${matchedKeyword}" found in commit message.`,
          commitHash: hash,
          pattern: matchedKeyword,
        });

        if (candidates.length >= limit) break;
      }
    }
  } catch {
    // Git log unavailable or failed
  }

  // 2. Scan Inline Comments
  if (candidates.length < limit) {
    try {
      const scopePattern = options.scope ? `**/*${options.scope}*.*` : "**/*.{ts,js,py,go,rs,java,md}";
      const files = await fastGlob(scopePattern, {
        cwd: root,
        ignore: ["node_modules/**", "dist/**", ".kuma/**", ".git/**", "coverage/**"],
        onlyFiles: true,
      });

      const commentPatterns = [
        { tag: "HACK", regex: /\/\/\s*HACK:?\s*(.*)|#\s*HACK:?\s*(.*)/i },
        { tag: "FIXME", regex: /\/\/\s*FIXME:?\s*(.*)|#\s*FIXME:?\s*(.*)/i },
        { tag: "TODO", regex: /\/\/\s*TODO:?\s*(.*)|#\s*TODO:?\s*(.*)/i },
        { tag: "XXX", regex: /\/\/\s*XXX:?\s*(.*)|#\s*XXX:?\s*(.*)/i },
        { tag: "WARNING", regex: /\/\/\s*WARNING:?\s*(.*)|#\s*WARNING:?\s*(.*)/i },
      ];

      for (const file of files.slice(0, 50)) {
        if (candidates.length >= limit) break;
        const fullPath = path.join(root, file);
        if (!fs.existsSync(fullPath)) continue;

        const content = fs.readFileSync(fullPath, "utf-8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const l = lines[i];
          for (const cp of commentPatterns) {
            const match = cp.regex.exec(l);
            if (match) {
              const text = (match[1] || match[2] || l).trim();
              candidates.push({
                id: `comment-${file}-${i + 1}`,
                type: "inline_comment",
                title: `[${cp.tag}] ${file}:${i + 1}`,
                context: `Inline comment marker "${cp.tag}" found in file "${file}" at line ${i + 1}.`,
                rationale: text || l.trim(),
                filePath: file,
                lineNumber: i + 1,
                pattern: cp.tag,
              });
              if (candidates.length >= limit) break;
            }
          }
          if (candidates.length >= limit) break;
        }
      }
    } catch {}
  }

  // Auto-record if confirm is true
  if (options.confirm && candidates.length > 0) {
    let recordedCount = 0;
    for (const c of candidates) {
      await recordDecisionLog({
        title: c.title,
        context: c.context,
        rationale: c.rationale,
        outcome: `Mined from ${c.type} (${c.pattern})`,
        status: "proposed",
      });
      await recordDecision({
        title: c.title,
        context: c.context,
        options: [],
        rationale: c.rationale,
        outcome: `Mined from ${c.type}`,
        timestamp: new Date().toISOString(),
      });
      recordedCount++;
    }
    return `⛏️ **Mined & Recorded ${recordedCount} Decisions** into decision log & graph.\nUse \`kuma_memory({ action: 'decision_log' })\` to view all active & proposed decisions.`;
  }

  // Format Proposal Mode Output
  if (candidates.length === 0) {
    return "⛏️ **Decision Mining**: No significant historical decision markers (HACK/FIXME/git fix) found for the requested scope.";
  }

  const report: string[] = [
    `⛏️ **Decision Mining Candidates** (${candidates.length} candidate(s) found)`,
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "Review these draft historical decisions mined from git history & inline comments:",
    "",
  ];

  candidates.forEach((c, idx) => {
    report.push(`**${idx + 1}. ${c.title}**`);
    report.push(`  • **Type**: \`${c.type}\` | **Signal**: \`${c.pattern}\``);
    report.push(`  • **Context**: ${c.context}`);
    report.push(`  • **Rationale**: ${c.rationale}`);
    report.push("");
  });

  report.push("💡 *To accept and record these mined decisions into knowledge graph & decision.md:*");
  report.push(`Run: \`kuma_memory({ action: 'mine', confirm: true${options.scope ? `, scope: '${options.scope}'` : ""} })\``);

  return report.join("\n");
}
