import fg from "fast-glob";
import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "../utils/pathValidator.js";
import { limitLines } from "../utils/tokenCounter.js";
import { sessionMemory } from "../engine/sessionMemory.js";

// ============================================================
// SMART GREP — Regex search with bounded, line-context output
// ============================================================

interface SmartGrepParams {
  query: string;
  targetFolder?: string;
  maxResults?: number;
  extensions?: string[];
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

// Result cache to avoid rescanning identical queries
const grepCache = new Map<string, { results: string; timestamp: number }>();
const CACHE_TTL_MS = 30_000; // 30 seconds

export async function handleSmartGrep(
  params: SmartGrepParams,
): Promise<string> {
  const { query, targetFolder, maxResults = 30, extensions } = params;

  // Input validation
  if (!query || query.length < 1) {
    return "Error: 'query' parameter is required.";
  }

  // Check cache
  const cacheKey = `${query}:${targetFolder ?? "root"}:${maxResults}:${extensions ? extensions.join(",") : ""}`;
  const cached = grepCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    sessionMemory.recordToolCall("smart_grep", { query, cached: true });
    return cached.results;
  }

  const projectRoot = getProjectRoot();

  try {
    // Build glob pattern
    const searchPattern = targetFolder
      ? path.join(targetFolder, "**/*").replace(/\\/g, "/")
      : "**/*";

    // Calculate max directory depth from project root:
    // When targetFolder is specified, we need to reach files inside it,
    // so depth = target folder depth + extra levels for subdirectories.
    // Without targetFolder, default to 10 levels.
    const targetDepth = targetFolder ? targetFolder.split("/").filter(Boolean).length : 0;
    const maxDepth = targetFolder ? Math.min(targetDepth + 5, 20) : 10;

    // Cari file yang match
    let entries = await fg(searchPattern, {
      cwd: projectRoot,
      ignore: IGNORE_PATTERNS,
      onlyFiles: true,
      absolute: false,
      deep: maxDepth,
      dot: false, // Skip dotfiles
    });

    // Filter by extensions if provided
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
      const msg = `No files found${targetFolder ? ` in folder "${targetFolder}"` : ""}${extensions ? ` with extensions [${extensions.join(", ")}]` : ""}.`;
      grepCache.set(cacheKey, { results: msg, timestamp: Date.now() });
      return msg;
    }

    // Search regex in each file
    const regex = createRegex(query);
    const results: Array<{ file: string; line: number; content: string }> = [];
    let filesScanned = 0;

    for (const entry of entries) {
      if (results.length >= maxResults) break;
      filesScanned++;

      try {
        const fullPath = path.join(projectRoot, entry);
        const stat = fs.statSync(fullPath);

        // Skip file besar (>500KB)
        if (stat.size > 500_000) continue;

        // Skip binary files
        if (isBinaryFile(fullPath)) continue;

        const content = fs.readFileSync(fullPath, "utf-8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          if (results.length >= maxResults) break;

          const line = lines[i];
          if (regex.test(line)) {
            // Get context: 1 line before, match line, 1 line after
            const contextLines: string[] = [];
            if (i > 0)
              contextLines.push(`${i}: ${lines[i - 1].substring(0, 200)}`);
            contextLines.push(`${i + 1}: ${line.substring(0, 200)}`);
            if (i < lines.length - 1)
              contextLines.push(`${i + 2}: ${lines[i + 1].substring(0, 200)}`);

            results.push({
              file: entry,
              line: i + 1,
              content: contextLines.join("\n"),
            });
          }
        }
      } catch {
        continue;
      }
    }

    const formatted = formatResults(results, query, filesScanned);

    grepCache.set(cacheKey, { results: formatted, timestamp: Date.now() });

    // Record ke session memory
    sessionMemory.recordToolCall("smart_grep", {
      query,
      matchCount: results.length,
      filesScanned,
    });
    sessionMemory.addSearchResult(
      query,
      results.map((r) => r.file),
    );

    return formatted;
  } catch (err) {
    return `Error searching "${query}": ${err instanceof Error ? err.message : String(err)}`;
  }
}

/** @internal exported for testing */
export function createRegex(query: string): RegExp {
  const normalized = query.replace(/\\\|/g, "|");

  // First, try to use the query as a real regex pattern
  try {
    // Check if it looks like a regex (has special patterns)
    if (/[.\\+*?[\](){}^$|]/.test(normalized)) {
      return new RegExp(normalized, "i");
    }
  } catch {
    // Regex failed, fall through to literal search
  }
  // Fallback: treat as literal string, escape special chars
  return new RegExp(normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
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

  const lines = [
    `🔍 Smart Grep: "${query}"`,
    `📁 ${results.length} matches from ${filesScanned} files scanned`,
    "",
    ...results.map((r, i) => {
      const filePath = r.file;
      return `[${i + 1}] 📄 ${filePath}:${r.line}\n${r.content
        .split("\n")
        .map((l) => `    ${l}`)
        .join("\n")}`;
    }),
    "",
    `💡 Use smart_file_picker to open a specific file.`,
  ];

  // Batasi output (anti token explosion)
  return limitLines(lines.join("\n"), 150);
}

/** @internal exported for testing */
export function isBinaryFile(filePath: string): boolean {
  try {
    const buffer = Buffer.alloc(512);
    const fd = fs.openSync(filePath, "r");
    const bytesRead = fs.readSync(fd, buffer, 0, 512, 0);
    fs.closeSync(fd);

    // Check null bytes (indicates binary)
    for (let i = 0; i < bytesRead; i++) {
      if (buffer[i] === 0) return true;
    }
    return false;
  } catch {
    return true; // Assume binary if can't read
  }
}
