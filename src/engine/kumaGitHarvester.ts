// ============================================================
// KUMA GIT HARVESTER — Auto-Extract Decisions from Git (Pilar 5)
// ============================================================
// Automatically extracts commit messages and file diffs to create
// decision/gotcha nodes in the knowledge graph. Runs as a
// post-commit hook or can be triggered manually.
// ============================================================

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "../utils/pathValidator.js";

interface CommitInfo {
  hash: string;
  message: string;
  author: string;
  date: string;
  files: string[];
  insertions: number;
  deletions: number;
}

/**
 * Get the latest N commits from git.
 */
export function getRecentCommits(count: number = 5): CommitInfo[] {
  const root = getProjectRoot();
  try {
    const format = JSON.stringify({
      hash: "%H",
      message: "%s",
      author: "%an",
      date: "%ai",
    });
    const log = execSync(
      `git log -n ${count} --pretty=format:'${format.replace(/'/g, "'\\''")}' --name-only`,
      { cwd: root, encoding: "utf-8", timeout: 5000 }
    );

    const commits: CommitInfo[] = [];
    const entries = log.split("\n\n").filter(Boolean);

    for (const entry of entries) {
      const lines = entry.split("\n");
      if (lines.length < 1) continue;

      try {
        const meta = JSON.parse(lines[0]);
        const files = lines.slice(1).filter(f => f.trim() && !f.startsWith("commit "));

        // Get diff stats for this commit
        let insertions = 0;
        let deletions = 0;
        try {
          const stats = execSync(
            `git diff --shortstat ${meta.hash}^..${meta.hash}`,
            { cwd: root, encoding: "utf-8", timeout: 3000 }
          );
          const insMatch = stats.match(/(\d+) insertion/);
          const delMatch = stats.match(/(\d+) deletion/);
          if (insMatch) insertions = parseInt(insMatch[1], 10);
          if (delMatch) deletions = parseInt(delMatch[1], 10);
        } catch {}

        commits.push({
          hash: meta.hash?.substring(0, 8) || "",
          message: meta.message || "",
          author: meta.author || "",
          date: meta.date || "",
          files,
          insertions,
          deletions,
        });
      } catch {}
    }

    return commits;
  } catch {
    return [];
  }
}

/**
 * Detect significant commits that likely represent decisions or gotchas.
 * Criteria: >3 files changed, or specific keywords in message.
 */
export function detectSignificantCommits(commits: CommitInfo[]): {
  decisions: CommitInfo[];
  gotchas: CommitInfo[];
  regular: CommitInfo[];
} {
  const decisionKeywords = [
    "refactor", "migrate", "switch to", "replace", "use .* instead",
    "remove", "drop", "deprecate", "upgrade", "update to",
    "architect", "design", "implement", "add feature",
  ];

  const gotchaKeywords = [
    "fix", "bug", "hotfix", "patch", "workaround",
    "revert", "broken", "issue", "error", "crash",
    "race condition", "memory leak", "performance",
  ];

  const decisions: CommitInfo[] = [];
  const gotchas: CommitInfo[] = [];
  const regular: CommitInfo[] = [];

  for (const commit of commits) {
    const msg = commit.message.toLowerCase();
    const isLargeChange = commit.files.length > 3 || commit.insertions + commit.deletions > 100;

    const isDecision = decisionKeywords.some(kw => new RegExp(kw, "i").test(msg)) || isLargeChange;
    const isGotcha = gotchaKeywords.some(kw => new RegExp(kw, "i").test(msg));

    if (isDecision && !isGotcha) {
      decisions.push(commit);
    } else if (isGotcha) {
      gotchas.push(commit);
    } else {
      regular.push(commit);
    }
  }

  return { decisions, gotchas, regular };
}

/**
 * Auto-harvest recent git commits into the knowledge graph.
 * Creates decision and gotcha nodes from significant commits.
 */
export async function harvestGitHistory(options?: {
  commitCount?: number;
  dryRun?: boolean;
}): Promise<string> {
  const count = options?.commitCount || 10;
  const dryRun = options?.dryRun || false;

  const commits = getRecentCommits(count);
  if (commits.length === 0) {
    return "📭 No git commits found. Is this a git repository?";
  }

  const { decisions, gotchas } = detectSignificantCommits(commits);

  const lines: string[] = [
    "🐙 **Git Auto-Harvester**",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
    `📊 Scanned ${commits.length} commit(s)`,
    `⚖️ ${decisions.length} significant change(s) → decisions`,
    `⚠️ ${gotchas.length} fix/revert(s) → gotchas`,
    "",
  ];

  if (dryRun) {
    lines.push("**Dry Run — no nodes created:**");
    lines.push("");

    if (decisions.length > 0) {
      lines.push("**Potential Decisions:**");
      for (const c of decisions) {
        lines.push(`  ⚖️ ${c.hash} — ${c.message}`);
        lines.push(`     Files: ${c.files.length}, +${c.insertions}/-${c.deletions}`);
      }
      lines.push("");
    }

    if (gotchas.length > 0) {
      lines.push("**Potential Gotchas:**");
      for (const c of gotchas) {
        lines.push(`  ⚠️ ${c.hash} — ${c.message}`);
        lines.push(`     Files: ${c.files.join(", ")}`);
      }
      lines.push("");
    }

    lines.push("💡 Run without dryRun to create nodes.");
    return lines.join("\n");
  }

  // Create decision nodes
  let decisionCount = 0;
  for (const commit of decisions) {
    try {
      const { recordDecision } = await import("./kumaMemory.js");
      await recordDecision({
        title: commit.message,
        context: `Auto-harvested from git commit ${commit.hash}`,
        options: [],
        rationale: `Files changed: ${commit.files.slice(0, 5).join(", ")}${commit.files.length > 5 ? ` +${commit.files.length - 5} more` : ""}`,
        outcome: "implemented",
        timestamp: new Date(commit.date).toISOString(),
      });
      decisionCount++;
    } catch {}
  }

  // Create gotcha nodes
  let gotchaCount = 0;
  for (const commit of gotchas) {
    try {
      const { addGotcha } = await import("./kumaGotchas.js");
      const primaryFile = commit.files[0] || "unknown";
      await addGotcha({
        filePath: primaryFile,
        description: `Git commit ${commit.hash}: ${commit.message}`,
        severity: commit.message.toLowerCase().includes("revert") ? "high" : "medium",
        workaround: `See commit ${commit.hash} for details`,
      });
      gotchaCount++;
    } catch {}
  }

  lines.push(`✅ Harvested: ${decisionCount} decision(s), ${gotchaCount} gotcha(s)`);

  if (decisionCount + gotchaCount === 0) {
    lines.push("📭 No significant commits to harvest.");
  }

  return lines.join("\n");
}

/**
 * Install git post-commit hook for automatic harvesting.
 */
export function installGitHook(): string {
  const root = getProjectRoot();
  const hooksDir = path.join(root, ".git", "hooks");

  if (!fs.existsSync(hooksDir)) {
    return "⚠️ Not a git repository — no .git/hooks/ directory found.";
  }

  const hookPath = path.join(hooksDir, "post-commit");
  const hookContent = `#!/bin/bash
# Kuma auto-harvester hook (post-commit)
# Automatically extracts decisions and gotchas from commits
if command -v npx &> /dev/null; then
  npx -y @plumpslabs/kuma --hook post-commit 2>/dev/null || true
fi
`;

  if (fs.existsSync(hookPath)) {
    // Check if already installed
    const existing = fs.readFileSync(hookPath, "utf-8");
    if (existing.includes("kuma")) {
      return "✅ Kuma git hook already installed.";
    }
    // Backup existing hook
    const backupPath = hookPath + ".backup." + Date.now();
    fs.copyFileSync(hookPath, backupPath);
    fs.writeFileSync(hookPath, hookContent, "utf-8");
    try { fs.chmodSync(hookPath, 0o755); } catch {}
    return `✅ Installed kuma post-commit hook (existing hook backed up to ${path.basename(backupPath)})`;
  }

  fs.writeFileSync(hookPath, hookContent, "utf-8");
  try { fs.chmodSync(hookPath, 0o755); } catch {}
  return "✅ Installed kuma post-commit hook.";
}
