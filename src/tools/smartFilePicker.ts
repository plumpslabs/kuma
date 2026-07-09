import fs from "node:fs";
import path from "node:path";
import { validateFilePath, getProjectRoot } from "../utils/pathValidator.js";
import { truncateToTokenLimit } from "../utils/tokenCounter.js";
import { sessionMemory } from "../engine/sessionMemory.js";

// ============================================================
// SMART FILE PICKER v2 — Multi-file, raw mode, jump context
// ============================================================

export interface SmartFilePickerParams {
  filePath?: string;
  files?: string[];
  startLine?: number;
  endLine?: number;
  contextLines?: number;
  chunkStrategy?: "full" | "smart" | "outline";
  outputMode?: "rich" | "raw";
  compact?: boolean;
}

const MAX_FILE_SIZE = 1_000_000; // 1MB
const CHUNK_THRESHOLD = 300;

export async function handleSmartFilePicker(
  params: SmartFilePickerParams,
): Promise<string> {
  const {
    filePath,
    files,
    startLine,
    endLine,
    contextLines = 5,
    chunkStrategy = "smart",
    outputMode = "rich",
    compact = false,
  } = params;

  // Determine which files to read
  const filePaths: string[] = [];
  if (files && files.length > 0) {
    filePaths.push(...files);
  } else if (filePath) {
    filePaths.push(filePath);
  } else {
    return compact
      ? "ERR:filePath required"
      : "Error: 'filePath' or 'files' parameter is required.";
  }

  // Read all files
  const results: string[] = [];
  for (const fp of filePaths) {
    const result = await readSingleFile(fp, {
      startLine,
      endLine,
      contextLines,
      chunkStrategy,
      outputMode,
      compact,
    });
    results.push(result);
  }

  // Join multiple files with separator
  if (results.length === 1) return results[0];

  if (compact || outputMode === "raw") {
    return results.join("\n---\n");
  }
  return results.join("\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n");
}

async function readSingleFile(
  filePath: string,
  opts: {
    startLine?: number;
    endLine?: number;
    contextLines: number;
    chunkStrategy: string;
    outputMode: string;
    compact: boolean;
  },
): Promise<string> {
  const {
    startLine,
    endLine,
    contextLines,
    chunkStrategy,
    outputMode,
    compact,
  } = opts;

  // Path validation
  const validation = validateFilePath(filePath);
  if (!validation.valid) {
    return compact
      ? `ERR:${filePath} - ${validation.error.message}`
      : `Error: ${validation.error.message}`;
  }

  const resolvedPath = validation.resolvedPath;

  // Check file exists
  if (!fs.existsSync(resolvedPath)) {
    const projectRoot = getProjectRoot();
    let suggestion: string;
    if (!path.isAbsolute(filePath)) {
      const cwdPath = path.resolve(process.cwd(), filePath);
      suggestion = `Path resolved to: ${resolvedPath}\nCWD: ${process.cwd()}\nProject root: ${projectRoot}\nHint: Try path relative to project root, or relative to CWD (${cwdPath})\nTry smart_grep first to locate the correct file.`;
    } else {
      suggestion = "File does not exist. Try smart_grep to locate it.";
    }
    return compact
      ? `ERR:not found "${filePath}"`
      : `Error: File not found: "${filePath}".\n${suggestion}`;
  }

  const stat = fs.statSync(resolvedPath);

  // Check file size
  if (stat.size > MAX_FILE_SIZE) {
    return compact
      ? `ERR:too large ${filePath} (${(stat.size / 1024 / 1024).toFixed(1)}MB)`
      : `Error: File too large (${(stat.size / 1024 / 1024).toFixed(1)}MB). Max 1MB.\nUse smart_grep to find specific content instead.`;
  }

  try {
    const content = fs.readFileSync(resolvedPath, "utf-8");
    const lines = content.split("\n");
    const totalLines = lines.length;

    sessionMemory.recordToolCall("smart_file_picker", {
      filePath,
      chunkStrategy,
      totalLines,
    });

    // --- RAW / COMPACT MODE ---
    if (compact || outputMode === "raw") {
      // Explicit range
      if (startLine !== undefined || endLine !== undefined) {
        const start = startLine ?? 1;
        const end = endLine ?? totalLines;
        return lines.slice(start - 1, end).join("\n");
      }
      // Small file or full
      if (totalLines <= CHUNK_THRESHOLD || chunkStrategy === "full") {
        return content;
      }
      // For large files in raw mode, show header + tail
      const tailStart = Math.max(totalLines - 50, 0);
      return lines.slice(0, 50).join("\n") +
        `\n... ${totalLines - 100} lines hidden ...\n` +
        lines.slice(tailStart).join("\n");
    }

    // --- GREP-LIKE JUMP (startLine without endLine) ---
    if (startLine !== undefined && endLine === undefined) {
      const ctxStart = Math.max(0, startLine - 1 - contextLines);
      const ctxEnd = Math.min(totalLines, startLine - 1 + contextLines);
      const selectedLines = lines.slice(ctxStart, ctxEnd);
      return formatJumpOutput(filePath, selectedLines, ctxStart + 1, startLine, totalLines);
    }

    // --- EXPLICIT RANGE ---
    if (startLine !== undefined || endLine !== undefined) {
      const start = startLine ?? 1;
      const end = endLine ?? totalLines;
      const selectedLines = lines.slice(start - 1, end);
      return formatOutput(filePath, selectedLines, start, totalLines, false);
    }

    // --- SMALL FILE: FULL ---
    if (totalLines <= CHUNK_THRESHOLD || chunkStrategy === "full") {
      return formatOutput(filePath, lines, 1, totalLines, false);
    }

    // --- CHUNKING ---
    switch (chunkStrategy) {
      case "outline":
        return handleOutlineStrategy(filePath, lines, totalLines);
      case "smart":
        return handleSmartStrategy(filePath, lines, totalLines);
      default:
        return formatOutput(
          filePath,
          lines.slice(0, CHUNK_THRESHOLD),
          1,
          totalLines,
          true,
        );
    }
  } catch (err) {
    return compact
      ? `ERR:reading "${filePath}"`
      : `Error reading file "${filePath}": ${err instanceof Error ? err.message : String(err)}`;
  }
}

function formatJumpOutput(
  filePath: string,
  lines: string[],
  startLine: number,
  targetLine: number,
  totalLines: number,
): string {
  const header = [
    `File: ${filePath}`,
    `${totalLines} total lines`,
    `Jumped to line ${targetLine} (±context)`,
    "",
  ].join("\n");

  const body = lines
    .map((line, i) => {
      const lineNum = startLine + i;
      const marker = lineNum === targetLine ? ">" : " ";
      return `${marker} ${String(lineNum).padStart(4, " ")} | ${line}`;
    })
    .join("\n");

  return header + "\n" + body;
}

function formatOutput(
  filePath: string,
  lines: string[],
  startLine: number,
  totalLines: number,
  truncated: boolean,
): string {
  const header = [
    `File: ${filePath}`,
    `${totalLines} total lines`,
    truncated
      ? `Showing ${lines.length} lines (file >${CHUNK_THRESHOLD} lines). Use startLine/endLine for a specific range.`
      : "",
    "",
  ]
    .filter(Boolean)
    .join("\n");

  const body = lines
    .map((line, i) => {
      const lineNum = startLine + i;
      return `${String(lineNum).padStart(4, " ")} | ${line}`;
    })
    .join("\n");

  return truncateToTokenLimit(`${header}\n${body}`, 2000);
}

async function handleOutlineStrategy(
  filePath: string,
  lines: string[],
  totalLines: number,
): Promise<string> {
  const importLines: string[] = [];
  const exportLines: Array<{ line: number; text: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("//") || line.startsWith("#") || line.startsWith("/*") || line.startsWith("*")) continue;

    if (line.startsWith("import ") || line.startsWith("from ") || line.startsWith("require(")) {
      importLines.push(line);
      continue;
    }

    if (
      line.startsWith("export ") ||
      line.startsWith("function ") ||
      line.startsWith("const ") ||
      line.startsWith("let ") ||
      line.startsWith("var ") ||
      line.startsWith("class ") ||
      line.startsWith("interface ") ||
      line.startsWith("type ") ||
      line.startsWith("enum ") ||
      line.startsWith("def ") ||
      line.startsWith("async function ") ||
      line.startsWith("async def ")
    ) {
      exportLines.push({ line: i + 1, text: line.substring(0, 150) });
    }
  }

  const result = [
    `File: ${filePath}`,
    `${totalLines} total lines (OUTLINE MODE - signatures and imports only)`,
    "",
    "Imports:",
    ...importLines.slice(0, 30).map((l) => `  ${l.substring(0, 150)}`),
    importLines.length > 30 ? `  ...and ${importLines.length - 30} more imports` : "",
    "",
    "Exports & Declarations:",
    ...exportLines.map((e) => `  [L${e.line}] ${e.text}`),
    "",
    'Pass startLine/endLine to read a specific range.',
    'Or use chunkStrategy: "full" to read the entire file.',
  ]
    .filter(Boolean)
    .join("\n");

  return truncateToTokenLimit(result, 1500);
}

async function handleSmartStrategy(
  filePath: string,
  lines: string[],
  totalLines: number,
): Promise<string> {
  const headerEnd = Math.min(findHeaderEnd(lines), 50);
  const tailStart = Math.max(totalLines - 30, headerEnd);

  const smartLines: Array<{ line: number; text: string }> = [];

  for (let i = 0; i < headerEnd; i++) {
    smartLines.push({ line: i + 1, text: lines[i] });
  }

  if (headerEnd < tailStart) {
    smartLines.push({ line: -1, text: "" });
    smartLines.push({
      line: -1,
      text: `  ... ${tailStart - headerEnd} lines hidden ...`,
    });
    smartLines.push({ line: -1, text: "" });
  }

  const keyDeclarations = extractKeyDeclarations(
    lines.slice(headerEnd, tailStart),
  );
  for (const decl of keyDeclarations) {
    smartLines.push({ line: decl.line + 1 + headerEnd, text: decl.text });
  }

  if (keyDeclarations.length > 0 && headerEnd < tailStart) {
    smartLines.push({ line: -1, text: "" });
  }

  for (let i = tailStart; i < totalLines; i++) {
    smartLines.push({ line: i + 1, text: lines[i] });
  }

  const header = [
    `File: ${filePath}`,
    `${totalLines} total lines (SMART MODE - header + signatures + tail)`,
    'Pass startLine/endLine to read a specific range.',
    'Or use chunkStrategy: "full" to read the entire file.',
    "",
  ].join("\n");

  const body = smartLines
    .map((s) => {
      if (s.line === -1) return s.text;
      return `${String(s.line).padStart(4, " ")} | ${s.text}`;
    })
    .join("\n");

  return truncateToTokenLimit(`${header}\n${body}`, 3000);
}

function findHeaderEnd(lines: string[]): number {
  let lastImportLine = 0;
  for (let i = 0; i < Math.min(lines.length, 80); i++) {
    const line = lines[i].trim();
    if (
      line.startsWith("import ") ||
      line.startsWith("from ") ||
      line.startsWith("require(") ||
      line.startsWith("//") ||
      line.startsWith("#") ||
      line.startsWith("/*") ||
      line.startsWith("*") ||
      line === ""
    ) {
      if (
        !line.startsWith("//") &&
        !line.startsWith("#") &&
        !line.startsWith("/*") &&
        !line.startsWith("*") &&
        line !== ""
      ) {
        lastImportLine = i;
      }
    } else {
      if (lastImportLine > 0) break;
    }
  }
  return Math.max(lastImportLine + 1, 10);
}

function extractKeyDeclarations(
  lines: string[],
): Array<{ line: number; text: string }> {
  const decls: Array<{ line: number; text: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("//") || line.startsWith("#")) continue;
    if (
      /^(export\s+)?(async\s+)?(function|class|interface|type|enum|const|let|var|def)\s/.test(line)
    ) {
      decls.push({ line: i, text: line.substring(0, 150) });
    }
  }
  return decls;
}
