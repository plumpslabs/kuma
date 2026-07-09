import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import fg from "fast-glob";
import { getProjectRoot, validateFilePath } from "../utils/pathValidator.js";
import { sessionMemory } from "../engine/sessionMemory.js";

// ============================================================
// KUMA STATS — File/directory/project statistics
// Replaces: wc -l, du -sh, cloc for AI agents
// ============================================================

export interface KumaStatsParams {
  filePath?: string;
  target?: "file" | "dir" | "project";
  outputMode?: "rich" | "raw" | "json";
  compact?: boolean;
  extensions?: string[];
}

// Language detection based on file extensions
const LANG_MAP: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript React",
  js: "JavaScript",
  jsx: "JavaScript React",
  py: "Python",
  go: "Go",
  rs: "Rust",
  java: "Java",
  kt: "Kotlin",
  rb: "Ruby",
  php: "PHP",
  cs: "C#",
  swift: "Swift",
  c: "C",
  cpp: "C++",
  h: "C/C++ Header",
  css: "CSS",
  scss: "SCSS",
  less: "Less",
  html: "HTML",
  json: "JSON",
  yaml: "YAML",
  yml: "YAML",
  md: "Markdown",
  sql: "SQL",
  graphql: "GraphQL",
  prisma: "Prisma",
  toml: "TOML",
  xml: "XML",
  svg: "SVG",
  sh: "Shell",
  bash: "Shell",
  dockerfile: "Dockerfile",
};

export async function handleKumaStats(params: KumaStatsParams): Promise<string> {
  const {
    filePath,
    target = "project",
    outputMode = "rich",
    compact = false,
    extensions,
  } = params;

  if (target === "file" && filePath) {
    return await statsSingleFile(filePath, { outputMode, compact });
  }

  if (target === "dir" && filePath) {
    return await statsDirectory(filePath, { outputMode, compact, extensions });
  }

  // Default: project-wide stats
  return await statsProject({ outputMode, compact, extensions });
}

// ============================================================
// Single file stats
// ============================================================

async function statsSingleFile(
  filePath: string,
  opts: { outputMode: string; compact: boolean },
): Promise<string> {
  const { outputMode, compact } = opts;
  const validation = validateFilePath(filePath);
  if (!validation.valid) {
    return compact ? `ERR:${filePath}` : `Error: ${validation.error.message}`;
  }

  const resolvedPath = validation.resolvedPath;
  if (!fs.existsSync(resolvedPath)) {
    return compact ? `ERR:not found` : `Error: File not found: ${filePath}`;
  }

  const stat = fs.statSync(resolvedPath);
  const isDir = stat.isDirectory();

  if (isDir) {
    return statsDirectory(filePath, { outputMode, compact });
  }

  const content = fs.readFileSync(resolvedPath, "utf-8");
  const lines = content.split("\n");
  const ext = path.extname(resolvedPath).replace(".", "").toLowerCase();
  const lang = LANG_MAP[ext] || ext.toUpperCase() || "Unknown";
  const totalBytes = stat.size;
  const nonEmpty = lines.filter((l) => l.trim().length > 0).length;

  if (outputMode === "json") {
    return JSON.stringify({
      file: filePath,
      lines: lines.length,
      nonEmpty,
      size: totalBytes,
      sizeHuman: formatBytes(totalBytes),
      language: lang,
    });
  }

  if (compact || outputMode === "raw") {
    return `${filePath}\t${lines.length}\t${formatBytes(totalBytes)}\t${lang}`;
  }

  return [
    `📊 Stats: ${filePath}`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `  Language:    ${lang}`,
    `  Lines:       ${lines.length}`,
    `  Non-empty:   ${nonEmpty}`,
    `  Size:        ${formatBytes(totalBytes)}`,
  ].join("\n");
}

// ============================================================
// Directory stats
// ============================================================

async function statsDirectory(
  dirPath: string,
  opts: { outputMode: string; compact: boolean; extensions?: string[] },
): Promise<string> {
  const { outputMode, compact, extensions } = opts;
  const projectRoot = getProjectRoot();

  // Resolve directory path relative to project root
  const resolved = path.isAbsolute(dirPath)
    ? dirPath
    : path.join(projectRoot, dirPath);

  if (!fs.existsSync(resolved)) {
    return compact ? `ERR:not found ${dirPath}` : `Error: Directory not found: ${dirPath}`;
  }

  // Count files and lines
  let totalFiles = 0;
  let totalLines = 0;
  let totalBytes = 0;
  const langCounts: Record<string, { files: number; lines: number }> = {};

  const entries = await fg("**/*", {
    cwd: resolved,
    onlyFiles: true,
    ignore: [
      "**/node_modules/**",
      "**/.git/**",
      "**/dist/**",
      "**/build/**",
      "**/.next/**",
      "**/coverage/**",
      "**/*.map",
    ],
    deep: 10,
    dot: false,
  });

  for (const entry of entries) {
    const ext = path.extname(entry).replace(".", "").toLowerCase();
    if (extensions && extensions.length > 0) {
      const normalizedExts = extensions.map((e) =>
        e.startsWith(".") ? e.toLowerCase() : `.${e.toLowerCase()}`,
      );
      if (!normalizedExts.includes(`.${ext}`)) continue;
    }

    totalFiles++;
    const fullPath = path.join(resolved, entry);
    try {
      const stat = fs.statSync(fullPath);
      if (stat.size > 1_000_000) {
        totalBytes += stat.size;
        continue; // Skip large files for line counting
      }
      const content = fs.readFileSync(fullPath, "utf-8");
      const lineCount = content.split("\n").length;
      totalLines += lineCount;
      totalBytes += stat.size;

      const lang = LANG_MAP[ext] || ext.toUpperCase() || "Other";
      if (!langCounts[lang]) {
        langCounts[lang] = { files: 0, lines: 0 };
      }
      langCounts[lang].files++;
      langCounts[lang].lines += lineCount;
    } catch {
      // If stat failed, try getting size directly
      try {
        const fallbackStat = fs.statSync(fullPath);
        totalBytes += fallbackStat.size;
      } catch {
        totalBytes += 0;
      }
    }
  }

  sessionMemory.recordToolCall("kuma_stats", {
    target: dirPath,
    totalFiles,
    totalLines,
  });

  if (outputMode === "json") {
    return JSON.stringify({
      directory: dirPath,
      totalFiles,
      totalLines,
      totalBytes,
      sizeHuman: formatBytes(totalBytes),
      languages: langCounts,
    });
  }

  if (compact || outputMode === "raw") {
    const langs = Object.entries(langCounts)
      .sort((a, b) => b[1].lines - a[1].lines)
      .map(([name, counts]) => `${name}\t${counts.files}\t${counts.lines}`)
      .join("\n");
    return `${dirPath}\t${totalFiles}\t${totalLines}\t${formatBytes(totalBytes)}\n${langs}`;
  }

  // Rich format
  const langSummary = Object.entries(langCounts)
    .sort((a, b) => b[1].lines - a[1].lines)
    .slice(0, 10)
    .map(
      ([name, counts]) =>
        `  ${name.padEnd(20)} ${String(counts.files).padStart(5)} files  ${String(counts.lines).padStart(8)} lines`,
    )
    .join("\n");

  return [
    `📊 Directory Stats: ${dirPath}`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `  Total files:   ${totalFiles}`,
    `  Total lines:   ${totalLines}`,
    `  Total size:    ${formatBytes(totalBytes)}`,
    ``,
    `Top Languages:`,
    langSummary,
  ].join("\n");
}

// ============================================================
// Project-wide stats
// ============================================================

async function statsProject(
  opts: { outputMode: string; compact: boolean; extensions?: string[] },
): Promise<string> {
  const projectRoot = getProjectRoot();
  const projectName = path.basename(projectRoot);

  // Get project-wide stats
  const projectStats = await statsDirectory(projectRoot, opts);

  // Get git info
  let branch = "unknown";
  let lastCommit = "unknown";
  try {
    branch = execSync("git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown", {
      cwd: projectRoot,
      encoding: "utf-8",
      timeout: 2000,
    }).trim();
    lastCommit = execSync('git log -1 --format="%h %s" 2>/dev/null || echo unknown', {
      cwd: projectRoot,
      encoding: "utf-8",
      timeout: 2000,
    }).trim();
  } catch {
    // Git not available
  }

  if (opts.outputMode === "raw" || opts.compact) {
    return `Project: ${projectName}\tBranch: ${branch}\t${lastCommit}\n${projectStats}`;
  }

  return [
    `📊 Project: ${projectName}`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `  Branch:      ${branch}`,
    `  Last commit: ${lastCommit}`,
    ``,
    projectStats,
  ].join("\n");
}

// ============================================================
// Utilities
// ============================================================

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}
