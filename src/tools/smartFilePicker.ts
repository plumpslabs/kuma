import fs from "node:fs";
import { validateFilePath } from "../utils/pathValidator.js";
import { truncateToTokenLimit } from "../utils/tokenCounter.js";
import { sessionMemory } from "../engine/sessionMemory.js";

// ============================================================
// SMART FILE PICKER — File reader dengan chunking cerdas
// ============================================================

interface SmartFilePickerParams {
  filePath: string;
  startLine?: number;
  endLine?: number;
  chunkStrategy?: "full" | "smart" | "outline";
}

const MAX_FILE_SIZE = 1_000_000; // 1MB
const CHUNK_THRESHOLD = 300; // Baris

export async function handleSmartFilePicker(params: SmartFilePickerParams): Promise<string> {
  const { filePath, startLine, endLine, chunkStrategy = "smart" } = params;

  // Validasi path
  const validation = validateFilePath(filePath);
  if (!validation.valid) {
    return `Error: ${validation.error.message}`;
  }

  const resolvedPath = validation.resolvedPath;

  // Cek file exists
  if (!fs.existsSync(resolvedPath)) {
    return `Error: File tidak ditemukan: "${filePath}".\nCoba gunakan smart_grep dulu untuk mencari file yang benar.`;
  }

  const stat = fs.statSync(resolvedPath);

  // Cek file size
  if (stat.size > MAX_FILE_SIZE) {
    return `Error: File terlalu besar (${(stat.size / 1024 / 1024).toFixed(1)}MB). Maks 1MB.\nGunakan smart_grep untuk mencari konten spesifik.`;
  }

  try {
    const content = fs.readFileSync(resolvedPath, "utf-8");
    const lines = content.split("\n");
    const totalLines = lines.length;

    // Record ke session memory
    sessionMemory.recordToolCall("smart_file_picker", { filePath, chunkStrategy, totalLines });

    // Jika ada range spesifik (startLine - endLine)
    if (startLine !== undefined || endLine !== undefined) {
      const start = startLine ?? 1;
      const end = endLine ?? totalLines;
      const selectedLines = lines.slice(start - 1, end);
      return formatOutput(filePath, selectedLines, start, totalLines, false);
    }

    // Jika file kecil, kirim full
    if (totalLines <= CHUNK_THRESHOLD || chunkStrategy === "full") {
      return formatOutput(filePath, lines, 1, totalLines, false);
    }

    // Chunking berdasarkan strategi
    switch (chunkStrategy) {
      case "outline":
        return handleOutlineStrategy(filePath, lines, totalLines);
      case "smart":
        return handleSmartStrategy(filePath, lines, totalLines);
      default:
        return formatOutput(filePath, lines.slice(0, CHUNK_THRESHOLD), 1, totalLines, true);
    }
  } catch (err) {
    return `Error membaca file "${filePath}": ${err instanceof Error ? err.message : String(err)}`;
  }
}

function formatOutput(
  filePath: string,
  lines: string[],
  startLine: number,
  totalLines: number,
  truncated: boolean
): string {
  const header = [
    `📄 File: ${filePath}`,
    `📏 ${totalLines} baris total`,
    truncated ? `⚠️ Ditampilkan ${lines.length} baris (file >${CHUNK_THRESHOLD} baris). Gunakan startLine/endLine untuk range spesifik.` : "",
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

  const full = `${header}\n${body}`;

  // Batasi total output (anti token explosion)
  return truncateToTokenLimit(full, 2000);
}

async function handleOutlineStrategy(
  filePath: string,
  lines: string[],
  totalLines: number
): Promise<string> {
  // Outline: cuma exported symbols + imports
  const importLines: string[] = [];
  const exportLines: Array<{ line: number; text: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip comments
    if (line.startsWith("//") || line.startsWith("#") || line.startsWith("/*") || line.startsWith("*")) continue;

    // Imports
    if (line.startsWith("import ") || line.startsWith("from ") || line.startsWith("require(")) {
      importLines.push(line);
      continue;
    }

    // Exports and declarations
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
    `📄 File: ${filePath}`,
    `📏 ${totalLines} baris total (OUTLINE MODE — hanya signatures & imports)`,
    "",
    "📥 Imports:",
    ...importLines.slice(0, 30).map((l) => `  ${l.substring(0, 150)}`),
    importLines.length > 30 ? `  ...dan ${importLines.length - 30} imports lainnya` : "",
    "",
    "📤 Exports & Declarations:",
    ...exportLines.map((e) => `  [L${e.line}] ${e.text}`),
    "",
    `💡 Gunakan smart_file_picker dengan startLine/endLine untuk membaca bagian spesifik.`,
    `💡 Atau gunakan chunkStrategy: "full" untuk membaca seluruh file.`,
  ]
    .filter(Boolean)
    .join("\n");

  return truncateToTokenLimit(result, 1500);
}

async function handleSmartStrategy(
  filePath: string,
  lines: string[],
  totalLines: number
): Promise<string> {
  // Smart: kirim baris pertama (imports, headers) + signatures + baris terakhir
  // Ini ngasih AI cukup konteks tanpa overload

  const headerEnd = Math.min(findHeaderEnd(lines), 50);
  const tailStart = Math.max(totalLines - 30, headerEnd);

  const smartLines: Array<{ line: number; text: string }> = [];

  // Header (imports, interfaces awal)
  for (let i = 0; i < headerEnd; i++) {
    smartLines.push({ line: i + 1, text: lines[i] });
  }

  // Function/class signatures dari middle
  if (headerEnd < tailStart) {
    smartLines.push({ line: -1, text: "" });
    smartLines.push({ line: -1, text: `  ... ${tailStart - headerEnd} baris disembunyikan ...` });
    smartLines.push({ line: -1, text: "" });
  }

  // Key declarations
  const keyDeclarations = extractKeyDeclarations(lines.slice(headerEnd, tailStart));
  for (const decl of keyDeclarations) {
    smartLines.push({ line: decl.line + 1 + headerEnd, text: decl.text });
  }

  if (keyDeclarations.length > 0 && headerEnd < tailStart) {
    smartLines.push({ line: -1, text: "" });
  }

  // Tail (last 30 lines)
  for (let i = tailStart; i < totalLines; i++) {
    smartLines.push({ line: i + 1, text: lines[i] });
  }

  const header = [
    `📄 File: ${filePath}`,
    `📏 ${totalLines} baris total (SMART MODE — header + signatures + tail)`,
    `💡 Gunakan startLine/endLine untuk membaca range baris tertentu.`,
    `💡 Atau chunkStrategy: "full" untuk membaca seluruh file.`,
    "",
  ].join("\n");

  const body = smartLines
    .map((s) => {
      if (s.line === -1) return s.text;
      return `${String(s.line).padStart(4, " ")} | ${s.text}`;
    })
    .join("\n");

  const full = `${header}\n${body}`;
  return truncateToTokenLimit(full, 3000);
}

function findHeaderEnd(lines: string[]): number {
  // Cari akhir dari blok imports/header
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
      if (!line.startsWith("//") && !line.startsWith("#") && !line.startsWith("/*") && !line.startsWith("*") && line !== "") {
        lastImportLine = i;
      }
    } else {
      // If we've passed imports and hit code, stop
      if (lastImportLine > 0) break;
    }
  }
  return Math.max(lastImportLine + 1, 10);
}

function extractKeyDeclarations(lines: string[]): Array<{ line: number; text: string }> {
  const decls: Array<{ line: number; text: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip empty/comments
    if (!line || line.startsWith("//") || line.startsWith("#")) continue;

    // Match function/class/interface/exports declarations
    if (
      /^(export\s+)?(async\s+)?(function|class|interface|type|enum|const|let|var|def)\s/.test(line)
    ) {
      decls.push({ line: i, text: line.substring(0, 150) });
    }
  }

  return decls;
}
