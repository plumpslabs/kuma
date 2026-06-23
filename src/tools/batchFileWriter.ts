import fs from "node:fs";
import path from "node:path";
import { validateFilePath, validateFileExtension, getBackupPath, ensureBackupDir } from "../utils/pathValidator.js";
import { sessionMemory } from "../engine/sessionMemory.js";

// ============================================================
// BATCH FILE WRITER — Create new files in batch
// ============================================================

interface BatchFile {
  filePath: string;
  content: string;
  instructions: string;
}

interface BatchWriterParams {
  files: BatchFile[];
}

export async function handleBatchFileWriter(params: BatchWriterParams): Promise<string> {
  const { files } = params;

  // Maximum 15 files per batch
  if (files.length > 15) {
    return `Error: Maximum 15 files per batch. You sent ${files.length} files.`;
  }

  const results: Array<{ filePath: string; success: boolean; error?: string }> = [];

  for (const file of files) {
    // Validate content is not empty
    if (!file.content || file.content.trim().length === 0) {
      results.push({ filePath: file.filePath, success: false, error: "File content must not be empty." });
      continue;
    }

    // Validate instructions are provided
    if (!file.instructions || file.instructions.trim().length === 0) {
      results.push({ filePath: file.filePath, success: false, error: "File creation reason (instructions) is required." });
      continue;
    }
    try {
      // Validate path
      const validation = validateFilePath(file.filePath);
      if (!validation.valid) {
        results.push({ filePath: file.filePath, success: false, error: validation.error.message });
        continue;
      }

      const resolvedPath = validation.resolvedPath;

      // Validate extension
      if (!validateFileExtension(file.filePath)) {
        results.push({
          filePath: file.filePath,
          success: false,
          error: `File extension not allowed: "${path.extname(file.filePath)}". Allowed extensions: .ts, .js, .tsx, .jsx, .json, .md, .css, .html, .yml, .yaml, .toml, .sh, .env`,
        });
        continue;
      }

      // Check if file already exists
      if (fs.existsSync(resolvedPath)) {
        // Backup existing file
        ensureBackupDir();
        const backupPath = getBackupPath(file.filePath);
        const backupDir = path.dirname(backupPath);
        fs.mkdirSync(backupDir, { recursive: true });
        fs.copyFileSync(resolvedPath, backupPath);
      }

      // Create directory if needed
      const dir = path.dirname(resolvedPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Write file
      fs.writeFileSync(resolvedPath, file.content, "utf-8");

      // Record to session memory
      sessionMemory.recordToolCall("batch_file_writer", {
        filePath: file.filePath,
        instructions: file.instructions,
        size: file.content.length,
      });

      results.push({ filePath: file.filePath, success: true });
    } catch (err) {
      results.push({
        filePath: file.filePath,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const totalRequested = files.length;
  return formatBatchResult(results, totalRequested);
}

function formatBatchResult(results: Array<{ filePath: string; success: boolean; error?: string }>, totalRequested?: number): string {
  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success).length;

  const lines: string[] = [
    ...(totalRequested && totalRequested > 3 ? [`💡 **The Ladder:** Are all ${totalRequested} files needed? Could any be combined or skipped?\n`] : []),
    `📝 Batch File Writer`,
    `✅ ${successCount} files created | ❌ ${failCount} files failed`,
    "",
  ];

  for (const r of results) {
    if (r.success) {
      lines.push(`✅ ${r.filePath} — created successfully`);
    } else {
      lines.push(`❌ ${r.filePath} — ${r.error}`);
    }
  }

  if (failCount === 0 && successCount > 0) {
    lines.push("", "✅ All files created successfully.");
    lines.push("💡 Run execute_safe_test({task: \"typecheck\"}) to verify.");
  }

  return lines.join("\n");
}
