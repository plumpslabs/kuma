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
  const { filePath, edits } = params;

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
    let currentContent = fs.readFileSync(resolvedPath, "utf-8");
    const results: DiffResult[] = [];

    for (let i = 0; i < edits.length; i++) {
      const edit = edits[i];
      const result = applyEdit(currentContent, edit, resolvedPath, i);

      if (result.success) {
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

        // Chain: use updated content for next edit in batch
        currentContent = result.details!;
      }

      results.push(result);
    }

    // Format output
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
  editIndex: number
): DiffResult {
  const { searchBlock, replaceBlock, allowMultiple = false, fuzzyThreshold = 0.85 } = edit;

  // Step 1: Exact match
  const exactCount = countOccurrences(content, searchBlock);

  if (exactCount > 0) {
    // Backup dulu
    const backupPath = createBackup(filePath);

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

  // Step 2: Normalize whitespace and retry
  const normalizedSearch = normalizeWhitespace(searchBlock);
  const normalizedContent = normalizeWhitespace(content);

  if (normalizedContent.includes(normalizedSearch)) {
    const backupPath = createBackup(filePath);
    const newContent = content.replace(normalizedSearch, replaceBlock);

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
    const backupPath = createBackup(filePath);
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

/** @internal exported for testing */
export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, "\n")       // Normalize line endings
    .replace(/[ \t]+/g, " ")       // Collapse multiple spaces/tabs
    .replace(/^\s+/gm, "")         // Trim leading whitespace per line
    .replace(/\s+$/gm, "")         // Trim trailing whitespace per line
    .replace(/\n{3,}/g, "\n\n")    // Collapse multiple blank lines
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

  let bestMatch: string | null = null;
  let bestSimilarity = 0;

  for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    const candidate = contentLines.slice(i, i + searchLines.length).join("\n");
    const similarity = calculateSimilarity(search, candidate);

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
