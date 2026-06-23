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
  edits: DiffEdit[];
  dryRun?: boolean;
}

interface DiffResult {
  success: boolean;
  matched: number;
  replaced: number;
  backupPath?: string;
  error?: string;
  details?: string;
}

export async function handlePreciseDiffEditor(params: DiffEditorParams): Promise<string> {
  const { filePath, edits, dryRun = false } = params;

  // Validate path
  const validation = validateFilePath(filePath);
  if (!validation.valid) {
    return `Error: ${validation.error.message}`;
  }

  const resolvedPath = validation.resolvedPath;

  // Cek circuit breaker
  const cbResult = circuitBreaker.check("precise_diff_editor", { filePath });
  if (!cbResult.allowed) {
    return `⚠️ ${cbResult.reason}\n\nCoba baca file dulu dengan smart_file_picker untuk verifikasi konten terkini.`;
  }

  // Cek file exists
  if (!fs.existsSync(resolvedPath)) {
    return `Error: File tidak ditemukan: "${filePath}".\nGunakan batch_file_writer untuk membuat file baru.`;
  }

  try {
    const originalContent = fs.readFileSync(resolvedPath, "utf-8");
    let currentContent = originalContent;
    const results: DiffResult[] = [];

    for (let i = 0; i < edits.length; i++) {
      const edit = edits[i];
      const result = applyEdit(currentContent, edit, resolvedPath, i, dryRun);

      if (result.success) {
        if (!dryRun) {
          // Write file after successful edit
          fs.writeFileSync(resolvedPath, result.details!, "utf-8");

          // Record to session memory
          sessionMemory.recordToolCall("precise_diff_editor", {
            filePath,
            editIndex: i,
            success: true,
            matched: result.matched,
          });
          sessionMemory.addModifiedFile(filePath);
        }

        // Chain: use updated content for next edit in batch
        currentContent = result.details!;
      }

      results.push(result);
    }

    // Format output (diff preview for dryRun)
    if (dryRun) {
      return formatDryRunResult(results, filePath, originalContent);
    }
    return formatDiffResult(results, filePath);
  } catch (err) {
    return `Error saat mengedit file "${filePath}": ${err instanceof Error ? err.message : String(err)}`;
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
    error: `DIFF_MISMATCH: searchBlock tidak ditemukan di file "${filePath}" (edit #${editIndex + 1}).`,
    details: nearestLine
      ? `Baris terdekat dengan konten mirip ditemukan di line ${nearestLine.line}:\n\`\`\`\n${nearestLine.content}\n\`\`\`\nPeriksa apakah:\n1. Spasi/indentasi sudah pas (coba match dengan 1:1)\n2. Isi searchBlock persis sama dengan yang ada di file\n3. File belum diubah oleh edit sebelumnya\n\n💡 Baca file dulu dengan smart_file_picker untuk verifikasi konten terkini.`
      : "Tidak ada baris yang mirip. File mungkin memiliki konten yang sangat berbeda dari yang diharapkan.",
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
 * Unlike normalizeWhitespace, this doesn't collapse blank lines or trim trailing \n,
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

function formatDryRunResult(results: DiffResult[], filePath: string, originalContent: string): string {
  const lines: string[] = [
    `🔍 **DRY RUN** — ${filePath}`,
    `⚠️ File tidak diubah (dryRun=true). Berikut preview perubahan dari ${results.length} edit:`,
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
  lines.push(`📊 **Net perubahan:** ${sign}${diff} baris (${origLineCount} → ${finalLines.length})`);

  lines.push(
    "",
    `💡 **Hilangkan dryRun** atau set \`dryRun: false\` untuk menulis perubahan ke file.`,
  );

  return lines.join("\n");
}

function formatDiffResult(results: DiffResult[], filePath: string): string {
  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success).length;

  const lines: string[] = [
    `📝 Diff Editor — ${filePath}`,
    `✅ ${successCount} edit berhasil | ❌ ${failCount} edit gagal`,
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
    } else {
      lines.push(`[${i + 1}] ❌ ${r.error}`);
      if (r.details) {
        lines.push(`    ${r.details.replace(/\n/g, "\n    ")}`);
      }
    }
  }

  lines.push(
    "",
    `💡 Gunakan smart_file_picker untuk membaca file dan verifikasi hasil edit.`,
    `💡 Atau execute_safe_test({task: "typecheck"}) untuk cek apakah edit tidak merusak.`,
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

export async function handleRollbackEdit(params: { filePath: string; version?: number | 'list' }): Promise<string> {
  const { filePath, version } = params;

  // Validate path
  const validation = validateFilePath(filePath);
  if (!validation.valid) {
    return `Error: ${validation.error.message}`;
  }

  const resolvedPath = validation.resolvedPath;
  const root = getProjectRoot();
  const relativePath = path.relative(root, resolvedPath);
  const backupRoot = path.join(root, ".agent-backups");

  if (!fs.existsSync(backupRoot)) {
    return `Error: Tidak ada folder backup (.agent-backups) ditemukan di project root.`;
  }

  try {
    // List all directories in .agent-backups
    const dirs = fs.readdirSync(backupRoot).filter((name) => {
      const fullPath = path.join(backupRoot, name);
      return fs.statSync(fullPath).isDirectory() && /^\d+$/.test(name);
    });

    if (dirs.length === 0) {
      return `Error: Tidak ada backup yang valid di folder .agent-backups.`;
    }

    // Sort directories by timestamp descending (newest first)
    dirs.sort((a, b) => Number(b) - Number(a));

    // Collect all backup versions for this file
    const backupVersions: { dir: string; backupPath: string }[] = [];
    for (const dir of dirs) {
      const potentialBackupPath = path.join(backupRoot, dir, relativePath);
      if (fs.existsSync(potentialBackupPath)) {
        backupVersions.push({ dir, backupPath: potentialBackupPath });
      }
    }

    if (backupVersions.length === 0) {
      return `Error: Tidak ada riwayat backup ditemukan untuk file "${filePath}".`;
    }

    // Handle version === 'list': return formatted list of all versions
    if (version === 'list') {
      const lines: string[] = [`📋 Backup Versions for "${filePath}":`];
      backupVersions.forEach((v, i) => {
        const ts = Number(v.dir);
        const date = new Date(ts).toISOString();
        const relative = formatRelativeTime(ts);
        lines.push(`  [${i + 1}] ${date} (${relative})`);
      });
      lines.push('');
      lines.push(`💡 Use rollback_last_edit({ filePath: "${filePath}", version: <N> }) to restore a specific version.`);
      return lines.join('\n');
    }

    // Determine which version to restore
    let selectedIndex = 0; // default: newest (index 0)
    if (typeof version === 'number') {
      if (version < 1 || version > backupVersions.length) {
        return `Error: Version ${version} tidak valid. Tersedia ${backupVersions.length} backup (1-${backupVersions.length}).`;
      }
      selectedIndex = version - 1; // 1-indexed to 0-indexed
    }

    const selected = backupVersions[selectedIndex];

    // Restore file from backup
    fs.copyFileSync(selected.backupPath, resolvedPath);

    // Record to session memory
    sessionMemory.recordToolCall("rollback_last_edit", {
      filePath,
      backupTimestamp: selected.dir,
      version: version ?? 1,
      success: true,
    });

    const relBackupPath = path.relative(root, selected.backupPath);
    return `✅ Rollback Berhasil!\nFile "${filePath}" telah dikembalikan ke kondisi cadangan dari: "${relBackupPath}".`;
  } catch (err) {
    return `Error saat melakukan rollback untuk "${filePath}": ${err instanceof Error ? err.message : String(err)}`;
  }
}
