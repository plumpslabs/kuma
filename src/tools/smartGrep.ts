import fg from "fast-glob";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { getProjectRoot, validateFilePath } from "../utils/pathValidator.js";
import { limitLines } from "../utils/tokenCounter.js";
import { sessionMemory } from "../engine/sessionMemory.js";

// ============================================================
// SMART GREP v2 — Ripgrep-first, blazing-fast code search
// ============================================================

export interface SmartGrepParams {
  query?: string;
  queries?: string[];
  filePath?: string;
  targetFolder?: string;
  maxResults?: number;
  extensions?: string[];
  contextLines?: number;
  filenamesOnly?: boolean;
  countOnly?: boolean;
  outputMode?: "rich" | "raw" | "json";
  compact?: boolean;
}

const IGNORE_PATTERNS = [
  "**/node_modules/**",
  "**/.next/**",
  "**/dist/**",
  "**/build/**",
  "**/.git/**",
  "**/.cache/**",
  "**/.kuma/backups/**",
  "**/*.min.js",
  "**/*.bundle.js",
  "**/*.map",
  "**/package-lock.json",
  "**/yarn.lock",
  "**/pnpm-lock.yaml",
  "**/*.svg",
  "**/*.png",
  "**/*.jpg",
  "**/*.jpeg",
  "**/*.gif",
  "**/*.ico",
  "**/*.woff",
  "**/*.woff2",
  "**/*.ttf",
  "**/*.eot",
  "**/coverage/**",
  "**/.nyc_output/**",
];

// Cache for identical queries
const grepCache = new Map<string, { results: string; timestamp: number }>();
const CACHE_TTL_MS = 30_000;

// Cache for rg availability check
let rgAvailable: boolean | null = null;

function isRipgrepAvailable(): boolean {
  // Allow disabling ripgrep for tests or environments where rg causes issues
  if (process.env.KUMA_DISABLE_RG === "1" || process.env.KUMA_DISABLE_RG === "true") {
    return false;
  }
  if (rgAvailable !== null) return rgAvailable;
  try {
    execSync("rg --version", { stdio: "ignore", timeout: 2000 });
    rgAvailable = true;
  } catch {
    rgAvailable = false;
  }
  return rgAvailable;
}

function quotePath(p: string): string {
  // Wrap path in quotes to handle spaces
  return `"${p.replace(/"/g, '\\"')}"`;
}

/**
 * Search in a single file only — bypasses project-wide glob scan.
 * Used when AI passes filePath to grep.
 */
async function searchInSingleFile(
  filePath: string,
  patterns: string[],
  opts: {
    maxResults: number;
    contextLines: number;
    filenamesOnly: boolean;
    countOnly: boolean;
    outputMode: string;
    compact: boolean;
  },
): Promise<string> {
  const { maxResults, contextLines, filenamesOnly, countOnly, outputMode, compact } = opts;

  // Resolve file path
  const validation = validateFilePath(filePath);
  if (!validation.valid) {
    return compact ? `ERR:${filePath} - invalid path` : `Error: ${validation.error.message}`;
  }

  const resolvedPath = validation.resolvedPath;
  if (!fs.existsSync(resolvedPath)) {
    return compact ? `ERR:not found ${filePath}` : `Error: File not found: ${filePath}`;
  }

  // Check file size (skip large files)
  const stat = fs.statSync(resolvedPath);
  if (stat.size > 500_000) {
    return compact ? `ERR:too large ${filePath}` : `Error: File too large (${(stat.size / 1024).toFixed(0)}KB). Use a more specific query.`;
  }

  // Check for binary files
  if (isBinaryFile(resolvedPath)) {
    return compact ? `ERR:binary ${filePath}` : `Error: Cannot search binary file: ${filePath}`;
  }

  // Normalize path to be relative to project root (consistent with project-wide search)
  const projectRoot = getProjectRoot();
  const relativePath = resolvedPath.startsWith(projectRoot + "/")
    ? resolvedPath.slice(projectRoot.length + 1)
    : resolvedPath;

  try {
    const content = fs.readFileSync(resolvedPath, "utf-8");
    const lines = content.split("\n");
    const regex = createCombinedRegex(patterns);

    const results: Array<{ file: string; line: number; content: string }> = [];
    const maxFileResults = Math.min(maxResults, 100); // cap at 100 to prevent token explosion
    let matchCount = 0;

    for (let i = 0; i < lines.length; i++) {
      if (results.length >= maxFileResults) break;
      if (regex.test(lines[i])) {
        matchCount++;
        if (filenamesOnly) {
          return relativePath;
        }
        if (countOnly) continue;

        // Collect context lines
        const ctxLines: string[] = [];
        const startCtx = Math.max(0, i - contextLines);
        const endCtx = Math.min(lines.length - 1, i + contextLines);
        for (let ci = startCtx; ci <= endCtx; ci++) {
          const prefix = ci === i ? ">" : " ";
          ctxLines.push(`${prefix}${ci + 1}: ${lines[ci].substring(0, 200)}`);
        }

        results.push({
          file: relativePath,
          line: i + 1,
          content: ctxLines.join("\n"),
        });
      }
    }

    if (countOnly) {
      const counts = `${filePath}:${matchCount}`;
      if (outputMode === "json") return JSON.stringify({ [filePath]: matchCount });
      if (compact) return counts;
      return `📊 Count results for "${patterns[0]}":\n${counts}`;
    }

    if (matchCount === 0) {
      if (outputMode === "json") return JSON.stringify({ query: patterns[0], matches: 0 });
      if (compact) return `0:${patterns[0]}`;
      return `🔍 No matches for "${patterns[0]}" in ${filePath}.`;
    }

    if (compact || outputMode === "raw") {
      return results.map((r) => `${r.file}:${r.line}:${r.content.split("\n")[0].replace(/^[>\s]+\d+:\s*/, "")}`).join("\n");
    }

    if (outputMode === "json") {
      return JSON.stringify(results);
    }

    // Rich format
    const header = `🔍 Smart Grep: "${patterns[0]}" — ${filePath}\n📁 ${results.length} matches\n`;
    const body = results
      .map((r, i) => `[${i + 1}] 📄 ${r.file}:${r.line}\n    ${r.content}`)
      .join("\n");
    return limitLines(`${header}${body}`, 150);
  } catch (err) {
    return compact
      ? `ERR:reading ${filePath}`
      : `Error reading file "${filePath}": ${err instanceof Error ? err.message : String(err)}`;
  }
}


export async function handleSmartGrep(
  params: SmartGrepParams,
): Promise<string> {
  const {
    query,
    queries,
    targetFolder,
    maxResults = 30,
    filePath,
    extensions,
    contextLines = 1,
    filenamesOnly = false,
    countOnly = false,
    outputMode = "rich",
    compact = false,
  } = params;

  // Combine queries: if queries[] given, use it; else fallback to query string
  const patterns = queries && queries.length > 0 ? queries : (query ? [query] : []);
  if (patterns.length === 0 || patterns[0].length < 1) {
    return compact
      ? "ERR:query required"
      : "Error: 'query' or 'queries' parameter is required.";
  }

  // Build cache key
  const cacheKey = `${patterns.join("||")}:${filePath ?? ""}:${targetFolder ?? "root"}:${maxResults}:${contextLines}:${filenamesOnly}:${countOnly}:${outputMode}:${extensions ? extensions.join(",") : ""}`;
  const cached = grepCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    sessionMemory.recordToolCall("smart_grep", { query: patterns[0], cached: true });
    return cached.results;
  }

  const projectRoot = getProjectRoot();
  let result: string;

  // If filePath is specified, search that single file only
  if (filePath) {
    result = await searchInSingleFile(filePath, patterns, {
      maxResults,
      contextLines,
      filenamesOnly,
      countOnly,
      outputMode,
      compact,
    });
  } else if (isRipgrepAvailable()) {
    // Try ripgrep first (10-50x faster)
    result = await tryRipgrep(patterns, {
      projectRoot,
      targetFolder,
      maxResults,
      extensions,
      contextLines,
      filenamesOnly,
      countOnly,
      outputMode,
      compact,
    });
  } else {
    // Fallback to JS implementation
    result = await jsGrep(patterns, {
      projectRoot,
      targetFolder,
      maxResults,
      extensions,
      contextLines,
      filenamesOnly,
      countOnly,
      outputMode,
      compact,
    });
  }

  // Cache result
  grepCache.set(cacheKey, { results: result, timestamp: Date.now() });

  // Record session
  sessionMemory.recordToolCall("smart_grep", {
    query: patterns[0],
    matchCount: result.length,
    engine: rgAvailable ? "ripgrep" : "js",
  });

  return result;
}

// ============================================================
// RIPGREP ENGINE
// ============================================================

interface GrepOptions {
  projectRoot: string;
  targetFolder?: string;
  maxResults: number;
  extensions?: string[];
  contextLines: number;
  filenamesOnly: boolean;
  countOnly: boolean;
  outputMode: string;
  compact: boolean;
}

async function tryRipgrep(patterns: string[], opts: GrepOptions): Promise<string> {
  const args: string[] = [];

  // Base command
  args.push("rg", "--no-heading", "--color", "never", "-i");

  // File types
  if (opts.extensions && opts.extensions.length > 0) {
    for (const ext of opts.extensions) {
      const clean = ext.startsWith(".") ? ext.slice(1) : ext;
      args.push("--type-add", `kuma:*.${clean}`);
      args.push("--type", "kuma");
    }
  }

  // Context lines
  if (opts.contextLines > 0 && !opts.filenamesOnly && !opts.countOnly) {
    args.push("-C", String(opts.contextLines));
  }

  // Max results (rg uses --max-count per file, we use -m)
  if (!opts.filenamesOnly && !opts.countOnly) {
    // limit matches per file
    const perFileLimit = Math.min(opts.maxResults, 50);
    args.push("-m", String(perFileLimit));
  }

  // Filenames only
  if (opts.filenamesOnly) {
    args.push("-l");
  }

  // Count only
  if (opts.countOnly) {
    args.push("-c");
  }

  // Patterns (use -e for each pattern to support multiple queries)
  for (const p of patterns) {
    args.push("-e", p);
  }

  // Target directory (quoted for spaces)
  const searchDir = opts.targetFolder
    ? path.join(opts.projectRoot, opts.targetFolder)
    : opts.projectRoot;
  args.push(quotePath(searchDir));

  // Run command
  try {
    const output = execSync(args.join(" "), {
      cwd: opts.projectRoot,
      maxBuffer: 10 * 1024 * 1024, // 10MB
      timeout: 15000,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });

    if (!output || output.trim().length === 0) {
      return formatEmpty(patterns[0], opts);
    }

    return formatRipgrepOutput(output, patterns, opts);
  } catch (err: any) {
    // rg exits with code 1 when no matches (this is normal)
    if (err.status === 1) {
      return formatEmpty(patterns[0], opts);
    }
    // Other errors: fallback to JS
    return await jsGrep(patterns, opts);
  }
}

function formatRipgrepOutput(
  output: string,
  patterns: string[],
  opts: GrepOptions,
): string {
  const lines = output.trim().split("\n");

  if (opts.countOnly) {
    // Format: file:count
    const counts = lines.map((l) => {
      const parts = l.split(":");
      if (parts.length >= 2) {
        const count = parts.pop();
        return `${parts.join(":")}:${count}`;
      }
      return l;
    });
    if (opts.outputMode === "json") {
      const obj: Record<string, number> = {};
      for (const c of counts) {
        const idx = c.lastIndexOf(":");
        if (idx > 0) {
          obj[c.slice(0, idx)] = parseInt(c.slice(idx + 1), 10);
        }
      }
      return JSON.stringify(obj);
    }
    if (opts.compact) return counts.join("\n");
    return `📊 Count results for "${patterns[0]}":\n${counts.join("\n")}`;
  }

  if (opts.filenamesOnly) {
    if (opts.outputMode === "json") return JSON.stringify(lines);
    if (opts.compact) return lines.join("\n");
    return `📁 Files matching "${patterns[0]}":\n${lines.join("\n")}`;
  }

  // Parse and limit results (normalize paths to be relative to project root)
  const results = parseRipgrepOutput(output, opts.projectRoot).slice(0, opts.maxResults);

  if (results.length === 0) {
    return formatEmpty(patterns[0], opts);
  }

  // Raw / compact
  if (opts.compact || opts.outputMode === "raw") {
    return results.map((r) => `${r.file}:${r.line}:${r.content}`).join("\n");
  }

  // JSON
  if (opts.outputMode === "json") {
    return JSON.stringify(results);
  }

  // Rich format (default)
  const header = `🔍 Smart Grep: "${patterns[0]}"\n📁 ${results.length} matches\n`;
  const body = results
    .map((r, i) => `[${i + 1}] 📄 ${r.file}:${r.line}\n    ${r.content}`)
    .join("\n");
  return limitLines(`${header}${body}`, 150);
}

function parseRipgrepOutput(
  output: string,
  projectRoot?: string,
): Array<{ file: string; line: number; content: string }> {
  const results: Array<{ file: string; line: number; content: string }> = [];
  const lines = output.trim().split("\n");
  const rootPrefix = projectRoot ? projectRoot.replace(/\/+$/, "") + "/" : "";

  for (const line of lines) {
    // rg with --no-heading: file:line:content
    // Match from END to handle paths with colons:
    // Find the LAST occurrence of :digits: which is the line number separator
    const lastColonIdx = line.lastIndexOf(":");
    if (lastColonIdx <= 0) continue;

    const beforeLastColon = line.slice(0, lastColonIdx);
    const afterLastColon = line.slice(lastColonIdx + 1);

    if (!afterLastColon.trim()) continue;

    // Now find the second-to-last colon that precedes the line number
    const secondLastColonIdx = beforeLastColon.lastIndexOf(":");
    if (secondLastColonIdx <= 0) continue;

    let potentialFile = beforeLastColon.slice(0, secondLastColonIdx);
    const potentialLineStr = beforeLastColon.slice(secondLastColonIdx + 1);
    const potentialLine = parseInt(potentialLineStr, 10);

    if (isNaN(potentialLine) || potentialLine <= 0) continue;

    // Strip project root prefix to get relative paths
    if (rootPrefix && potentialFile.startsWith(rootPrefix)) {
      potentialFile = potentialFile.slice(rootPrefix.length);
    }

    results.push({
      file: potentialFile,
      line: potentialLine,
      content: afterLastColon.trim(),
    });
  }
  return results;
}

// ============================================================
// JAVASCRIPT FALLBACK ENGINE
// ============================================================

async function jsGrep(patterns: string[], opts: GrepOptions): Promise<string> {
  const { projectRoot, targetFolder, maxResults, extensions, contextLines, filenamesOnly, countOnly, outputMode, compact } = opts;

  // Build glob pattern
  const searchPattern = targetFolder
    ? path.join(targetFolder, "**/*").replace(/\\/g, "/")
    : "**/*";

  const targetDepth = targetFolder ? targetFolder.split("/").filter(Boolean).length : 0;
  const maxDepth = targetFolder ? Math.min(targetDepth + 5, 20) : 10;

  let entries = await fg(searchPattern, {
    cwd: projectRoot,
    ignore: IGNORE_PATTERNS,
    onlyFiles: true,
    absolute: false,
    deep: maxDepth,
    dot: false,
  });

  // Filter by extensions
  if (extensions && extensions.length > 0) {
    const normalizedExts = extensions.map((e) =>
      e.startsWith(".") ? e.toLowerCase() : `.${e.toLowerCase()}`,
    );
    entries = entries.filter((entry) => {
      const ext = path.extname(entry).toLowerCase();
      return normalizedExts.includes(ext);
    });
  }

  if (entries.length === 0) {
    return formatEmpty(patterns[0], opts);
  }

  // Create combined regex from all patterns
  const regex = createCombinedRegex(patterns);
  const results: Array<{ file: string; line: number; content: string }> = [];
  const fileCounts: Map<string, number> = new Map();
  const matchedFiles: Set<string> = new Set();
  let filesScanned = 0;

  for (const entry of entries) {
    if (!filenamesOnly && results.length >= maxResults) break;
    filesScanned++;

    try {
      const fullPath = path.join(projectRoot, entry);
      const stat = fs.statSync(fullPath);
      if (stat.size > 500_000) continue;
      if (isBinaryFile(fullPath)) continue;

      const content = fs.readFileSync(fullPath, "utf-8");
      const lines = content.split("\n");
      let fileMatchCount = 0;

      for (let i = 0; i < lines.length; i++) {
        if (!filenamesOnly && results.length >= maxResults) break;
        if (regex.test(lines[i])) {
          fileMatchCount++;
          matchedFiles.add(entry);

          if (filenamesOnly) {
            break; // Just need to know it matches
          }

          if (countOnly) {
            fileCounts.set(entry, (fileCounts.get(entry) || 0) + 1);
            continue;
          }

          // Collect context lines
          const contextLinesArr: string[] = [];
          const startCtx = Math.max(0, i - contextLines);
          const endCtx = Math.min(lines.length - 1, i + contextLines);

          for (let ci = startCtx; ci <= endCtx; ci++) {
            const prefix = ci === i ? ">" : " ";
            contextLinesArr.push(`${prefix}${ci + 1}: ${lines[ci].substring(0, 200)}`);
          }

          results.push({
            file: entry,
            line: i + 1,
            content: contextLinesArr.join("\n"),
          });
        }
      }
    } catch {
      continue;
    }
  }

  // No matches found
  if (matchedFiles.size === 0) {
    return formatEmpty(patterns[0], opts);
  }

  // Format output
  if (filenamesOnly) {
    const files = Array.from(matchedFiles);
    if (outputMode === "json") return JSON.stringify(files);
    if (compact) return files.join("\n");
    return `📁 Files matching "${patterns[0]}":\n${files.join("\n")}`;
  }

  if (countOnly) {
    const counts = Array.from(fileCounts.entries()).map(([f, c]) => `${f}:${c}`);
    if (outputMode === "json") return JSON.stringify(Object.fromEntries(fileCounts));
    if (compact) return counts.join("\n");
    return `📊 Count results for "${patterns[0]}":\n${counts.join("\n")}`;
  }

  if (compact || outputMode === "raw") {
    return results.map((r) => `${r.file}:${r.line}:${r.content.split("\n")[0].replace(/^[>\s]+\d+:\s*/, "")}`).join("\n");
  }

  if (outputMode === "json") {
    return JSON.stringify(results);
  }

  // Rich format (default)
  return formatResults(results, patterns[0], filesScanned);
}

function createCombinedRegex(patterns: string[]): RegExp {
  if (patterns.length === 1) {
    return createRegex(patterns[0]);
  }
  // Combine all patterns with alternation
  const combined = patterns.map((p) => {
    try {
      // If it looks like regex, use as-is; else escape
      if (/[.\\+*?[\](){}^$|]/.test(p)) {
        return `(?:${p})`;
      }
      return `(?:${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`;
    } catch {
      return p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }).join("|");
  return new RegExp(combined, "i");
}

/** @internal exported for testing */
export function createRegex(query: string): RegExp {
  const normalized = query.replace(/\\\|/g, "|");

  try {
    if (/[.\\+*?[\](){}^$|]/.test(normalized)) {
      return new RegExp(normalized, "i");
    }
  } catch {
    // fall through
  }
  return new RegExp(normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

function formatEmpty(pattern: string, opts: GrepOptions): string {
  if (opts.outputMode === "json") return JSON.stringify({ query: pattern, matches: 0, results: [] });
  if (opts.compact) return `0:${pattern}`;
  return `🔍 No matches for "${pattern}".`;
}

/** @internal exported for testing */
export function formatResults(
  results: Array<{ file: string; line: number; content: string }>,
  query: string,
  filesScanned: number,
): string {
  if (results.length === 0) {
    return `🔍 No matches for "${query}" (${filesScanned} files scanned).`;
  }
  const lines_out = [
    `🔍 Smart Grep: "${query}"`,
    `📁 ${results.length} matches from ${filesScanned} files scanned`,
    "",
    ...results.map((r, i) => {
      return `[${i + 1}] 📄 ${r.file}:${r.line}\n${r.content
        .split("\n")
        .map((l) => `    ${l}`)
        .join("\n")}`;
    }),
    "",
    `💡 Use smart_file_picker to open a specific file.`,
  ];
  return limitLines(lines_out.join("\n"), 150);
}

/** @internal exported for testing */
export function isBinaryFile(filePath: string): boolean {
  try {
    const buffer = Buffer.alloc(512);
    const fd = fs.openSync(filePath, "r");
    const bytesRead = fs.readSync(fd, buffer, 0, 512, 0);
    fs.closeSync(fd);
    for (let i = 0; i < bytesRead; i++) {
      if (buffer[i] === 0) return true;
    }
    return false;
  } catch {
    return true;
  }
}
