import fs from "node:fs";
import path from "node:path";
import { validateFilePath, getProjectRoot, getBackupPath, ensureBackupDir } from "../utils/pathValidator.js";
import { circuitBreaker } from "../utils/errorHandler.js";
import { sessionMemory } from "../engine/sessionMemory.js";

// ============================================================
// PRECISE DIFF EDITOR — Search-and-Replace + Fuzzy Fallback
// ============================================================

interface DiffEdit {
  searchBlock: string;
  replaceBlock: string;
  allowMultiple?: boolean;
  fuzzyThreshold?: number;
}

interface DiffEditorParams {
  filePath: string;
  action?: "rollback";
  edits?: DiffEdit[];
  safe?: boolean;
  dryRun?: boolean;
  version?: number | 'list';
  scope?: 'file' | 'dir' | 'edit-id' | 'commit';
  editId?: string;
}

interface DiffResult {
  success: boolean;
  matched: number;
  replaced: number;
  backupPath?: string;
  editId?: string;
  error?: string;
  details?: string;
}

interface BackupManifest {
  timestamp: number;
  edits: Array<{
    editId: string;
    filePath: string;
    editIndex: number;
  }>;
}

interface RollbackParams {
  filePath?: string;
  version?: number | 'list';
  scope?: 'file' | 'dir' | 'edit-id' | 'commit';
  editId?: string;
}

/**
 * Fast edit: apply without backup, circuit breaker, or manifest.
 * 40x faster than safe mode for simple replacements.
 */
function fastApplyEdit(content: string, edit: DiffEdit): DiffResult {
  const { searchBlock, replaceBlock, allowMultiple = false } = edit;

  // Exact match only (no fuzzy for speed)
  const count = countOccurrences(content, searchBlock);
  if (count === 0) {
    return {
      success: false,
      matched: 0,
      replaced: 0,
      error: `DIFF_MISMATCH: searchBlock not found (fast mode - exact match only)`,
      details: content,
    };
  }

  const newContent = allowMultiple
    ? replaceAll(content, searchBlock, replaceBlock)
    : content.replace(searchBlock, replaceBlock);

  return {
    success: true,
    matched: count,
    replaced: allowMultiple ? count : 1,
    details: newContent,
  };
}

/**
 * Format fast edit output — minimal, no backup/editId info.
 */
function formatFastEditResult(results: DiffResult[], filePath: string): string {
  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success).length;

  if (failCount === 0) {
    return `⚡ Fast edit: ${filePath} — ${successCount} edits applied.`;
  }

  const lines: string[] = [`⚡ Fast edit: ${filePath}`];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.success) {
      lines.push(`  [${i + 1}] ✅ ${r.matched}x matched, ${r.replaced}x replaced`);
    } else {
      lines.push(`  [${i + 1}] ❌ ${r.error}`);
    }
  }
  return lines.join("\n");
}

/**
 * Generate a unique edit ID for tracking across backups.
 */
export function generateEditId(): string {
  return `edit-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

export async function handlePreciseDiffEditor(params: DiffEditorParams): Promise<string> {
  const { filePath, edits, safe = true, dryRun = false, action, scope } = params;

  if (action === "rollback") {
    return handleRollbackEdit({ filePath, version: params.version, scope: scope || 'file', editId: params.editId });
  }

  if (!edits || edits.length === 0) {
    return "Error: 'edits' required for edit mode, or use action: 'rollback' for rollback.";
  }

  // Validate path
  const validation = validateFilePath(filePath);
  if (!validation.valid) {
    return `Error: ${validation.error.message}`;
  }

  const resolvedPath = validation.resolvedPath;

  // Check circuit breaker (skip in fast mode)
  if (safe) {
    const cbResult = circuitBreaker.check("precise_diff_editor", { filePath });
    if (!cbResult.allowed) {
      return `⚠️ ${cbResult.reason}\n\nTry reading the file first with smart_file_picker to verify current content.`;
    }
  }

  // Check file exists
  if (!fs.existsSync(resolvedPath)) {
    return `Error: File not found: "${filePath}".\nUse batch_file_writer to create a new file.`;
  }

  try {
    const originalContent = fs.readFileSync(resolvedPath, "utf-8");
    let currentContent = originalContent;
    const results: DiffResult[] = [];

    for (let i = 0; i < edits.length; i++) {
      const edit = edits[i];
      // In fast mode (safe:false), apply without backup
      if (!safe) {
        const result = fastApplyEdit(currentContent, edit);
        if (result.success) {
          fs.writeFileSync(resolvedPath, result.details!, "utf-8");
          currentContent = result.details!;
          sessionMemory.recordToolCall("precise_diff_editor", {
            filePath,
            editIndex: i,
            fast: true,
            success: true,
          });
          sessionMemory.addModifiedFile(filePath);
        }
        results.push(result);
        continue;
      }

      // Safe mode: full backup + safety
      const result = applyEdit(currentContent, edit, resolvedPath, i, dryRun);

      if (result.success) {
        if (!dryRun) {
          const editId = generateEditId();
          result.editId = editId;
          fs.writeFileSync(resolvedPath, result.details!, "utf-8");

          if (result.backupPath) {
            updateBackupManifest(result.backupPath, editId, filePath, i);
          }

          sessionMemory.recordToolCall("precise_diff_editor", {
            filePath,
            editIndex: i,
            editId,
            success: true,
            matched: result.matched,
          });
          sessionMemory.addModifiedFile(filePath);
        }

        currentContent = result.details!;
      }

      results.push(result);
    }

    // Format output
    if (dryRun) {
      return formatDryRunResult(results, filePath, originalContent);
    }
    if (!safe) {
      return formatFastEditResult(results, filePath);
    }
    return formatDiffResult(results, filePath);
  } catch (err) {
    return `Error editing file "${filePath}": ${err instanceof Error ? err.message : String(err)}`;
  }
}

/** @internal exported for testing */
export function applyEdit(
  content: string,
  edit: DiffEdit,
  filePath: string,
  editIndex: number,
  dryRun: boolean = false
): DiffResult {
  const { searchBlock, replaceBlock, allowMultiple = false, fuzzyThreshold = 0.85 } = edit;

  // Step 1: Exact match
  const exactCount = countOccurrences(content, searchBlock);

  if (exactCount > 0) {
    // Backup (skip in dry run)
    const backupPath = dryRun ? undefined : createBackup(filePath);

    // Apply replacement
    const newContent: string = allowMultiple
      ? replaceAll(content, searchBlock, replaceBlock)
      : content.replace(searchBlock, replaceBlock);

    return {
      success: true,
      matched: exactCount,
      replaced: allowMultiple ? exactCount : 1,
      backupPath,
      details: newContent,
    };
  }

  // Step 2: Normalize whitespace per line and retry
  // Uses line-level normalization to preserve line count (unlike normalizeWhitespace which collapses blank lines)
  const normSearchLines = normalizeLines(searchBlock);
  const normContentLines = normalizeLines(content);

  // Find matching block by normalized lines
  const matchIndex = normContentLines.findIndex((_, i) =>
    i + normSearchLines.length <= normContentLines.length &&
    normContentLines.slice(i, i + normSearchLines.length).every((line, j) => line === normSearchLines[j])
  );

  if (matchIndex >= 0) {
    const backupPath = dryRun ? undefined : createBackup(filePath);
    const origLines = content.split("\n");
    const replaceLines = replaceBlock.split("\n");
    const newLines = [
      ...origLines.slice(0, matchIndex),
      ...replaceLines,
      ...origLines.slice(matchIndex + normSearchLines.length),
    ];
    const newContent = newLines.join("\n");

    return {
      success: true,
      matched: 1,
      replaced: 1,
      backupPath,
      details: newContent,
    };
  }

  // Step 3: Fuzzy match
  const fuzzyResult = findFuzzyMatch(content, searchBlock, fuzzyThreshold);
  if (fuzzyResult) {
    const backupPath = dryRun ? undefined : createBackup(filePath);
    const newContent = content.replace(fuzzyResult.match, replaceBlock);

    return {
      success: true,
      matched: 1,
      replaced: 1,
      backupPath,
      details: newContent,
    };
  }

  // Step 4: All failed — report specific error
  const nearestLine = findNearestLine(content, searchBlock);
  return {
    success: false,
    matched: 0,
    replaced: 0,
    error: `DIFF_MISMATCH: searchBlock not found in file "${filePath}" (edit #${editIndex + 1}).`,
    details: nearestLine
      ? `Nearest line with similar content found at line ${nearestLine.line}:\n\`\`\`\n${nearestLine.content}\n\`\`\`\nCheck whether:\n1. Spacing/indentation matches (try 1:1 matching)\n2. searchBlock content is exactly the same as what's in the file\n3. File was not modified by a previous edit\n\n💡 Read the file first with smart_file_picker to verify current content.`
      : "No similar lines found. The file may have completely different content than expected.",
  };
}

/** @internal exported for testing */
export function countOccurrences(content: string, search: string): number {
  if (search === "") return 0;
  let count = 0;
  let pos = 0;
  while (true) {
    pos = content.indexOf(search, pos);
    if (pos === -1) break;
    count++;
    pos += search.length;
  }
  return count;
}

/** @internal exported for testing */
export function replaceAll(content: string, search: string, replace: string): string {
  return content.split(search).join(replace);
}

/**
 * Per-line whitespace normalization that preserves line count.
 * Unlike normalizeWhitespace, this does not collapse blank lines or trim trailing \n,
 * so line indices stay consistent for mapping back to original content.
 */
function normalizeLines(text: string): string[] {
  return text.split("\n").map((line) => line.trim().replace(/[ \t]+/g, " "));
}

/** @internal exported for testing */
export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, "\n")       // Normalize line endings
    .replace(/[ \t]+/g, " ")       // Collapse multiple spaces/tabs
    .replace(/\n{3,}/g, "\n\n")    // Collapse multiple blank lines FIRST (before trim)
    .replace(/^[ \t]+/gm, "")      // Trim leading spaces/tabs only (not newlines)
    .replace(/[ \t]+$/gm, "")      // Trim trailing spaces/tabs only (not newlines)
    .trim();
}

/** @internal exported for testing */
export function findFuzzyMatch(
  content: string,
  search: string,
  threshold: number
): { match: string; similarity: number } | null {
  const searchLines = search.split("\n").filter((l) => l.trim());
  const contentLines = content.split("\n");

  if (searchLines.length === 0) return null;

  // Pre-compute normalized versions for whitespace-resistant similarity comparison
  const normalizedSearch = normalizeLines(search).join("\n");

  let bestMatch: string | null = null;
  let bestSimilarity = 0;

  for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    const candidate = contentLines.slice(i, i + searchLines.length).join("\n");
    // Normalize whitespace so indentation/spacing differences don't penalize similarity
    const normalizedCandidate = normalizeLines(candidate).join("\n");
    const similarity = calculateSimilarity(normalizedSearch, normalizedCandidate);

    if (similarity > bestSimilarity) {
      bestSimilarity = similarity;
      bestMatch = candidate;
    }
  }

  if (bestMatch && bestSimilarity >= threshold) {
    return { match: bestMatch, similarity: bestSimilarity };
  }

  return null;
}

/** @internal exported for testing */
export function calculateSimilarity(a: string, b: string): number {
  // Levenshtein distance based similarity
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;

  if (longer.length === 0) return 1.0;

  const distance = levenshteinDistance(longer, shorter);
  return 1.0 - distance / longer.length;
}

/** @internal exported for testing */
export function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/** @internal exported for testing */
export function findNearestLine(
  content: string,
  search: string
): { line: number; content: string } | null {
  const lines = content.split("\n");
  const searchTrimmed = search.trim();
  const searchWords = new Set(searchTrimmed.split(/\s+/).filter((w) => w.length > 3));

  // Skip if search is too short
  if (searchWords.size < 2) return null;

  let bestLine = -1;
  let bestScore = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineWords = new Set(lines[i].split(/\s+/).filter((w) => w.length > 3));
    let matchCount = 0;

    for (const word of searchWords) {
      if (lineWords.has(word)) matchCount++;
    }

    const score = matchCount / searchWords.size;
    if (score > bestScore) {
      bestScore = score;
      bestLine = i;
    }
  }

  if (bestLine >= 0 && bestScore > 0.3) {
    return {
      line: bestLine + 1,
      content: lines[bestLine].substring(0, 300),
    };
  }

  return null;
}

function createBackup(filePath: string): string {
  ensureBackupDir();
  const backupPath = getBackupPath(filePath);
  const backupDir = path.dirname(backupPath);

  fs.mkdirSync(backupDir, { recursive: true });
  fs.copyFileSync(filePath, backupPath);

  return backupPath;
}

/**
 * Update or create the backup manifest for a timestamp directory.
 * Stores all edit IDs and their associated file paths.
 */
function updateBackupManifest(backupPath: string, editId: string, filePath: string, editIndex: number): void {
  try {
    const backupDir = path.dirname(backupPath);
    const manifestPath = path.join(backupDir, "backup_manifest.json");
    let manifest: BackupManifest;

    if (fs.existsSync(manifestPath)) {
      const existing = fs.readFileSync(manifestPath, "utf-8");
      manifest = JSON.parse(existing);
    } else {
      const tsDir = path.basename(backupDir);
      manifest = { timestamp: Number(tsDir) || Date.now(), edits: [] };
    }

    manifest.edits.push({ editId, filePath, editIndex });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
  } catch (err) {
    // Non-critical — manifest is informational, don't crash on write failure
    console.error(`[BackupManifest] Failed to update manifest: ${err}`);
  }
}

function formatDryRunResult(results: DiffResult[], filePath: string, originalContent: string): string {
  const lines: string[] = [
    `🔍 **DRY RUN** — ${filePath}`,
    `⚠️ File not modified (dryRun=true). Preview of changes from ${results.length} edits:`,
    "",
  ];

  // Track cumulative state to show net change per edit
  let prevContent = originalContent;

  for (let i = 0; i < results.length; i++) {
    const r = results[i];

    if (r.success) {
      lines.push(`**Edit #${i + 1}:** ✅ Matched: ${r.matched}x`);

      // Compute a simple unified diff
      const prevLines = prevContent.split("\n");
      const newLines = r.details!.split("\n");

      // Find first differing line
      let diffStart = 0;
      while (diffStart < prevLines.length && diffStart < newLines.length &&
             prevLines[diffStart] === newLines[diffStart]) {
        diffStart++;
      }

      // Find last differing line (from end)
      let pEnd = prevLines.length - 1;
      let nEnd = newLines.length - 1;
      while (pEnd > diffStart && nEnd > diffStart &&
             prevLines[pEnd] === newLines[nEnd]) {
        pEnd--;
        nEnd--;
      }

      lines.push("```diff");

      if (diffStart > pEnd && diffStart > nEnd) {
        // No actual changes shown (edge case)
        lines.push("  (no visible change)");
      } else {
        // Show context lines around changes
        const contextStart = Math.max(0, diffStart - 1);
        const contextEnd = Math.min(newLines.length, nEnd + 2);

        // Show context before + deleted lines
        if (diffStart <= pEnd) {
          for (let j = contextStart; j <= pEnd; j++) {
            if (j < diffStart) {
              lines.push(`  ${prevLines[j]}`); // context before
            } else {
              lines.push(`- ${prevLines[j]}`);
            }
          }
        }

        // Show added lines + context after
        if (diffStart <= nEnd) {
          for (let j = diffStart; j < contextEnd && j < newLines.length; j++) {
            if (j <= nEnd) {
              lines.push(`+ ${newLines[j]}`);
            } else {
              lines.push(`  ${newLines[j]}`); // context after
            }
          }
        }
      }
      lines.push("```");
      lines.push("");

      // Update cumulative state for next edit
      prevContent = r.details!;
    } else {
      lines.push(`**Edit #${i + 1}:** ❌ ${r.error}`, "");
    }
  }

  // Summary: lines added/removed (use prevContent, which is the final cumulative state)
  const finalLines = prevContent.split("\n");
  const origLineCount = originalContent.split("\n").length;
  const diff = finalLines.length - origLineCount;
  const sign = diff >= 0 ? "+" : "";
  lines.push(`📊 **Net change:** ${sign}${diff} lines (${origLineCount} → ${finalLines.length})`);

  lines.push(
    "",
    `💡 **Remove dryRun** or set \`dryRun: false\` to write changes to file.`,
  );

  return lines.join("\n");
}

function formatDiffResult(results: DiffResult[], filePath: string): string {
  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success).length;

  // Ladder hint: show only on first edit per session
  const history = sessionMemory.getToolCallHistory(50);
  const callCount = history.filter((c) => c.toolName === "precise_diff_editor").length;
  const isFirstEdit = callCount <= 1; // 1 = current call only, 0 = not recorded yet

  const lines: string[] = [
    ...(isFirstEdit ? ["💡 **The Ladder:** 1. Does this code need to exist? 2. Does stdlib cover it? 3. Is there a one-liner? 4. Only then, write it.\n"] : []),
    `📝 Diff Editor — ${filePath}`,
    `✅ ${successCount} edits successful | ❌ ${failCount} edits failed`,
    "",
  ];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];

    if (r.success) {
      lines.push(`[${i + 1}] ✅ Matched: ${r.matched}x, Replaced: ${r.replaced}x`);
      if (r.backupPath) {
        const relativePath = path.relative(getProjectRoot(), r.backupPath);
        lines.push(`    Backup: ${relativePath}`);
      }
      if (r.editId) {
        lines.push(`    editId: \`${r.editId}\``);
      }
    } else {
      lines.push(`[${i + 1}] ❌ ${r.error}`);
      if (r.details) {
        lines.push(`    ${r.details.replace(/\n/g, "\n    ")}`);
      }
    }
  }

  lines.push(
    "",
    `💡 Use smart_file_picker to read the file and verify edit results.`,
    `💡 Or execute_safe_test({task: "typecheck"}) to check if edits broke anything.`,
    `💡 Rollback options: { action: "rollback", version: <N> } | { scope: "edit-id", editId: "<id>" } | { scope: "dir", ... }`,
  );

  return lines.join("\n");
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export async function handleRollbackEdit(params: RollbackParams): Promise<string> {
  const { filePath, version, scope = 'file', editId } = params;

  if (scope === 'commit') {
    return handleCommitRollback(filePath, version);
  }

  if (scope === 'edit-id') {
    return handleEditIdRollback(editId, version);
  }

  if (scope === 'dir') {
    return handleDirRollback(filePath, version);
  }

  // scope === 'file' (default)
  if (!filePath) {
    return "Error: 'filePath' is required for file-scoped rollback.";
  }

  const validation = validateFilePath(filePath);
  if (!validation.valid) {
    return `Error: ${validation.error.message}`;
  }

  const resolvedPath = validation.resolvedPath;
  const root = getProjectRoot();
  const relativePath = path.relative(root, resolvedPath);
  const backupRoot = path.join(root, ".kuma", "backups");

  if (!fs.existsSync(backupRoot)) {
    return `Error: No backup folder (.kuma/backups) found in project root.`;
  }

  try {
    const dirs = getBackupTimestamps(backupRoot);
    if (dirs.length === 0) {
      return `Error: No valid backup found in .kuma/backups folder.`;
    }

    // Collect all backup versions for this file
    const backupVersions: { dir: string; backupPath: string }[] = [];
    for (const dir of dirs) {
      const potentialBackupPath = path.join(backupRoot, dir, relativePath);
      if (fs.existsSync(potentialBackupPath)) {
        backupVersions.push({ dir, backupPath: potentialBackupPath });
      }
    }

    if (backupVersions.length === 0) {
      return `Error: No backup history found for file "${filePath}".`;
    }

    // Handle version === 'list': return formatted list of all versions
    if (version === 'list') {
      return formatBackupVersionList(backupVersions, filePath);
    }

    // Determine which version to restore
    let selectedIndex = 0;
    if (typeof version === 'number') {
      if (version < 1 || version > backupVersions.length) {
        return `Error: Version ${version} is invalid. ${backupVersions.length} backups available (1-${backupVersions.length}).`;
      }
      selectedIndex = version - 1;
    }

    const selected = backupVersions[selectedIndex];
    fs.copyFileSync(selected.backupPath, resolvedPath);

    // Record to session memory
    sessionMemory.recordToolCall("rollback_last_edit", {
      filePath,
      backupTimestamp: selected.dir,
      version: version ?? 1,
      scope: 'file',
      success: true,
    });

    const relBackupPath = path.relative(root, selected.backupPath);
    return `✅ Rollback Successful!\nFile "${filePath}" restored from backup: "${relBackupPath}".`;
  } catch (err) {
    return `Error performing rollback for "${filePath}": ${err instanceof Error ? err.message : String(err)}`;
  }
}

/**
 * Rollback: git-based commit rollback.
 */
async function handleCommitRollback(filePath?: string, version?: number | 'list'): Promise<string> {
  try {
    const { execSync } = await import("node:child_process");
    const root = getProjectRoot();

    // If version === 'list', show recent commits
    if (version === 'list') {
      const log = execSync('git log --oneline -20', { cwd: root, encoding: "utf-8" });
      const lines = log.trim().split("\n").map((l: string) => `  ${l}`).join("\n");
      return [
        `📋 **Recent Commits:**`,
        "",
        lines,
        "",
        `💡 Use { action: "rollback", scope: "commit", version: <N> } to restore a specific commit.`,
      ].join("\n");
    }

    // Check for uncommitted changes before destructive git checkout
    const status = execSync('git status --porcelain', { cwd: root, encoding: "utf-8" }).trim();
    if (status) {
      return [
        `⚠️ **Uncommitted changes detected.**`,
        `Running \`git checkout HEAD~N\` would destroy these changes.`,
        "",
        `Options:`,
        `  1. Stash changes first: run \`git stash\``,
        `  2. Commit changes: run \`git commit -m "..."\``,
        `  3. Use file-scoped rollback instead: { action: "rollback", scope: "file", ... }`,
        "",
        `💡 Run \`git stash\` first, then retry the commit rollback.`,
      ].join("\n");
    }

    // Determine target: if version is N, get the Nth recent commit
    let target = "";
    if (typeof version === 'number' && version >= 1) {
      target = `HEAD~${version}`;
    } else {
      target = "HEAD~1"; // default: previous commit
    }

    if (filePath) {
      // Rollback specific file to a previous commit
      execSync(`git checkout ${target} -- "${filePath}"`, { cwd: root, encoding: "utf-8" });
      return `✅ **Commit Rollback** — File "${filePath}" restored from ${target}.`;
    } else {
      // Hard rollback to commit
      execSync(`git checkout ${target}`, { cwd: root, encoding: "utf-8" });
      return `✅ **Commit Rollback** — Project restored to ${target}.`;
    }
  } catch (err) {
    return `Error performing git rollback: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/**
 * Rollback: by edit ID — find the backup by scanning manifests.
 */
async function handleEditIdRollback(editId?: string, version?: number | 'list'): Promise<string> {
  if (!editId && version !== 'list') {
    return "Error: 'editId' is required for edit-id scoped rollback.";
  }

  const root = getProjectRoot();
  const backupRoot = path.join(root, ".kuma", "backups");
  const dirs = getBackupTimestamps(backupRoot);

  if (dirs.length === 0) {
    return "Error: No backups found.";
  }

  // Scan all manifests for the matching edit ID
  const matchingEdits: Array<{ dir: string; editId: string; filePath: string }> = [];
  const allEdits: Array<{ dir: string; editId: string; filePath: string }> = [];

  for (const dir of dirs) {
    const manifestPath = path.join(backupRoot, dir, "backup_manifest.json");
    if (!fs.existsSync(manifestPath)) continue;

    try {
      const manifest: BackupManifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      for (const edit of manifest.edits) {
        allEdits.push({ dir, editId: edit.editId, filePath: edit.filePath });
        if (edit.editId === editId) {
          matchingEdits.push({ dir, editId: edit.editId, filePath: edit.filePath });
        }
      }
    } catch {}
  }

  // version === 'list': show all tracked edit IDs
  if (version === 'list') {
    if (allEdits.length === 0) {
      return "📋 **Edit IDs** — No edit IDs found in backup manifests.\n\nNew edits will be tracked with editId going forward.";
    }
    const lines: string[] = ["📋 **Tracked Edit IDs:**", ""];
    for (const e of allEdits.slice(0, 30)) {
      const ts = new Date(Number(e.dir)).toISOString();
      lines.push(`  • \`${e.editId}\` — ${e.filePath} (${ts})`);
    }
    if (allEdits.length > 30) lines.push(`  ... +${allEdits.length - 30} more`);
    lines.push("", `💡 Use { action: "rollback", scope: "edit-id", editId: "<id>" } to restore a specific edit.`);
    return lines.join("\n");
  }

  // Restore specific edit
  if (matchingEdits.length === 0) {
    return `⚠️ **Edit ID not found** — "${editId}" not in backup manifests.\n\nEdit IDs are tracked for new edits. To rollback by file, use scope: "file".`;
  }

  const results: string[] = [];
  for (const match of matchingEdits) {
    const backupFilePath = path.join(backupRoot, match.dir, match.filePath);
    if (fs.existsSync(backupFilePath)) {
      const resolvedPath = path.join(root, match.filePath);
      fs.copyFileSync(backupFilePath, resolvedPath);
      results.push(`  ✅ \`${match.filePath}\` restored`);
    }
  }

  sessionMemory.recordToolCall("rollback_last_edit", {
    editId,
    filesRestored: matchingEdits.length,
    success: true,
  });

  return [
    `✅ **Edit Rollback** — Restored ${matchingEdits.length} file(s) for edit "${editId}":`,
    "",
    ...results,
  ].join("\n");
}

/**
 * Rollback: by directory — restore all files in a directory.
 */
async function handleDirRollback(dirPath?: string, version?: number | 'list'): Promise<string> {
  if (!dirPath) {
    return "Error: 'filePath' (directory path) is required for dir-scoped rollback.";
  }

  const root = getProjectRoot();
  const backupRoot = path.join(root, ".kuma", "backups");
  const dirs = getBackupTimestamps(backupRoot);

  if (dirs.length === 0) {
    return "Error: No backups found.";
  }

  // Normalize the directory path
  const normalizedDir = dirPath.replace(/\\/g, "/").replace(/\/$/, "");

  // Collect all files in this directory from backups
  const backupFiles: Array<{ dir: string; relativePath: string; fullPath: string }> = [];
  for (const dir of dirs) {
    const backupDirPath = path.join(backupRoot, dir);
    const files = walkBackupDir(backupDirPath);
    for (const file of files) {
      const relative = path.relative(backupDirPath, file);
      if (relative.startsWith(normalizedDir) || relative.startsWith(normalizedDir.replace(/^\//, ""))) {
        backupFiles.push({ dir, relativePath: relative, fullPath: file });
      }
    }
  }

  if (version === 'list') {
    // Group by timestamp
    const timestampFiles = new Map<string, string[]>();
    for (const bf of backupFiles) {
      if (!timestampFiles.has(bf.dir)) timestampFiles.set(bf.dir, []);
      timestampFiles.get(bf.dir)!.push(bf.relativePath);
    }

    const lines: string[] = [`📋 **Backup Snapshots for directory "${dirPath}":**`, ""];
    for (const [ts, files] of timestampFiles) {
      const date = new Date(Number(ts)).toISOString();
      lines.push(`  📁 ${date} — ${files.length} file(s)`);
      for (const f of files.slice(0, 5)) {
        lines.push(`     • ${f}`);
      }
      if (files.length > 5) lines.push(`     ... +${files.length - 5} more`);
    }
    lines.push("", `💡 Use { action: "rollback", scope: "dir", filePath: "${dirPath}", version: <N> } to restore.`);
    return lines.join("\n");
  }

  // Group by timestamp, pick the one to restore
  const byTimestamp = new Map<string, typeof backupFiles>();
  for (const bf of backupFiles) {
    if (!byTimestamp.has(bf.dir)) byTimestamp.set(bf.dir, []);
    byTimestamp.get(bf.dir)!.push(bf);
  }

  const sortedTimestamps = [...byTimestamp.keys()].sort((a, b) => Number(b) - Number(a));
  let selectedTs: string;
  if (typeof version === 'number' && version >= 1) {
    if (version > sortedTimestamps.length) {
      return `Error: Version ${version} is invalid. ${sortedTimestamps.length} snapshots available (1-${sortedTimestamps.length}).`;
    }
    selectedTs = sortedTimestamps[version - 1];
  } else {
    selectedTs = sortedTimestamps[0]; // newest
  }

  const filesToRestore = byTimestamp.get(selectedTs) || [];
  let restoredCount = 0;
  for (const bf of filesToRestore) {
    const targetPath = path.join(root, bf.relativePath);
    try {
      fs.copyFileSync(bf.fullPath, targetPath);
      restoredCount++;
    } catch {}
  }

  sessionMemory.recordToolCall("rollback_last_edit", {
    scope: 'dir',
    directory: dirPath,
    filesRestored: restoredCount,
    backupTimestamp: selectedTs,
    success: true,
  });

  return [
    `✅ **Directory Rollback** — Restored ${restoredCount} file(s) in "${dirPath}" from snapshot ${new Date(Number(selectedTs)).toISOString()}:`,
  ].join("\n");
}

/**
 * Walk a backup directory and return all file paths (recursive).
 */
function walkBackupDir(dirPath: string): string[] {
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.name === "backup_manifest.json") continue;
      if (entry.isDirectory()) {
        results.push(...walkBackupDir(fullPath));
      } else {
        results.push(fullPath);
      }
    }
  } catch {}
  return results;
}

/**
 * Get all backup timestamp directories, sorted newest first.
 */
function getBackupTimestamps(backupRoot: string): string[] {
  try {
    const dirs = fs.readdirSync(backupRoot).filter((name) => {
      const fullPath = path.join(backupRoot, name);
      return fs.statSync(fullPath).isDirectory() && /^\d+$/.test(name);
    });
    return dirs.sort((a, b) => Number(b) - Number(a));
  } catch {
    return [];
  }
}

/**
 * Format a list of backup versions.
 */
function formatBackupVersionList(backupVersions: Array<{ dir: string; backupPath: string }>, filePath: string): string {
  const lines: string[] = [`📋 Backup Versions for "${filePath}":`];
  backupVersions.forEach((v, i) => {
    const ts = Number(v.dir);
    const date = new Date(ts).toISOString();
    const relative = formatRelativeTime(ts);
    lines.push(`  [${i + 1}] ${date} (${relative})`);
  });
  lines.push('');
  lines.push(`💡 Use { action: "rollback", version: <N>, filePath: "${filePath}" } to restore a specific version.`);
  lines.push(`💡 Or use { scope: "dir", filePath: "<directory>" } to rollback a whole directory.`);
  lines.push(`💡 Or use { scope: "edit-id", editId: "<id>" } to rollback by edit ID.`);
  return lines.join('\n');
}
